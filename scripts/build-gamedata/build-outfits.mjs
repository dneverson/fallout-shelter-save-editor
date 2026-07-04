// outfits.json - id, name, category, SPECIAL bonuses, helmet flag, rarity, sprite, gender.
// SPECIAL is nested under m_specialStats (Strength..Luck → Value). Verified fields:
// m_outfitId, m_category, m_specialStats, m_HasHelmet, m_outfitNameLocalizationId,
// m_OutfitSprite.
//
// Gender restriction: the game holds a male mesh (m_maleOutfit) and a female mesh
// (m_femaleOutfit) per outfit; a {fileID: 0} reference means that gender has no art, so the
// outfit is locked to the other gender (e.g. dresses have m_maleOutfit: {fileID: 0}).
// Both present = unisex. These two fields precede m_outfitId within each outfit block, so we
// stash them as pending and attach them when the id line opens the entry.
import { pathToFileURL } from 'node:url';
import { PATHS, readSource, writeOutput } from './lib/io.mjs';
import { field, parseLocalization, parseRarityById, prettify, splitLines } from './lib/prefab.mjs';

const STAT_LETTER = {
  Strength: 'S',
  Perception: 'P',
  Endurance: 'E',
  Charisma: 'C',
  Intelligence: 'I',
  Agility: 'A',
  Luck: 'L',
};

export function buildOutfits() {
  const text = readSource(PATHS.gameParams);
  const loc = parseLocalization(readSource(PATHS.i2));
  const rarityById = parseRarityById(text);

  const emptySpecial = () => ({ S: 0, P: 0, E: 0, C: 0, I: 0, A: 0, L: 0 });
  const outfits = [];
  let cur = null;
  let stat = null;
  // m_maleOutfit / m_femaleOutfit precede m_outfitId, so buffer their fileIDs per block.
  let pendingMaleId = null;
  let pendingFemaleId = null;
  const flush = () => {
    if (cur) outfits.push(cur);
    cur = null;
    stat = null;
  };
  const meshFileId = (value) => {
    const m = value.match(/fileID:\s*(-?\d+)/);
    return m ? Number(m[1]) : 0;
  };

  for (const line of splitLines(text)) {
    const male = field(line, 'm_maleOutfit');
    if (male !== null) {
      pendingMaleId = meshFileId(male);
      continue;
    }
    const female = field(line, 'm_femaleOutfit');
    if (female !== null) {
      pendingFemaleId = meshFileId(female);
      continue;
    }

    const id = field(line, 'm_outfitId');
    if (id !== null) {
      flush();
      // A gender with a null (fileID 0) mesh can't wear it; both present = unisex.
      const hasMale = pendingMaleId !== 0 && pendingMaleId !== null;
      const hasFemale = pendingFemaleId !== 0 && pendingFemaleId !== null;
      const gender = hasMale && hasFemale ? null : hasFemale ? 'female' : hasMale ? 'male' : null;
      cur = {
        id,
        nameLocId: '',
        category: 0,
        special: emptySpecial(),
        hasHelmet: false,
        sprite: '',
        gender,
      };
      pendingMaleId = null;
      pendingFemaleId = null;
      continue;
    }
    if (!cur) continue;

    const statHeader = line.match(
      /^\s*(Strength|Perception|Endurance|Charisma|Intelligence|Agility|Luck):\s*$/,
    );
    if (statHeader) {
      stat = STAT_LETTER[statHeader[1]];
      continue;
    }
    const value = line.match(/^\s*Value:\s*(-?\d+)/);
    if (value && stat) {
      cur.special[stat] = Number(value[1]);
      stat = null;
      continue;
    }

    const category = field(line, 'm_category');
    if (category !== null) cur.category = Number(category);
    const nameLoc = field(line, 'm_outfitNameLocalizationId');
    if (nameLoc !== null) cur.nameLocId = nameLoc;
    const helmet = field(line, 'm_HasHelmet');
    if (helmet !== null) cur.hasHelmet = helmet === '1';
    const sprite = field(line, 'm_OutfitSprite');
    if (sprite !== null) cur.sprite = sprite;
  }
  flush();

  const seen = new Set();
  const out = [];
  for (const o of outfits) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({
      id: o.id,
      name: loc.get(o.nameLocId) || prettify(o.id),
      category: o.category,
      special: o.special,
      hasHelmet: o.hasHelmet,
      rarity: rarityById.get(o.id) ?? 'Normal',
      sprite: o.sprite,
      gender: o.gender,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('outfits.json', buildOutfits());
}
