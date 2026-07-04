// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseGameData, type GameData } from '../../src/domain/gamedata/gameData.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  averageHappiness,
  computeAdvisor,
  happinessFactor,
} from '../../src/domain/selectors/advisorSelectors.ts';

// A vault with a single Diner (1-merge, level 1: produces Food 1, max 2 dwellers, runs
// on Strength) lets us pin the production/consumption/efficiency math to exact numbers.
const HAPPINESS_LIST = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1];

function makeGameData(): GameData {
  return parseGameData({
    weapons: [],
    outfits: [
      {
        id: 'StrSuit',
        name: 'Power Outfit',
        category: 1,
        special: { S: 2, P: 0, E: 0, C: 0, I: 0, A: 0, L: 0 },
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
      rooms: {
        Diner: { '1': { '1': { maxDwellers: 2, storage: {}, storageItems: 0 } } },
      },
    },
    roomMetadata: {
      rooms: {
        Diner: {
          name: 'Diner',
          class: 'Facility',
          primaryStat: 'Strength',
          width: 3,
          height: 1,
          maxMergeLevel: 3,
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
        happinessFactorList: HAPPINESS_LIST,
      },
      rooms: {
        Diner: {
          '1': {
            '1': {
              produced: { Food: 1, Nuka: 5 },
              reserve: { Food: 8 },
              consumption: { Energy: 0.07 },
            },
          },
        },
      },
    },
    uniqueDwellers: {},
  });
}

/** One dweller with Strength `s`, happiness `h`, assigned to room `savedRoom`. */
function dweller(id: number, s: number, h: number, savedRoom: number, outfit?: string) {
  return {
    serializeId: id,
    savedRoom,
    health: { healthValue: 100, maxHealth: 100 },
    happiness: { happinessValue: h },
    stats: {
      stats: [
        { value: 0 },
        { value: s },
        { value: 1 },
        { value: 1 },
        { value: 1 },
        { value: 1 },
        { value: 1 },
        { value: 1 },
      ],
    },
    ...(outfit ? { equipedOutfit: { id: outfit, type: 'Outfit' } } : {}),
  };
}

function makeSave(
  dwellers: ReturnType<typeof dweller>[],
  rooms: Record<string, unknown>[] = [],
): SaveData {
  return {
    dwellers: { dwellers },
    vault: { rooms, storage: { resources: { Food: 100, Water: 100, Energy: 100 } } },
  } as unknown as SaveData;
}

const diner = (deserializeID = 1, extra: Record<string, unknown> = {}) => ({
  type: 'Diner',
  deserializeID,
  row: 0,
  col: 0,
  level: 1,
  mergeLevel: 1,
  power: true,
  broken: false,
  ...extra,
});

describe('happinessFactor (replicates HappinessProductionParameters.GetIndex)', () => {
  it('returns no bonus at happiness 1 and the max at 100', () => {
    // floor(1)-1 = 0 → GetIndex short-circuits to index 0 (no bonus).
    expect(happinessFactor(1, HAPPINESS_LIST)).toBe(0);
    expect(happinessFactor(100, HAPPINESS_LIST)).toBe(0.1);
  });
  it('mid happiness maps to a mid tier (integer division)', () => {
    // floor(50)-1 = 49; 49/10 trunc = 4; +1 = 5 → list[5] = 0.05.
    expect(happinessFactor(50, HAPPINESS_LIST)).toBeCloseTo(0.05);
  });
  it('is 0 for an empty list', () => {
    expect(happinessFactor(75, [])).toBe(0);
  });
});

describe('computeAdvisor - resource economy', () => {
  it('pins production/consumption to the decompiled formulas', () => {
    // 2 max-Strength dwellers in a 2-slot Diner, happiness 100 (factor +10%). Assignment
    // is the room's `dwellers` ROSTER (savedRoom is only the physical position).
    const save = makeSave(
      [dweller(1, 10, 100, 1), dweller(2, 10, 100, 1)],
      [diner(1, { dwellers: [1, 2] })],
    );
    const report = computeAdvisor(save, makeGameData());

    const food = report.resources.find((r) => r.resource === 'Food')!;
    // efficiency = (10+10)/(2×10) × (1+0.1) = 1.1; perMin = produced(1) × 1.1 / taskCycle(0.1) = 11.
    expect(food.production).toBeCloseTo(11);
    // consumption = 2 alive × 0.06 × 60 / 10 = 0.72.
    expect(food.consumption).toBeCloseTo(0.72);
    expect(food.net).toBeCloseTo(10.28);
    expect(food.status).toBe('ok');

    // Energy: 1 powered Diner consumes 0.07 / 8 × 60 = 0.525; produces none → deficit.
    const energy = report.resources.find((r) => r.resource === 'Energy')!;
    expect(energy.production).toBe(0);
    expect(energy.consumption).toBeCloseTo(0.525);
    expect(energy.status).toBe('deficit');
  });

  it('adds the outfit SPECIAL bonus into effective stat (efficiency)', () => {
    // One dweller S8 + StrSuit(+2) = effective 10 in a 1-of-2 slot Diner, happiness 1 (no bonus).
    const save = makeSave([dweller(1, 8, 1, 1, 'StrSuit')], [diner(1, { dwellers: [1] })]);
    const report = computeAdvisor(save, makeGameData());
    const food = report.resources.find((r) => r.resource === 'Food')!;
    // efficiency = 10 / (2×10) × 1 = 0.5; perMin = 1 × 0.5 / 0.1 = 5.
    expect(food.production).toBeCloseTo(5);
    const room = report.rooms.find((r) => r.deserializeID === 1)!;
    expect(room.efficiency).toBeCloseTo(0.5);
  });

  it('counts a broken or unpowered room as producing nothing', () => {
    const save = makeSave([dweller(1, 10, 100, 1)], [diner(1, { broken: true })]);
    const report = computeAdvisor(save, makeGameData());
    expect(report.resources.find((r) => r.resource === 'Food')!.production).toBe(0);
  });
});

describe('computeAdvisor - recommendations', () => {
  it('flags a food deficit when there is no food room', () => {
    // 10 dwellers, no rooms → food consumption with zero production.
    const save = makeSave(
      Array.from({ length: 10 }, (_, i) => dweller(i + 1, 5, 90, -1)),
      [],
    );
    const report = computeAdvisor(save, makeGameData());
    const rec = report.recommendations.find((r) => r.id === 'deficit-Food');
    expect(rec).toBeDefined();
    expect(rec!.severity).toBe('high');
    expect(rec!.link.section).toBe('rooms');
  });

  it('flags an understaffed producer room with a deep-link', () => {
    // 1 of 2 roster slots filled.
    const save = makeSave([dweller(1, 10, 90, 7)], [diner(7, { dwellers: [1] })]);
    const report = computeAdvisor(save, makeGameData());
    const rec = report.recommendations.find((r) => r.id === 'understaffed-7');
    expect(rec).toBeDefined();
    expect(rec!.title).toContain('1/2');
    expect(rec!.link).toEqual({ section: 'rooms', roomId: 7 });
  });

  it('flags unassigned (at-door) dwellers and low happiness', () => {
    const save = makeSave([dweller(1, 5, 40, -1), dweller(2, 5, 40, -1)], []);
    const report = computeAdvisor(save, makeGameData());
    expect(report.recommendations.find((r) => r.id === 'idle-dwellers')!.title).toContain('2');
    expect(report.recommendations.find((r) => r.id === 'low-happiness')).toBeDefined();
    expect(report.issueCount).toBe(report.recommendations.length);
  });

  it('averageHappiness ignores the dead', () => {
    const save = makeSave([
      dweller(1, 5, 100, -1),
      {
        serializeId: 2,
        savedRoom: -1,
        health: { healthValue: 0 },
        happiness: { happinessValue: 0 },
      } as never,
    ]);
    expect(averageHappiness(save)).toBe(100);
  });
});
