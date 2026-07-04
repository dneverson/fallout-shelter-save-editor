// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import { parseGameData, type GameData } from '../../src/domain/gamedata/gameData.ts';
import {
  buildRoomIndex,
  projectDwellerRow,
  readSpecial,
  selectDwellerById,
  selectDwellerRows,
} from '../../src/domain/selectors/dwellerSelectors.ts';

function makeGameData(): GameData {
  return parseGameData({
    weapons: [
      {
        id: 'Laser',
        name: 'Laser Pistol',
        damageMin: 5,
        damageMax: 7,
        type: 1,
        tier: 1,
        rarity: 'Rare',
        sprite: 'x',
      },
    ],
    outfits: [
      {
        id: 'BattleSuit',
        name: 'Battle Armor',
        category: 1,
        special: { S: 0, P: 1, E: 0, C: 0, I: 0, A: 2, L: 0 },
        hasHelmet: false,
        rarity: 'Rare',
        sprite: 'x',
      },
    ],
    junk: [],
    pets: [],
    hair: [],
    enums: {},
    meta: { gameVersion: 'x', unityVersion: 'y', generatedAt: 'z', counts: {} },
    unlockables: { recipes: [], roomUnlocks: [] },
    roomCapacity: {
      base: { resources: {}, items: 0, maxPetCount: 0, mrHandyHealth: 5000 },
      perDweller: {},
      rooms: {},
    },
    roomMetadata: { rooms: {} },
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
          name: 'Alice',
          lastName: 'Cox',
          gender: 1,
          rarity: 'Legendary',
          savedRoom: 13,
          happiness: { happinessValue: 80 },
          health: { healthValue: 0, maxHealth: 100, radiationValue: 5 },
          experience: { currentLevel: 42, experienceValue: 1, needLvUp: false },
          stats: { stats: [{ value: 1 }, { value: 5 }, { value: 6 }, { value: 7 }] },
          equipedWeapon: { id: 'Laser', type: 'Weapon' },
          equipedOutfit: { id: 'BattleSuit', type: 'Outfit' },
          equippedPet: {
            id: 'englishmastiff_l',
            type: 'Pet',
            extraData: { uniqueName: 'Rex', bonus: 'DamageBoost', bonusValue: 17 },
          },
        },
        { serializeId: 2, name: 'Bob', savedRoom: -1 },
      ],
    },
    vault: {
      rooms: [
        { type: 'LivingQuarters', deserializeID: 13, row: 0, col: 10, dwellers: [1] },
        { type: 'Entrance', deserializeID: 1, row: 0, col: 3, dwellers: [] },
      ],
    },
  } as SaveData;
}

describe('readSpecial', () => {
  it('reads stats.stats[1..7].value, defaulting missing entries to 0', () => {
    const d = makeSave().dwellers!.dwellers[0];
    expect(readSpecial(d)).toEqual({ S: 5, P: 6, E: 7, C: 0, I: 0, A: 0, L: 0 });
  });
});

describe('projectDwellerRow', () => {
  it('falls back to the raw id when no game data is supplied', () => {
    const row = projectDwellerRow(makeSave().dwellers!.dwellers[0]);
    expect(row.weapon).toEqual({ id: 'Laser', name: 'Laser', damageMin: null, damageMax: null });
    expect(row.outfit).toEqual({ id: 'BattleSuit', name: 'BattleSuit', special: null });
  });

  it('enriches weapon/outfit from game data when supplied', () => {
    const row = projectDwellerRow(makeSave().dwellers!.dwellers[0], { gameData: makeGameData() });
    expect(row.weapon).toEqual({
      id: 'Laser',
      name: 'Laser Pistol',
      damageMin: 5,
      damageMax: 7,
    });
    expect(row.outfit?.name).toBe('Battle Armor');
    expect(row.outfit?.special).toEqual({ S: 0, P: 1, E: 0, C: 0, I: 0, A: 2, L: 0 });
  });

  it('marks a dweller with healthValue <= 0 as dead', () => {
    const row = projectDwellerRow(makeSave().dwellers!.dwellers[0]);
    expect(row.isDead).toBe(true);
    expect(row.health).toBe(0);
  });

  it('parses pet breed/rarity from the id and reads instance extraData', () => {
    const row = projectDwellerRow(makeSave().dwellers!.dwellers[0]);
    expect(row.pet).toEqual({
      id: 'englishmastiff_l',
      breed: 'englishmastiff',
      rarity: 'legendary',
      uniqueName: 'Rex',
      bonus: 'DamageBoost',
      bonusValue: 17,
    });
  });

  it('returns null pet rarity for a suffix-less unique', () => {
    const d = { serializeId: 9, equippedPet: { id: 'Rollerbrain', type: 'Pet' } } as never;
    expect(projectDwellerRow(d).pet).toMatchObject({ breed: 'Rollerbrain', rarity: null });
  });

  it('resolves location by joining savedRoom to a room deserializeID', () => {
    const save = makeSave();
    const roomById = buildRoomIndex(save);
    const row = projectDwellerRow(save.dwellers!.dwellers[0], { roomById });
    expect(row.location).toEqual({
      savedRoom: 13,
      roomType: 'LivingQuarters',
      row: 0,
      col: 10,
      label: 'LivingQuarters',
    });
  });

  it('labels a door-standing dweller "At Door"', () => {
    const row = projectDwellerRow(makeSave().dwellers!.dwellers[1]);
    expect(row.location.label).toBe('At Door');
    expect(row.location.savedRoom).toBe(-1);
  });

  it('labels an unresolved room "Room <id>"', () => {
    const d = { serializeId: 5, savedRoom: 999 } as never;
    expect(projectDwellerRow(d, { roomById: new Map() }).location.label).toBe('Room 999');
  });
});

describe('selectDwellerRows / selectDwellerById', () => {
  it('projects every dweller and resolves rooms once', () => {
    const rows = selectDwellerRows(makeSave(), makeGameData());
    expect(rows).toHaveLength(2);
    expect(rows[0].location.label).toBe('LivingQuarters');
    expect(rows[0].weapon?.name).toBe('Laser Pistol');
    expect(rows[1].location.label).toBe('At Door');
  });

  it('finds a dweller by serializeId or returns undefined', () => {
    const save = makeSave();
    expect(selectDwellerById(save, 2)?.name).toBe('Bob');
    expect(selectDwellerById(save, 999)).toBeUndefined();
  });
});
