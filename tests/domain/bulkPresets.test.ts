import { describe, expect, it } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import { healMrHandies, maxEverything } from '../../src/domain/ops/bulkPresets.ts';
import { MAX_DWELLER_HP } from '../../src/domain/ops/dwellerHealth.ts';

function makeSave(): SaveData {
  return {
    dwellers: {
      dwellers: [
        {
          serializeId: 1,
          gender: 1,
          rarity: 'Normal',
          happiness: { happinessValue: 40 },
          health: { healthValue: 0, maxHealth: 100, radiationValue: 30 }, // dead + irradiated
          experience: { currentLevel: 5, experienceValue: 9, needLvUp: true },
          stats: { stats: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }] },
        },
      ],
      actors: [
        { serializeId: 2, characterType: 2, name: 'Mr. Handy', health: 100, death: false },
        { serializeId: 3, characterType: 3, name: 'Boxer', health: 50 }, // pet, untouched
      ],
    },
    vault: {
      storage: { resources: { Food: 10, Energy: 5, Nuka: 100 } },
      rooms: [
        {
          type: 'Storage',
          deserializeID: 10,
          level: 1,
          mergeLevel: 1,
          broken: true,
          roomHealth: { damageValue: 200 },
        },
        { type: 'Elevator', deserializeID: 11, level: 1 },
      ],
    },
  } as unknown as SaveData;
}

const OPTS = {
  resourceCaps: { Food: 1600, Energy: 6400, Nuka: 999999 },
  mrHandyHealth: 5000,
  roomMaxLevel: () => 3,
};

describe('healMrHandies', () => {
  it('heals only characterType-2 actors to full + clears death', () => {
    const out = healMrHandies(makeSave(), 5000);
    const actors = out.dwellers!.actors!;
    expect(actors[0]).toMatchObject({ health: 5000, death: false });
    expect(actors[1].health).toBe(50); // pet untouched
  });

  it('is a no-op (same ref) when there are no actors', () => {
    const save = { dwellers: { dwellers: [] } } as unknown as SaveData;
    expect(healMrHandies(save, 5000)).toBe(save);
  });
});

describe('maxEverything', () => {
  it('maxes every existing entity in one pass', () => {
    const out = maxEverything(makeSave(), OPTS);
    const d = out.dwellers!.dwellers[0];
    expect(d.experience?.currentLevel).toBe(50);
    expect(d.stats?.stats.slice(1, 8).map((s) => s.value)).toEqual([10, 10, 10, 10, 10, 10, 10]);
    expect(d.happiness?.happinessValue).toBe(100);
    expect(d.health?.healthValue).toBe(MAX_DWELLER_HP); // revived + pinned to 644 max HP
    expect(d.health?.maxHealth).toBe(MAX_DWELLER_HP);
    expect(d.health?.radiationValue).toBe(0);

    expect(out.vault!.storage!.resources).toMatchObject({ Food: 1600, Energy: 6400 });
    expect(out.dwellers!.actors![0].health).toBe(5000);

    const room = out.vault!.rooms!.find((r) => r.deserializeID === 10)!;
    expect(room.level).toBe(3);
    expect(room.broken).toBe(false);
    expect(room.roomHealth?.damageValue).toBe(0);
    // Elevators are skipped (no level/repair concept).
    expect(out.vault!.rooms!.find((r) => r.deserializeID === 11)!.level).toBe(1);
  });

  it('does not mutate the input', () => {
    const before = makeSave();
    const json = JSON.stringify(before);
    maxEverything(before, OPTS);
    expect(JSON.stringify(before)).toBe(json);
  });
});
