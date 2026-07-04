// weapons.json - id, display name, damage range, type, tier, rarity, sprite.
// Source: GameParameters.prefab (stats) + I2Languages.prefab (names). Verified
// field names: m_WeaponId, m_DamageMin/Max, m_weaponType, m_tier, m_NameLocalizationId,
// m_WeaponSprite. Rarity is joined from the prefab card list.
import { pathToFileURL } from 'node:url';
import { PATHS, readSource, writeOutput } from './lib/io.mjs';
import { field, parseLocalization, parseRarityById, prettify, splitLines } from './lib/prefab.mjs';

export function buildWeapons() {
  const text = readSource(PATHS.gameParams);
  const loc = parseLocalization(readSource(PATHS.i2));
  const rarityById = parseRarityById(text);

  const weapons = [];
  let cur = null;
  const flush = () => {
    if (cur) weapons.push(cur);
    cur = null;
  };

  for (const line of splitLines(text)) {
    const id = field(line, 'm_WeaponId');
    if (id !== null) {
      flush();
      cur = { id, nameLocId: '', damageMin: 0, damageMax: 0, type: 0, tier: 0, sprite: '' };
      continue;
    }
    if (!cur) continue;
    const min = field(line, 'm_DamageMin');
    if (min !== null) cur.damageMin = Number(min);
    const max = field(line, 'm_DamageMax');
    if (max !== null) cur.damageMax = Number(max);
    const type = field(line, 'm_weaponType');
    if (type !== null) cur.type = Number(type);
    const tier = field(line, 'm_tier');
    if (tier !== null) cur.tier = Number(tier);
    const nameLoc = field(line, 'm_NameLocalizationId');
    if (nameLoc !== null) cur.nameLocId = nameLoc;
    const sprite = field(line, 'm_WeaponSprite');
    // The weapon block ends at SpecialTheme; m_WeaponSprite is the last field we need.
    if (sprite !== null) cur.sprite = sprite;
  }
  flush();

  const seen = new Set();
  const out = [];
  for (const w of weapons) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    out.push({
      id: w.id,
      name: loc.get(w.nameLocId) || prettify(w.id),
      damageMin: w.damageMin,
      damageMax: w.damageMax,
      type: w.type,
      tier: w.tier,
      rarity: rarityById.get(w.id) ?? 'Normal',
      sprite: w.sprite,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

// Allow standalone run for quick iteration.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('weapons.json', buildWeapons());
}
