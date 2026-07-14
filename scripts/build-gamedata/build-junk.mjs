// junk.json - id, name, rarity, value, sprite, codeId. Verified fields: m_JunkId,
// m_NameLocalizationId, m_JunkSprite. Rarity + value (m_sellPrice) + codeId (the
// Survival Guide `survivalW.junk` code - equals the id for every junk item)
// join the card list.
import { pathToFileURL } from 'node:url';
import { PATHS, readSource, writeOutput } from './lib/io.mjs';
import {
  field,
  parseCodeIdById,
  parseLocalization,
  parseRarityById,
  parseSellPriceById,
  prettify,
  splitLines,
} from './lib/prefab.mjs';

export function buildJunk() {
  const text = readSource(PATHS.gameParams);
  const loc = parseLocalization(readSource(PATHS.i2));
  const rarityById = parseRarityById(text);
  const priceById = parseSellPriceById(text);
  const codeById = parseCodeIdById(text);

  const junk = [];
  let cur = null;
  const flush = () => {
    if (cur) junk.push(cur);
    cur = null;
  };

  for (const line of splitLines(text)) {
    const id = field(line, 'm_JunkId');
    if (id !== null) {
      flush();
      cur = { id, nameLocId: '', sprite: '' };
      continue;
    }
    if (!cur) continue;
    const nameLoc = field(line, 'm_NameLocalizationId');
    if (nameLoc !== null) cur.nameLocId = nameLoc;
    const sprite = field(line, 'm_JunkSprite');
    if (sprite !== null) cur.sprite = sprite;
  }
  flush();

  const seen = new Set();
  const out = [];
  for (const j of junk) {
    if (seen.has(j.id)) continue;
    seen.add(j.id);
    out.push({
      id: j.id,
      name: loc.get(j.nameLocId) || prettify(j.id),
      rarity: rarityById.get(j.id) ?? 'Normal',
      value: priceById.get(j.id) ?? 0,
      sprite: j.sprite,
      codeId: codeById.get(j.id) ?? '',
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('junk.json', buildJunk());
}
