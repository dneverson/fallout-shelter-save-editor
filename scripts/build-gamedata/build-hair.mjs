// hair.json - dweller hair/face/helmet customization catalog (224 pieces) from
// tools/export/ExportedProject/Assets/MonoBehaviour/DwellerCustomizationDataCatalog.asset
// (the AssetRipper export). Names resolve via I2Languages.
//
// NOTE: the save stores `hair` and `faceMask`. Which catalog key they hold
// (m_pieceName vs m_id) must be confirmed against a real save before wiring the
// hair/face edit UI, so we emit BOTH (pieceName + catalogId) here and decide later.
import { pathToFileURL } from 'node:url';
import { PATHS, readSource, writeOutput } from './lib/io.mjs';
import { parseLocalization, prettify, splitLines } from './lib/prefab.mjs';

// `Attributes` enum (scripts/extract/enums.json): None0, HairColor1, Hair2, Face3, Helmet4.
const ATTRIBUTE = { 1: 'HairColor', 2: 'Hair', 3: 'Face', 4: 'Helmet' };

// m_id/m_pieceName/m_titleTextId are string fields (e.g. m_pieceName "01" must stay a
// string, not become 1); every other scalar in this catalog is an integer.
const STRING_FIELDS = new Set(['m_id', 'm_pieceName', 'm_titleTextId']);
const coerce = (key, value) => {
  if (STRING_FIELDS.has(key)) return value;
  if (value === '') return '';
  return /^-?\d+$/.test(value) ? Number(value) : value;
};

/**
 * Parse `m_dwellerCustomizationAttributeDataList` from the MonoBehaviour .asset (Unity
 * YAML): a sequence of items, each `- m_id: …` then 4-space-indented `m_key: value` lines.
 * Stops at the next sibling field (a 2-space-indented key) after the list.
 */
function parseCustomizationList(text) {
  const lines = splitLines(text);
  const start = lines.findIndex((l) => /^\s*m_dwellerCustomizationAttributeDataList:\s*$/.test(l));
  if (start === -1) return [];
  const items = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const dash = line.match(/^  - (\w+):\s?(.*)$/);
    if (dash) {
      cur = {};
      items.push(cur);
      cur[dash[1]] = coerce(dash[1], dash[2]);
      continue;
    }
    const kv = line.match(/^    (\w+):\s?(.*)$/);
    if (kv && cur) {
      cur[kv[1]] = coerce(kv[1], kv[2]);
      continue;
    }
    if (/^\S/.test(line) || /^  \S/.test(line)) break; // dedent out of the list
  }
  return items;
}

export function buildHair() {
  const loc = parseLocalization(readSource(PATHS.i2));
  const list = parseCustomizationList(readSource(PATHS.customization));

  const out = list.map((x) => ({
    catalogId: x.m_id,
    pieceName: x.m_pieceName,
    sortId: x.m_sortId,
    name: loc.get(x.m_titleTextId) || prettify(x.m_id),
    attribute: ATTRIBUTE[x.m_attribute] ?? String(x.m_attribute),
    gender: x.m_gender, // 1 = female, 2 = male (matches save `gender`)
    price: x.m_price,
  }));
  out.sort(
    (a, b) => a.attribute.localeCompare(b.attribute) || a.catalogId.localeCompare(b.catalogId),
  );
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('hair.json', buildHair());
}
