// enums.json - the app-relevant subset of the 442 extracted enums. The app maps
// numeric save codes (weapon type, outfit category, rarity, resources, room types,
// pet bonus/breed, etc.) to labels. Full set stays in scripts/extract/enums.json.
import { pathToFileURL } from 'node:url';
import { PATHS, readJson, writeOutput } from './lib/io.mjs';

const KEEP = [
  'EItemRarity',
  'EWeaponType',
  'EOutfitCategory',
  'EResource',
  'ERoomType',
  'EDwellerRarity',
  'ESpecialStat',
  'EBonusEffect',
  'EPetBreed',
  'EPetType',
  'ESpecialTheme',
  'Attributes',
  'EEmergencyType',
];

export function buildEnums() {
  const all = readJson(PATHS.enums);
  const out = {};
  const missing = [];
  for (const key of KEEP) {
    if (all[key]) out[key] = all[key];
    else missing.push(key);
  }
  if (missing.length) console.warn(`  (enums not found, skipped: ${missing.join(', ')})`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('enums.json', buildEnums());
}
