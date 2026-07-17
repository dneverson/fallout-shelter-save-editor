// unique-dwellers.json - the special/legendary named-character catalog.
//
// TWO consumers:
//  1) family viewer - resolves `ascendants` that are UNIQUE
//     dwellers. A dweller's family is stored as AscendancyIDs; a unique dweller's
//     AscendancyID is a per-character `m_serializedUniqueAscendancyId` (negative) that
//     the save does NOT store inline (the save only keeps the unique-id STRING, e.g.
//     "L_Max"). This catalog maps that string → ascendancy id + display name.
//  2) The "Add special/legendary dweller" op. A special named dweller is a
//     REGULAR Dweller in save.dwellers.dwellers[] carrying a `uniqueData` string -
//     NOT an actors[] entry. To instantiate one we replicate Dweller.SetUniqueCustomization
//     (Assembly-CSharp): apply the catalog's hair / faceMask / skin+hair colors /
//     outfit id / weapon id / SPECIAL / gender, then set `uniqueData` to the id string.
//     This file therefore carries the FULL UniqueDwellerData shape, save-ready.
//
// Source (our own v2.4.1 export): MonoBehaviour/*.asset ScriptableObjects of type
// UniqueDwellerData (m_Name == the save's `uniqueData` string). Hair/faceMask are
// fileID+guid references to DwellerHair/DwellerFaceMask piece assets; the save stores
// the piece's `m_Name` (e.g. save `hair:"03"` == piece asset m_Name "03"), so we
// resolve the referenced file-.meta guid → that asset's m_Name.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PATHS, readSource, writeOutput } from './lib/io.mjs';
import { field, splitLines } from './lib/prefab.mjs';

/** A UniqueDwellerData asset declares m_serializedUniqueAscendancyId. */
const isUniqueDwellerAsset = (text) => /^\s*m_serializedUniqueAscendancyId:/m.test(text);

/** First string value of `key:` in a doc (trimmed, '' if absent/empty). */
function strField(text, key) {
  for (const line of splitLines(text)) {
    const v = field(line, key);
    if (v !== null) return v;
  }
  return '';
}

/** First numeric value of `key:` in a doc, or fallback. */
function intField(text, key, fallback) {
  for (const line of splitLines(text)) {
    const v = field(line, key);
    if (v !== null && /^-?\d+$/.test(v)) return Number(v);
  }
  return fallback;
}

/** `m_someFlag: 1` → true. */
const boolField = (text, key) => intField(text, key, 0) === 1;

/** The guid in a `key: {fileID: N, guid: ..., type: ...}` reference, or null if fileID 0. */
function refGuid(text, key) {
  for (const line of splitLines(text)) {
    const m = line.match(new RegExp(`^\\s*${key}:\\s*\\{([^}]*)\\}`));
    if (!m) continue;
    if (/fileID:\s*0\b/.test(m[1]) && !/guid:/.test(m[1])) return null;
    const g = m[1].match(/guid:\s*([0-9a-f]+)/);
    return g ? g[1] : null;
  }
  return null;
}

/**
 * Color `key: {r: .., g: .., b: .., a: ..}` (floats 0..1) → uint32 ARGB (0xAARRGGBB),
 * matching the save format + the app's ColorField convention.
 */
function colorField(text, key) {
  for (const line of splitLines(text)) {
    const m = line.match(new RegExp(`^\\s*${key}:\\s*\\{([^}]*)\\}`));
    if (!m) continue;
    const ch = (c) => {
      const v = m[1].match(new RegExp(`\\b${c}:\\s*(-?\\d+(?:\\.\\d+)?)`));
      return v ? Math.max(0, Math.min(255, Math.round(parseFloat(v[1]) * 255))) : 255;
    };
    return ((ch('a') << 24) | (ch('r') << 16) | (ch('g') << 8) | ch('b')) >>> 0;
  }
  return 0xffffffff;
}

/** Read the m_stats sub-block → [S,P,E,C,I,A,L] (1..10), defaulting absent stats to 1. */
function specialStats(text) {
  const keys = [
    'm_strength',
    'm_perception',
    'm_endurance',
    'm_charisma',
    'm_intelligence',
    'm_agility',
    'm_luck',
  ];
  return keys.map((k) => intField(text, k, 1));
}

/** EGender (Any 0 / Male 1 / Female 2) → save gender (1 = female, 2 = male). */
const saveGender = (eGender) => (eGender === 2 ? 1 : 2);

/**
 * Build a guid → m_Name map for every MonoBehaviour `.asset` (file-.meta guid → the
 * asset's ScriptableObject name). Used to resolve hair/faceMask piece references to the
 * `m_Name` the save stores. Unique per file, so no collisions.
 */
function buildGuidToName() {
  const map = new Map();
  for (const file of readdirSync(PATHS.monoBehaviourDir)) {
    if (!file.endsWith('.asset.meta')) continue;
    const metaText = readFileSync(join(PATHS.monoBehaviourDir, file), 'utf8');
    const g = metaText.match(/^\s*guid:\s*([0-9a-f]+)/m);
    if (!g) continue;
    const assetText = readFileSync(join(PATHS.monoBehaviourDir, file.slice(0, -5)), 'utf8');
    const name = strField(assetText, 'm_Name');
    if (name) map.set(g[1], name);
  }
  return map;
}

/**
 * uniqueId -> EDwellerRarity word, from DwellerManager.prefab's CURATED m_rareDwellers /
 * m_legendaryDwellers arrays.
 *
 * Rarity is NOT a field on the UniqueDwellerData asset - DwellerManager.IsDataLegendary /
 * IsDataRare answer it by membership of these two arrays, and GetRandomRareDweller draws from
 * m_rareDwellers. So the quest engine's RandomRareDweller pool can only be reconstructed from
 * here. Anything in neither array is an ordinary special character, not lottery-tier loot.
 */
function buildRarityById(guidToName) {
  const text = readSource(`${PATHS.gameObjectDir}/DwellerManager.prefab`);
  const rarityById = new Map();
  for (const [key, rarity] of [
    ['m_rareDwellers', 'Rare'],
    ['m_legendaryDwellers', 'Legendary'],
  ]) {
    const start = text.indexOf(`${key}:`);
    if (start < 0) throw new Error(`DwellerManager.prefab: ${key} not found`);
    // The array ends at the next sibling key (two-space indent); guids inside are its entries.
    const rest = text.slice(start + key.length);
    const end = rest.search(/\n {2}\w/);
    const block = end > 0 ? rest.slice(0, end) : rest;
    for (const m of block.matchAll(/guid:\s*([0-9a-f]{32})/g)) {
      const name = guidToName.get(m[1]);
      if (name) rarityById.set(name, rarity);
    }
  }
  return rarityById;
}

export function buildUniqueDwellers() {
  const guidToName = buildGuidToName();
  const pieceName = (guid) => (guid ? (guidToName.get(guid) ?? null) : null);
  const rarityById = buildRarityById(guidToName);

  const out = {};
  for (const file of readdirSync(PATHS.monoBehaviourDir)) {
    if (!file.endsWith('.asset')) continue;
    const text = readSource(`${PATHS.monoBehaviourDir}/${file}`);
    if (!isUniqueDwellerAsset(text)) continue;
    // m_Name is the ScriptableObject name == the save's dweller.uniqueData string.
    const uniqueId = strField(text, 'm_Name');
    if (!uniqueId || out[uniqueId]) continue; // first asset per id wins
    out[uniqueId] = {
      ascendancyId: intField(text, 'm_serializedUniqueAscendancyId', -1),
      name: strField(text, 'm_name'),
      lastName: strField(text, 'm_lastName'),
      // Full customization (replicates Dweller.SetUniqueCustomization).
      gender: saveGender(intField(text, 'm_gender', 1)),
      hair: pieceName(refGuid(text, 'm_hairPiece')),
      faceMask: pieceName(refGuid(text, 'm_facemask')),
      outfitId: strField(text, 'm_outfitItemId'),
      weaponId: strField(text, 'm_weaponItemId'),
      skinColor: colorField(text, 'm_skinColor'),
      hairColor: colorField(text, 'm_hairColor'),
      stats: specialStats(text),
      // Lottery tier (see buildRarityById). "Normal" == in neither curated array.
      rarity: rarityById.get(uniqueId) ?? 'Normal',
      // IsHiddenDweller characters are excluded from the random-rare draw (GetRareDwellers).
      isHidden: boolField(text, 'm_isHiddenDweller'),
      isInfertile: boolField(text, 'm_isInfertile'),
      // m_randomBody → the game randomizes appearance at spawn (ignores asset hair/
      // skin/face); the add-op falls back to neutral defaults for those characters.
      randomBody: boolField(text, 'm_randomBody'),
      randomName: boolField(text, 'm_randomName'),
    };
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('unique-dwellers.json', buildUniqueDwellers());
}
