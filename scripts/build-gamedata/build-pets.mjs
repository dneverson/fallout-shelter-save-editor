// pets.json - the full pet catalog from PetsCustomizationData.asset (m_petDataList).
//
// Each entry is one breed+rarity pet item. The game's DwellerPetItem.GenerateRandomData
// uses BonusEffectList.First(): the bonus EFFECT is LOCKED per pet id and the value
// ROLLS within [m_minValue, m_maxValue] (integer when min is whole, else float). That
// is exactly what the equip editor needs (bonus locked to breed, value within
// rarity range + out-of-range override). We resolve the EBonusEffect / EPetBreed / EPetType /
// EItemRarity codes to names via the committed enums.
//
// We capture every item field (codeId, sellPrice, petCarrierOdds, sprites, flags, …) so
// the Pets master-detail screen never has to re-parse. The untrimmed parse (incl. the
// random name pools and any multi-effect lists) is also written to scripts/extract/raw_pets.json
// for future reuse for future reuse.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { PATHS, readJson, readSource, writeOutput } from './lib/io.mjs';
import { field, parseLocalization, prettify, splitLines } from './lib/prefab.mjs';

const RARITY_WORD = { 0: 'None', 1: 'Common', 2: 'Normal', 3: 'Rare', 4: 'Legendary', 100: 'Any' };

/** Invert an enum object (name → value) into value → name, keeping the first name per value. */
function invert(enumObj) {
  const map = new Map();
  for (const [name, value] of Object.entries(enumObj ?? {})) {
    if (!map.has(value)) map.set(value, name);
  }
  return map;
}

/** Parse the m_randomNames block: PetNameList[] = { type, typeName, names[] }. */
function parseNamePools(lines, typeName) {
  const start = lines.findIndex((l) => /^\s*m_randomNames:\s*$/.test(l));
  const end = lines.findIndex((l) => /^\s*m_petDataList:\s*$/.test(l));
  if (start === -1) return [];
  const segment = lines.slice(start + 1, end === -1 ? undefined : end);

  const pools = [];
  let cur = null;
  let inPool = false;
  for (const line of segment) {
    const typeStart = line.match(/^\s*- Type:\s*(\d+)\s*$/);
    if (typeStart) {
      if (cur) pools.push(cur);
      const code = Number(typeStart[1]);
      cur = { type: code, typeName: typeName.get(code) ?? String(code), names: [] };
      inPool = false;
      continue;
    }
    if (/^\s*NamePool:\s*$/.test(line)) {
      inPool = true;
      continue;
    }
    if (inPool && cur) {
      const name = line.match(/^\s*-\s+(.*?)\s*$/);
      if (name) cur.names.push(name[1]);
    }
  }
  if (cur) pools.push(cur);
  return pools;
}

/** Parse the m_petDataList block into untrimmed raw pet entries. */
function parsePetData(lines) {
  const start = lines.findIndex((l) => /^\s*m_petDataList:\s*$/.test(l));
  const petLines = start === -1 ? lines : lines.slice(start + 1);

  const pets = [];
  let cur = null;
  let curBonus = null;
  const flush = () => {
    if (cur) pets.push(cur);
    cur = null;
    curBonus = null;
  };

  for (const line of petLines) {
    // Each PetData entry begins with `- m_id: <id>`.
    const entry = line.match(/^\s*- m_id:\s*(.*?)\s*$/);
    if (entry) {
      flush();
      cur = { id: entry[1], bonusEffects: [] };
      continue;
    }
    if (!cur) continue;

    // PetData fields.
    const firstName = field(line, 'm_firstName');
    if (firstName !== null) cur.firstName = firstName;
    const baseName = field(line, 'm_baseName');
    if (baseName !== null) cur.baseName = baseName;
    const poolName = field(line, 'm_poolName');
    if (poolName !== null) cur.poolName = poolName;
    const pieceName = field(line, 'PieceName');
    if (pieceName !== null) cur.pieceName = pieceName;
    const sortIndex = field(line, 'm_sortIndex');
    if (sortIndex !== null) cur.sortIndex = Number(sortIndex);

    // m_Item (DwellerPetItem) fields.
    const codeId = field(line, 'm_codeId');
    if (codeId !== null) cur.codeId = Number(codeId);
    const rarity = field(line, 'm_itemRarity');
    if (rarity !== null) cur.rarityCode = Number(rarity);
    const sellPrice = field(line, 'm_sellPrice');
    if (sellPrice !== null) cur.sellPrice = Number(sellPrice);
    const desc = field(line, 'm_descriptionLocalization');
    if (desc !== null) cur.descriptionLocalization = desc;
    const sprite = field(line, 'm_Sprite');
    if (sprite !== null) cur.sprite = sprite;
    const headSprite = field(line, 'm_HeadSprite');
    if (headSprite !== null) cur.headSprite = headSprite;
    const carrierOdds = field(line, 'm_petCarrierOdds');
    if (carrierOdds !== null) cur.petCarrierOdds = Number(carrierOdds);
    const type = field(line, 'm_type');
    if (type !== null) cur.typeCode = Number(type);
    const breed = field(line, 'm_breed');
    if (breed !== null) cur.breedCode = Number(breed);
    const hidden = field(line, 'm_isHiddenItem');
    if (hidden !== null) cur.isHidden = hidden === '1';
    const craftOnly = field(line, 'm_craftOnlyItem');
    if (craftOnly !== null) cur.craftOnly = craftOnly === '1';
    const lunchboxOnly = field(line, 'm_canOnlyAppearInLunchbox');
    if (lunchboxOnly !== null) cur.lunchboxOnly = lunchboxOnly === '1';

    // m_bonusEffectList - each entry starts at `- m_bonusEffect:` (a YAML list item, so
    // it carries a leading `- ` that field() won't match). We keep ALL triples in raw;
    // the app uses [0] (the game's BonusEffectList.First()).
    const bonus = line.match(/^\s*-?\s*m_bonusEffect:\s*(-?\d+)\s*$/);
    if (bonus) {
      curBonus = { code: Number(bonus[1]), min: 0, max: 0 };
      cur.bonusEffects.push(curBonus);
    }
    const min = field(line, 'm_minValue');
    if (min !== null && curBonus) curBonus.min = Number(min);
    const max = field(line, 'm_maxValue');
    if (max !== null && curBonus) curBonus.max = Number(max);
  }
  flush();
  return pets;
}

/** Shape one raw pet entry into the committed pets.json record. */
function shapePet(raw, { breedName, typeName, bonusName, loc }) {
  const first = raw.bonusEffects[0] ?? { code: 1, min: 0, max: 0 }; // 1 = EBonusEffect.None
  const breed = breedName.get(raw.breedCode) ?? String(raw.breedCode);
  // Display name = the localized breed (game's DwellerPetItem.GetName = "Pet_" + breed).
  // m_firstName / m_baseName are per-instance defaults ("Winston", "Calypso"), not the
  // breed label, so they are kept only in the raw capture.
  return {
    id: raw.id,
    name: loc.get(`Pet_${breed}`) || prettify(breed),
    baseName: raw.baseName ?? '',
    breed,
    breedCode: raw.breedCode ?? -1,
    type: typeName.get(raw.typeCode) ?? String(raw.typeCode),
    typeCode: raw.typeCode ?? -1,
    rarity: RARITY_WORD[raw.rarityCode] ?? 'Normal',
    rarityCode: raw.rarityCode ?? 2,
    bonus: bonusName.get(first.code) ?? String(first.code),
    bonusCode: first.code,
    bonusMin: first.min,
    bonusMax: first.max,
    sprite: raw.sprite ?? '',
    headSprite: raw.headSprite ?? '',
    poolName: raw.poolName ?? '',
    codeId: raw.codeId ?? -1,
    sellPrice: raw.sellPrice ?? 0,
    petCarrierOdds: raw.petCarrierOdds ?? 0,
    descriptionLocalization: raw.descriptionLocalization ?? '',
    isHidden: raw.isHidden ?? false,
    craftOnly: raw.craftOnly ?? false,
    lunchboxOnly: raw.lunchboxOnly ?? false,
    sortIndex: raw.sortIndex ?? 0,
  };
}

export function buildPets() {
  const text = readSource(PATHS.pets);
  const enums = readJson(PATHS.enums);
  const lookups = {
    breedName: invert(enums.EPetBreed),
    typeName: invert(enums.EPetType),
    bonusName: invert(enums.EBonusEffect),
    loc: parseLocalization(readSource(PATHS.i2)),
  };

  const lines = splitLines(text);
  const rawPets = parsePetData(lines);
  const namePools = parseNamePools(lines, lookups.typeName);

  // Untrimmed raw capture for future phases (written to scripts/extract/, gitignored).
  writeFileSync(
    join(PATHS.rawDir, 'raw_pets.json'),
    JSON.stringify({ pets: rawPets, namePools }, null, 2) + '\n',
    'utf8',
  );

  const seen = new Set();
  const out = [];
  for (const raw of rawPets) {
    if (!raw.id || seen.has(raw.id)) continue;
    seen.add(raw.id);
    out.push(shapePet(raw, lookups));
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('pets.json', buildPets());
}
