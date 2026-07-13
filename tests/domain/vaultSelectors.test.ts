// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { RoomCapacity } from '../../src/domain/gamedata/schemas.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  computeItemCapacity,
  computePopulationCap,
  computeResourceCaps,
  dwellerCount,
  vaultMetrics,
} from '../../src/domain/selectors/vaultSelectors.ts';

// A tiny catalog mirroring the real shape: base maxima, a per-dweller consumable cap,
// and two rooms (a water producer + a storage room) with per-(mergeLevel, level) values.
const catalog: RoomCapacity = {
  base: {
    resources: { Food: 0, Water: 0, Energy: 0, Nuka: 999999, StimPack: 5 },
    items: 10,
    maxPetCount: 100,
    mrHandyHealth: 5000,
  },
  perDweller: { StimPack: 25 },
  rooms: {
    WaterPlant: {
      '1': {
        '1': { maxDwellers: 2, storage: { Water: 50 }, storageItems: 0 },
        '2': { maxDwellers: 2, storage: { Water: 75 }, storageItems: 0 },
      },
    },
    Storage: {
      '1': {
        '1': { maxDwellers: 2, storage: {}, storageItems: 10 },
        '3': { maxDwellers: 2, storage: {}, storageItems: 25 },
      },
    },
    // Real in-game values: only living quarters carry populationIncrease.
    LivingQuarters: {
      '1': {
        '1': { maxDwellers: 2, storage: {}, storageItems: 0, populationIncrease: 8 },
        '2': { maxDwellers: 2, storage: {}, storageItems: 0, populationIncrease: 10 },
      },
      '3': {
        '3': { maxDwellers: 6, storage: {}, storageItems: 0, populationIncrease: 40 },
      },
    },
  },
};

function makeSave(): SaveData {
  return {
    dwellers: { dwellers: [{ serializeId: 1 }, { serializeId: 2 }, { serializeId: 3 }] },
    vault: {
      rooms: [
        { type: 'WaterPlant', deserializeID: 1, mergeLevel: 1, level: 2 },
        { type: 'Storage', deserializeID: 2, mergeLevel: 1, level: 3 },
        { type: 'FakeWasteland', deserializeID: 3, mergeLevel: 1, level: 1 }, // not in catalog → 0
      ],
    },
  } as SaveData;
}

describe('vaultSelectors', () => {
  it('counts dwellers', () => {
    expect(dwellerCount(makeSave())).toBe(3);
  });

  it('computes resource caps = base + room storage + per-dweller scaling', () => {
    const caps = computeResourceCaps(makeSave(), catalog);
    expect(caps.Water).toBe(75); // base 0 + WaterPlant L2 (75)
    expect(caps.Nuka).toBe(999999); // fixed base, no room contribution
    expect(caps.StimPack).toBe(5 + 25 * 3); // base 5 + 25 per dweller × 3 = 80
    expect(caps.Food).toBe(0);
  });

  it('computes item capacity = base + storage-room contributions', () => {
    expect(computeItemCapacity(makeSave(), catalog)).toBe(10 + 25); // base 10 + Storage L3 (25)
  });

  it('ignores rooms missing from the catalog or lacking merge/level', () => {
    const save = { vault: { rooms: [{ type: 'Unknown', deserializeID: 9 }] } } as SaveData;
    expect(computeItemCapacity(save, catalog)).toBe(10);
    expect(computeResourceCaps(save, catalog).Water).toBe(0);
  });

  it('computes the population cap = Σ living-quarters populationIncrease', () => {
    const save = {
      vault: {
        rooms: [
          { type: 'LivingQuarters', deserializeID: 1, mergeLevel: 1, level: 2 }, // 10
          { type: 'LivingQuarters', deserializeID: 2, mergeLevel: 3, level: 3 }, // 40
          { type: 'WaterPlant', deserializeID: 3, mergeLevel: 1, level: 1 }, // no contribution
        ],
      },
    } as SaveData;
    expect(computePopulationCap(save, catalog)).toBe(50);
  });

  it('population cap is 0 with no living quarters and clamps at the 200 ceiling', () => {
    expect(computePopulationCap(makeSave(), catalog)).toBe(0);

    const maxed = {
      vault: {
        // 6 × 40 = 240 raw → clamped to the game's hard 200 ceiling.
        rooms: Array.from({ length: 6 }, (_, i) => ({
          type: 'LivingQuarters',
          deserializeID: i + 1,
          mergeLevel: 3,
          level: 3,
        })),
      },
    } as SaveData;
    expect(computePopulationCap(maxed, catalog)).toBe(200);
  });

  it('vaultMetrics uses the catalog-derived cap, falling back to 200 without one', () => {
    const save = {
      dwellers: { dwellers: [{ serializeId: 1, health: { healthValue: 100 } }] },
      vault: {
        rooms: [{ type: 'LivingQuarters', deserializeID: 1, mergeLevel: 1, level: 1 }], // 8
      },
    } as unknown as SaveData;
    expect(vaultMetrics(save, catalog).populationCap).toBe(8);
    expect(vaultMetrics(save).populationCap).toBe(200);
  });
});
