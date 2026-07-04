import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData } from '../../src/domain/gamedata/gameData.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import { applyLoadout } from '../../src/domain/ops/loadoutOps.ts';
import {
  bestPetForBonus,
  statKeyForSpecial,
  suggestOutfitForRoomType,
  suggestOutfitForStat,
  suggestPetForRoomType,
  suggestWeapon,
  vaultLoadoutRoomTypes,
  wastelandLoadoutRoomType,
  WASTELAND_LOADOUT_TYPE,
} from '../../src/domain/selectors/loadoutSuggest.ts';

function outfit(id: string, special: Partial<Record<string, number>>) {
  const base = { S: 0, P: 0, E: 0, C: 0, I: 0, A: 0, L: 0, ...special };
  return {
    id,
    name: id,
    category: 1,
    special: base,
    hasHelmet: false,
    rarity: 'Rare',
    sprite: 'x',
  };
}
function weapon(id: string, min: number, max: number) {
  return {
    id,
    name: id,
    damageMin: min,
    damageMax: max,
    type: 1,
    tier: 1,
    rarity: 'Rare',
    sprite: 'x',
  };
}
function pet(id: string, bonus: string, bonusMax: number) {
  return {
    id,
    name: id,
    baseName: id,
    breed: id,
    breedCode: 0,
    type: 'Dog',
    typeCode: 0,
    rarity: 'Legendary',
    rarityCode: 2,
    bonus,
    bonusCode: 0,
    bonusMin: 1,
    bonusMax,
    sprite: 'x',
    headSprite: 'x',
    poolName: 'p',
    codeId: 0,
    sellPrice: 0,
    petCarrierOdds: 0,
    descriptionLocalization: '',
    isHidden: false,
    craftOnly: false,
    lunchboxOnly: false,
    sortIndex: 0,
  };
}

function makeGameData(): GameData {
  return parseGameData({
    // Sledge has the highest MAX (24) but Plasma the highest AVERAGE (14 vs 12.5).
    weapons: [
      weapon('Pistol', 1, 3),
      weapon('Plasma', 8, 20),
      weapon('Laser', 8, 14),
      weapon('Sledge', 1, 24),
    ],
    outfits: [
      outfit('Jumpsuit', {}),
      outfit('Lucky', { L: 5 }),
      outfit('Genius', { I: 7 }),
      outfit('Horseman_DeathJacket', { P: 4, E: 4, A: 4, L: 4 }),
    ],
    junk: [],
    pets: [
      pet('collar_r', 'TrainingBoost', 15),
      pet('collar_l', 'TrainingBoost', 20),
      pet('nonstop_l', 'TrainingNonStopBoost', 30),
      pet('guard_l', 'Resistance', 50),
      pet('tank_l', 'AddMaxHP', 100),
      pet('boxer_l', 'XPBoost', 45),
    ],
    hair: [],
    enums: {},
    meta: { gameVersion: 't', unityVersion: 't', generatedAt: 't', counts: {} },
    unlockables: { recipes: [], roomUnlocks: [] },
    roomCapacity: {
      base: { resources: {}, items: 0, maxPetCount: 0, mrHandyHealth: 5000 },
      perDweller: {},
      rooms: {},
    },
    roomMetadata: {
      rooms: {
        Classroom: {
          name: 'Classroom',
          class: 'Training',
          primaryStat: 'Intelligence',
          width: 3,
          height: 1,
          maxMergeLevel: 3,
          maxLevel: 3,
          buildCost: {},
          instantBuildCost: {},
          priceFactor: 0,
          buildLocId: '',
        },
        Elevator: {
          name: 'Elevator',
          class: 'Utility',
          primaryStat: 'None',
          width: 1,
          height: 1,
          maxMergeLevel: 3,
          maxLevel: 1,
          buildCost: {},
          instantBuildCost: {},
          priceFactor: 0,
          buildLocId: '',
        },
        Entrance: {
          name: 'ENTRANCE',
          class: 'Utility',
          primaryStat: 'None',
          width: 2,
          height: 1,
          maxMergeLevel: 1,
          maxLevel: 3,
          buildCost: {},
          instantBuildCost: {},
          priceFactor: 0,
          buildLocId: '',
        },
      },
    },
    roomProduction: {
      globals: {
        taskCycle: 0.1,
        noRushResourcesMultiplier: 1,
        foodConsumptionPerDweller: 0.06,
        waterConsumptionPerDweller: 0.06,
        dwellerConsumptionPeriod: 10,
        energyConsumptionPeriod: 8,
        happinessFactorList: [],
      },
      rooms: {},
    },
    uniqueDwellers: {},
  });
}

function makeSave(): SaveData {
  return {
    dwellers: {
      dwellers: [
        {
          serializeId: 1,
          equipedWeapon: { id: 'Fist', type: 'Weapon' },
          equipedOutfit: { id: 'jumpsuit', type: 'Outfit' },
        },
        {
          serializeId: 2,
          equipedWeapon: { id: 'Fist', type: 'Weapon' },
          equipedOutfit: { id: 'jumpsuit', type: 'Outfit' },
        },
        {
          // On no room's roster - an explorer/unassigned dweller (wasteland row).
          serializeId: 3,
          equipedWeapon: { id: 'Fist', type: 'Weapon' },
          equipedOutfit: { id: 'jumpsuit', type: 'Outfit' },
        },
      ],
    },
    vault: {
      rooms: [
        { type: 'Classroom', deserializeID: 5, row: 0, col: 0, dwellers: [1, 2] },
        { type: 'Elevator', deserializeID: 6, row: 0, col: 3, dwellers: [] },
        { type: 'Entrance', deserializeID: 1, row: 0, col: 5, dwellers: [] },
      ],
    },
  } as unknown as SaveData;
}

describe('applyLoadout', () => {
  it('equips the weapon + outfit on every listed dweller in one pass', () => {
    const out = applyLoadout(makeSave(), [1, 2], { weaponId: 'Plasma', outfitId: 'Genius' });
    const [d1, d2, d3] = out.dwellers!.dwellers;
    for (const d of [d1, d2]) {
      expect(d.equipedWeapon?.id).toBe('Plasma');
      expect(d.equipedOutfit?.id).toBe('Genius');
    }
    // Dweller 3 was not listed - untouched.
    expect(d3.equipedWeapon?.id).toBe('Fist');
  });

  it('skips ids that do not resolve', () => {
    const out = applyLoadout(makeSave(), [999], { weaponId: 'Plasma' });
    expect(out.dwellers!.dwellers[0].equipedWeapon?.id).toBe('Fist');
  });
});

describe('loadout suggestions', () => {
  it('statKeyForSpecial maps ESpecialStat names', () => {
    expect(statKeyForSpecial('Intelligence')).toBe('I');
    expect(statKeyForSpecial('None')).toBeNull();
    expect(statKeyForSpecial(undefined)).toBeNull();
  });

  it('suggestOutfitForStat picks the strongest outfit for the stat', () => {
    expect(suggestOutfitForStat(makeGameData(), 'I')?.id).toBe('Genius');
    expect(suggestOutfitForStat(makeGameData(), 'L')?.id).toBe('Lucky');
  });

  it('suggestWeapon picks the best-AVERAGE-damage weapon, not the highest max', () => {
    // Sledge maxes at 24 but averages 12.5; Plasma averages 14.
    expect(suggestWeapon(makeGameData())?.id).toBe('Plasma');
  });

  it('bestPetForBonus picks the highest bonusMax among matching pets', () => {
    expect(bestPetForBonus(makeGameData(), 'TrainingBoost')?.id).toBe('collar_l');
    expect(bestPetForBonus(makeGameData(), 'NoSuchBonus')).toBeNull();
  });

  it('suggestPetForRoomType caters the pet to the room job', () => {
    const data = makeGameData();
    // Training rooms prefer the legendary-tier NonStop effect over plain TrainingBoost.
    expect(suggestPetForRoomType(data, 'Classroom')?.id).toBe('nonstop_l');
    expect(suggestPetForRoomType(data, 'Entrance')?.bonus).toBe('Resistance');
    expect(suggestPetForRoomType(data, WASTELAND_LOADOUT_TYPE)?.bonus).toBe('AddMaxHP');
    // Producing rooms → XP gain.
    expect(suggestPetForRoomType(data, 'Cafeteria')?.id).toBe('boxer_l');
    expect(suggestPetForRoomType(data, 'ScienceLab')?.bonus).toBe('XPBoost');
    expect(suggestPetForRoomType(data, 'Storage')).toBeNull(); // no catered bonus
  });

  it("suggestOutfitForRoomType overrides the Entrance with Death's Jacket", () => {
    const data = makeGameData();
    expect(suggestOutfitForRoomType(data, 'Entrance', null)?.id).toBe('Horseman_DeathJacket');
    // Stat rooms keep the stat-based pick.
    expect(suggestOutfitForRoomType(data, 'Classroom', 'I')?.id).toBe('Genius');
    // No override + no stat → nothing to suggest.
    expect(suggestOutfitForRoomType(data, 'Storage', null)).toBeNull();
  });

  it('vaultLoadoutRoomTypes lists stat rooms + the Entrance, excluding elevators', () => {
    const types = vaultLoadoutRoomTypes(makeSave(), makeGameData());
    expect(types.map((t) => t.type)).toEqual(['Classroom', 'Entrance']);
    expect(types[0]).toMatchObject({ type: 'Classroom', statKey: 'I', dwellerIds: [1, 2] });
    expect(types[1]).toMatchObject({ type: 'Entrance', statKey: null, dwellerIds: [] });
  });

  it('wastelandLoadoutRoomType gathers alive dwellers on no room roster', () => {
    const row = wastelandLoadoutRoomType(makeSave());
    expect(row).toMatchObject({ type: WASTELAND_LOADOUT_TYPE, statKey: 'E', dwellerIds: [3] });

    // Everyone rostered → no row.
    const save = makeSave();
    (save.vault!.rooms![0] as { dwellers: number[] }).dwellers = [1, 2, 3];
    expect(wastelandLoadoutRoomType(save)).toBeNull();
  });
});
