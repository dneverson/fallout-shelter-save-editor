// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  hairLabel,
  hairOptions,
  isKnownPetId,
  isKnownWeaponId,
  normalizeRoomName,
  parseGameData,
  petBonusRange,
} from '../../src/domain/gamedata/gameData.ts';

// Validates the committed public/gamedata/*.json against the schemas. These files
// ship in the repo (not gitignored), so this runs in CI without the game export.
function load(name: string): unknown {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/gamedata', `${name}.json`), 'utf8'),
  );
}

const data = parseGameData({
  weapons: load('weapons'),
  outfits: load('outfits'),
  junk: load('junk'),
  pets: load('pets'),
  handies: load('handies'),
  hair: load('hair'),
  enums: load('enums'),
  meta: load('meta'),
  unlockables: load('unlockables'),
  roomCapacity: load('room-capacity'),
  roomMetadata: load('room-metadata'),
  roomProduction: load('room-production'),
  uniqueDwellers: load('unique-dwellers'),
});

describe('game data artifacts', () => {
  it('validates against the schemas with the expected counts', () => {
    expect(data.weapons.length).toBe(254);
    expect(data.outfits.length).toBe(215);
    expect(data.junk.length).toBe(22);
    expect(data.pets.length).toBe(130);
    expect(data.handies.length).toBe(4);
    expect(data.hair.length).toBe(224);
    expect(data.meta.counts).toMatchObject({
      weapons: 254,
      outfits: 215,
      junk: 22,
      pets: 130,
      hair: 224,
    });
  });

  it('strips stray YAML quotes + trailing spaces from weapon names', () => {
    // 4 Gauss Pistol names ship YAML-single-quoted with a trailing space in I2Languages;
    // parseLocalization must unwrap + trim them. Legit apostrophes stay intact.
    for (const w of data.weapons) {
      expect(w.name).toBe(w.name.trim());
      expect(w.name).not.toMatch(/^['"]|['"]$/);
    }
    // The 4 specific offenders are now clean (were `'Enhanced Gauss Pistol '` etc.).
    expect(data.weaponById.get('GaussPistol_Enhanced')?.name).toBe('Enhanced Gauss Pistol');
    expect(data.weaponById.get('GaussPistol_Rusty')?.name).toBe('Rusty Gauss Pistol');
    // Apostrophe names are still preserved (unquoted scalars, never wrapped).
    expect(data.weapons.some((w) => w.name.includes("'"))).toBe(true);
  });

  it('joins a sortable sell-price value onto junk', () => {
    // m_sellPrice from the prefab card list; all 22 junk are priced.
    for (const j of data.junk) expect(typeof j.value).toBe('number');
    expect(data.junkById.get('ChemistrySet')?.value).toBe(200);
    expect(data.junkById.get('AlarmClock')?.value).toBe(2);
    expect(data.junk.some((j) => j.value > 0)).toBe(true);
  });

  it('normalizes every room display name to consistent Title Case (UX-A finding 7)', () => {
    // The raw localization mixes ALL-CAPS + Title-Case; roomMetadataByType must be uniform.
    expect(data.roomMetadataByType.get('Armory')?.name).toBe('Armory');
    expect(data.roomMetadataByType.get('Energy2')?.name).toBe('Nuclear Reactor');
    expect(data.roomMetadataByType.get('NukaCola')?.name).toBe('Nuka Cola');
    // No surviving ALL-CAPS word across the whole catalog.
    for (const [, meta] of data.roomMetadataByType) {
      expect(meta.name).not.toMatch(/\b[A-Z]{2,}\b/);
    }
  });

  it('normalizeRoomName title-cases words and preserves apostrophes', () => {
    expect(normalizeRoomName('NUCLEAR REACTOR')).toBe('Nuclear Reactor');
    expect(normalizeRoomName("OVERSEER'S OFFICE")).toBe("Overseer's Office");
    expect(normalizeRoomName('Living Quarters')).toBe('Living Quarters');
    expect(normalizeRoomName('GAME ROOM')).toBe('Game Room');
  });

  it('ships the room production/consumption catalog + economy constants (Advisor)', () => {
    const rp = data.roomProduction;
    expect(Object.keys(rp.rooms).length).toBe(43);
    // Globals reverse-engineered from the production/consumption code.
    expect(rp.globals.taskCycle).toBe(0.1);
    expect(rp.globals.foodConsumptionPerDweller).toBe(0.06);
    expect(rp.globals.waterConsumptionPerDweller).toBe(0.06);
    expect(rp.globals.dwellerConsumptionPeriod).toBe(10);
    expect(rp.globals.energyConsumptionPeriod).toBe(8);
    expect(rp.globals.happinessFactorList.length).toBeGreaterThan(0);
    // A base food room produces food and consumes energy.
    expect(rp.rooms.Cafeteria['1']['1'].produced.Food).toBeGreaterThan(0);
    expect(rp.rooms.Cafeteria['1']['1'].consumption.Energy).toBeGreaterThan(0);
    // A power room produces energy.
    expect(rp.rooms.Geothermal['1']['1'].produced.Energy).toBeGreaterThan(0);
  });

  it('indexes by id and resolves known vs unknown ids', () => {
    expect(isKnownWeaponId(data, '032Pistol')).toBe(true);
    expect(isKnownWeaponId(data, 'NotARealWeapon')).toBe(false);
    expect(data.weaponById.get('032Pistol')?.name).toBe('.32 Pistol');
    expect(isKnownPetId(data, 'lykoi_l')).toBe(true);
    expect(isKnownPetId(data, 'NotARealPet')).toBe(false);
  });

  it('resolves pet bonus + value range, locked per id (cross-checked vs the live save)', () => {
    // lykoi_l rolled DamageBoost=6 in Vault1.sav; range is exactly [6,6].
    expect(petBonusRange(data, 'lykoi_l')).toEqual({
      bonus: 'DamageBoost',
      min: 6,
      max: 6,
      integer: true,
    });
    // persian_l rolled HappinessBoost=95 in-save, within [91,100].
    const persian = petBonusRange(data, 'persian_l');
    expect(persian?.bonus).toBe('HappinessBoost');
    expect(95).toBeGreaterThanOrEqual(persian!.min);
    expect(95).toBeLessThanOrEqual(persian!.max);
    expect(petBonusRange(data, 'NotARealPet')).toBeNull();
  });

  it('parses nested outfit SPECIAL bonuses', () => {
    expect(data.outfitById.get('AbrahamSpecial')?.special).toEqual({
      S: 0,
      P: 0,
      E: 1,
      C: 0,
      I: 2,
      A: 2,
      L: 2,
    });
  });

  it('ships the enum subset the app needs', () => {
    expect(data.enums.EItemRarity).toMatchObject({ Normal: 2, Rare: 3, Legendary: 4 });
    expect(Object.keys(data.enums.EWeaponType).length).toBeGreaterThan(10);
  });

  it('ships per-room metadata (footprint / merge / primary stat / cost) for the build palette', () => {
    // Storage = 1-room facility, mergeable to 3, primary Endurance, 300 Nuka.
    const storage = data.roomMetadataByType.get('Storage');
    expect(storage).toMatchObject({
      class: 'Facility',
      primaryStat: 'Endurance',
      width: 3,
      maxMergeLevel: 3,
      maxLevel: 3,
    });
    expect(storage?.buildCost.Nuka).toBe(300);
    // Crafting rooms are inherently 3-wide (9 col-units); Casino trains Luck.
    expect(data.roomMetadataByType.get('WeaponFactory')?.width).toBe(9);
    expect(data.roomMetadataByType.get('Casino')?.primaryStat).toBe('Luck');
    // Elevators are 1-unit wide and don't level.
    expect(data.roomMetadataByType.get('Elevator')).toMatchObject({ width: 1, maxLevel: 1 });
  });
});

describe('hair/face pickers', () => {
  it('indexes hair by pieceName - the value stored in the save', () => {
    // Save values like "03" / "Kellogg_hair" map to catalog pieceName, not catalogId.
    expect(data.hairByPiece.has('03')).toBe(true);
    expect(data.hairByPiece.has('Kellogg_hair')).toBe(true);
    expect(hairLabel(data, 'Kellogg_hair')).toBe(data.hairByPiece.get('Kellogg_hair')?.name);
    expect(hairLabel(data, 'not_a_real_piece')).toBe('not_a_real_piece'); // raw fallback
  });

  it('splits options by attribute (Hair vs Face) keyed on pieceName', () => {
    // pieceName isn't unique across attributes, so check membership in the attribute's
    // own pieceName set rather than the last-wins hairByPiece index.
    const namesWith = (attribute: string): Set<string> =>
      new Set(data.hair.filter((h) => h.attribute === attribute).map((h) => h.pieceName));
    const hairNames = namesWith('Hair');
    const faceNames = namesWith('Face');
    const hair = hairOptions(data, 'hair');
    const face = hairOptions(data, 'face');
    expect(hair.every((o) => hairNames.has(o.value))).toBe(true);
    expect(face.every((o) => faceNames.has(o.value))).toBe(true);
    expect(hair.length).toBeGreaterThan(0);
    expect(face.length).toBeGreaterThan(0);
  });

  it('filters by SAVE gender (catalog gender is inverted)', () => {
    // Catalog gender is 1=Male/2=Female; save gender is 1=Female/2=Male. A female
    // dweller (save gender 1) must NOT be offered male-only beard "Kellogg_beard".
    const femaleFaces = hairOptions(data, 'face', 1).map((o) => o.value);
    const maleFaces = hairOptions(data, 'face', 2).map((o) => o.value);
    expect(maleFaces).toContain('Kellogg_beard');
    expect(femaleFaces).not.toContain('Kellogg_beard');
  });

  it('deduplicates pieceName collisions across genders when unfiltered', () => {
    const all = hairOptions(data, 'face').map((o) => o.value);
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
  });
});
