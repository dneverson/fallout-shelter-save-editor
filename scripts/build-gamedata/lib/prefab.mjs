// Pragmatic scanners for the Unity YAML prefab + I2 localization. We do not fully
// parse YAML - we scan line-by-line for the known field markers, the same approach
// proven by fs-save-editor (re-implemented here, not copied). Field names verified
// against our Unity 6000.0.58f2 export.

export function splitLines(text) {
  return text.split(/\r?\n/);
}

/** Extract `key: value` (trimmed) from a single line, or null if it doesn't match. */
export function field(line, key) {
  const m = line.match(new RegExp(`^\\s*${key}:\\s*(.*?)\\s*$`));
  return m ? m[1] : null;
}

const RARITY_WORDS = ['None', 'Common', 'Normal', 'Rare', 'Legendary'];

/**
 * Unwrap a YAML scalar value: strip matching single/double quotes (a few item names
 * are quoted to preserve a trailing space, e.g. `'Enhanced Gauss Pistol '`) and trim.
 * Single-quote `''` is YAML's escape for a literal apostrophe. Unquoted values are
 * just trimmed. Leaves unquoted apostrophes (e.g. "Wild Bill's Sidearm") untouched.
 */
function unquoteYaml(value) {
  let v = value.trim();
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    v = v.slice(1, -1).replace(/''/g, "'");
  } else if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    v = v.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  return v.trim();
}

/**
 * Build id → rarity word from the prefab's card entries, which are named
 * `'<id> (<Rarity>) '`. Covers weapons/outfits/junk uniformly. Items without a
 * card entry default to "Normal" at the call site.
 */
export function parseRarityById(text) {
  const re = new RegExp(`^\\s*- name:\\s*'(.+) \\((${RARITY_WORDS.join('|')})\\)\\s*'\\s*$`);
  const map = new Map();
  for (const line of splitLines(text)) {
    const m = line.match(re);
    if (m && !map.has(m[1])) map.set(m[1], m[2]);
  }
  return map;
}

/**
 * Build id → sell price from the prefab's card entries. Cards are `- name: '<id>
 * (<Rarity>) '` blocks carrying `m_codeId` (== item id) and `m_sellPrice`. Covers
 * weapons/outfits/junk uniformly; items without a priced card are absent from the map.
 */
export function parseSellPriceById(text) {
  const lines = splitLines(text);
  const cardRe = new RegExp(`^\\s*- name:\\s*'.+ \\((${RARITY_WORDS.join('|')})\\)\\s*'\\s*$`);
  const map = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (!cardRe.test(lines[i])) continue;
    let code = null;
    let price = null;
    for (let j = i + 1; j < lines.length && j < i + 20; j++) {
      if (/^\s*- name:/.test(lines[j])) break; // next list item
      const c = field(lines[j], 'm_codeId');
      if (c !== null) code = c;
      const p = field(lines[j], 'm_sellPrice');
      if (p !== null && /^-?\d+$/.test(p)) price = Number(p);
    }
    if (code != null && price != null && !map.has(code)) map.set(code, price);
  }
  return map;
}

/** Parse I2Languages: localization Term → first (English) Languages value. */
export function parseLocalization(text) {
  const lines = splitLines(text);
  const map = new Map();
  for (let i = 0; i < lines.length; i++) {
    const term = field(lines[i], '- Term');
    if (term === null) continue;
    // Scan forward a short window to the Languages block for this term.
    for (let j = i + 1; j < lines.length && j < i + 12; j++) {
      if (field(lines[j], '- Term') !== null) break; // next term, no Languages
      if (/^\s*Languages:\s*$/.test(lines[j])) {
        const v = lines[j + 1]?.match(/^\s*-\s?(.*?)\s*$/);
        if (v) map.set(term, unquoteYaml(v[1]));
        break;
      }
    }
  }
  return map;
}

/** Split a Unity prefab into a Map of fileID → document text (`--- !u!T &<id>` blocks). */
export function parseDocuments(text) {
  const docs = new Map();
  let id = null;
  let buf = [];
  const flush = () => {
    if (id !== null) docs.set(id, buf.join('\n'));
    buf = [];
  };
  for (const line of splitLines(text)) {
    const m = line.match(/^--- !u!\d+ &(\d+)/);
    if (m) {
      flush();
      id = m[1];
      continue;
    }
    if (id !== null) buf.push(line);
  }
  flush();
  return docs;
}

/** Ordered fileID list from a `field:` whose value is a YAML list of `- {fileID: N}`. */
export function refList(docText, fieldName) {
  const out = [];
  let inList = false;
  for (const line of splitLines(docText)) {
    if (new RegExp(`^\\s*${fieldName}:\\s*$`).test(line)) {
      inList = true;
      continue;
    }
    if (inList) {
      const m = line.match(/^\s*-\s*\{fileID:\s*(\d+)\}/);
      if (m) {
        out.push(m[1]);
        continue;
      }
      if (/^\s*\S/.test(line)) break; // next field at this indent ends the list
    }
  }
  return out;
}

/** First numeric `fieldName:` value anywhere in a document, or null. */
export function numField(docText, fieldName) {
  for (const line of splitLines(docText)) {
    const v = field(line, fieldName);
    if (v !== null && /^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);
  }
  return null;
}

/**
 * Read the sub-block that begins at `fieldName:` (a YAML mapping one indent deeper)
 * → { childKey: number } for every immediate numeric child. Stops at the first line
 * dedented to or past `fieldName`'s own indent.
 */
export function subBlockNumbers(docText, fieldName) {
  const out = {};
  let started = false;
  let indent = -1;
  for (const line of splitLines(docText)) {
    if (!started) {
      const m = line.match(new RegExp(`^(\\s*)${fieldName}:\\s*$`));
      if (m) {
        started = true;
        indent = m[1].length;
      }
      continue;
    }
    if (line.trim() && line.match(/^(\s*)/)[1].length <= indent) break;
    const m = line.match(/^\s*(m_[A-Za-z]+):\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/** Fallback readable name from an id when no localization term exists. */
export function prettify(id) {
  return id
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
}
