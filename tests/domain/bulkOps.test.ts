// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  countAffectedDwellers,
  healAll,
  makeLegendaryAll,
  maxHappinessAll,
  maxHpAll,
  maxSpecialAll,
  reviveAll,
  setBabyReadyAll,
  setLevelAll,
  setPregnantAll,
} from '../../src/domain/ops/bulkOps.ts';
import { MAX_DWELLER_HP } from '../../src/domain/ops/dwellerHealth.ts';

// Three dwellers: a healthy female, a dead male, plus an untouched sibling manager
// so every test can assert structural sharing + immutability of the input.
function makeSave(): SaveData {
  return {
    dwellers: {
      dwellers: [
        {
          serializeId: 1,
          name: 'Alice',
          gender: 1,
          rarity: 'Normal',
          happiness: { happinessValue: 40 },
          health: { healthValue: 50, maxHealth: 100, radiationValue: 0 },
          experience: { currentLevel: 5, experienceValue: 10, needLvUp: true },
          stats: { stats: [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }] },
        },
        {
          serializeId: 2,
          name: 'Bob',
          gender: 2,
          rarity: 'Normal',
          happiness: { happinessValue: 70 },
          health: { healthValue: 0, maxHealth: 80, radiationValue: 0 },
          experience: { currentLevel: 1, experienceValue: 0, needLvUp: false },
          stats: { stats: [{ value: 1 }, { value: 1 }] },
        },
        { serializeId: 3, name: 'Carol', gender: 1 },
      ],
    },
    someManagerWeNeverTouch: { nested: { a: [1, 2, 3] } },
  } as SaveData;
}

const snap = (s: SaveData): string => JSON.stringify(s);

describe('bulkOps - immutability & structural sharing', () => {
  it('never mutates the input and shares untouched managers by reference', () => {
    const before = makeSave();
    const json = snap(before);
    const after = maxHappinessAll(before, [1]);

    expect(snap(before)).toBe(json);
    expect((after as Record<string, unknown>).someManagerWeNeverTouch).toBe(
      (before as Record<string, unknown>).someManagerWeNeverTouch,
    );
    // dweller 2 untouched → shared by reference
    expect(after.dwellers?.dwellers[1]).toBe(before.dwellers?.dwellers[1]);
  });

  it('skips ids that do not resolve without throwing', () => {
    const after = maxHappinessAll(makeSave(), [999]);
    expect(after.dwellers?.dwellers[0].happiness?.happinessValue).toBe(40);
  });
});

describe('bulkOps - value ops', () => {
  it('maxSpecialAll sets all seven stats to 10', () => {
    const after = maxSpecialAll(makeSave(), [1]);
    const stats = after.dwellers?.dwellers[0].stats?.stats ?? [];
    expect(stats.slice(1, 8).map((s) => s.value)).toEqual([10, 10, 10, 10, 10, 10, 10]);
  });

  it('maxHappinessAll sets happiness to 100 for each listed dweller', () => {
    const after = maxHappinessAll(makeSave(), [1, 2]);
    expect(after.dwellers?.dwellers[0].happiness?.happinessValue).toBe(100);
    expect(after.dwellers?.dwellers[1].happiness?.happinessValue).toBe(100);
  });

  it('setLevelAll sets the clamped level, resets XP, and rescales HP from Endurance', () => {
    const after = setLevelAll(makeSave(), [1], 99);
    const d = after.dwellers?.dwellers[0];
    expect(d?.experience?.currentLevel).toBe(50);
    expect(d?.experience?.experienceValue).toBe(0);
    // Alice has Endurance 4 → 105 + 49*(2.5 + 0.5*4) = 325.5
    expect(d?.health?.maxHealth).toBeCloseTo(325.5);
  });

  it('setLevelAll folds the outfit Endurance bonus from the resolver into HP', () => {
    // +7 bonus lifts Alice (base END 4) to END 11 → 105 + 49*8 = 497
    const after = setLevelAll(makeSave(), [1], 50, () => 7);
    expect(after.dwellers?.dwellers[0].health?.maxHealth).toBe(497);
  });

  it('maxHpAll pins every dweller to the 644 max HP', () => {
    const after = maxHpAll(makeSave(), [1, 2]);
    expect(after.dwellers?.dwellers[0].health?.maxHealth).toBe(MAX_DWELLER_HP);
    expect(after.dwellers?.dwellers[0].health?.healthValue).toBe(MAX_DWELLER_HP);
    expect(after.dwellers?.dwellers[1].health?.healthValue).toBe(MAX_DWELLER_HP); // revives dead
  });

  it('makeLegendaryAll sets rarity to Legendary', () => {
    const after = makeLegendaryAll(makeSave(), [1, 2]);
    expect(after.dwellers?.dwellers[0].rarity).toBe('Legendary');
    expect(after.dwellers?.dwellers[1].rarity).toBe('Legendary');
  });
});

describe('bulkOps - health', () => {
  it('healAll restores everyone to full health, reviving the dead', () => {
    const after = healAll(makeSave(), [1, 2]);
    expect(after.dwellers?.dwellers[0].health?.healthValue).toBe(100);
    expect(after.dwellers?.dwellers[1].health?.healthValue).toBe(80);
  });

  it('reviveAll only touches the dead, leaving the living unchanged', () => {
    const after = reviveAll(makeSave(), [1, 2]);
    expect(after.dwellers?.dwellers[0].health?.healthValue).toBe(50); // alive, unchanged
    expect(after.dwellers?.dwellers[1].health?.healthValue).toBe(80); // dead → full
  });
});

describe('bulkOps - pregnancy gender gate', () => {
  it('setPregnantAll only affects females (gender 1)', () => {
    const after = setPregnantAll(makeSave(), [1, 2], true);
    expect(after.dwellers?.dwellers[0].pregnant).toBe(true);
    expect(after.dwellers?.dwellers[1].pregnant).toBeUndefined(); // male skipped
  });

  it('setBabyReadyAll only affects pregnant females not already baby-ready', () => {
    // Alice (f) pregnant → eligible; Carol (f) not pregnant → skipped; Bob (m) → skipped;
    // Dina (f) pregnant but already baby-ready → no change.
    const save = {
      dwellers: {
        dwellers: [
          { serializeId: 1, gender: 1, pregnant: true },
          { serializeId: 2, gender: 2, pregnant: true },
          { serializeId: 3, gender: 1 },
          { serializeId: 4, gender: 1, pregnant: true, babyReady: true },
        ],
      },
    } as SaveData;
    const after = setBabyReadyAll(save, [1, 2, 3, 4], true);
    expect(after.dwellers?.dwellers[0].babyReady).toBe(true); // pregnant female
    expect(after.dwellers?.dwellers[1].babyReady).toBeUndefined(); // male skipped
    expect(after.dwellers?.dwellers[2].babyReady).toBeUndefined(); // not pregnant skipped
    // Already baby-ready → untouched (shared by reference).
    expect(after.dwellers?.dwellers[3]).toBe(save.dwellers?.dwellers[3]);
  });
});

describe('bulkOps - countAffectedDwellers (toasts report what changed, not the scope)', () => {
  it('counts only dwellers an op actually modified', () => {
    const before = makeSave(); // Alice alive, Bob dead, Carol minimal
    const after = reviveAll(before, [1, 2, 3]);
    // Only Bob (dead) is revived → 1 affected, even though 3 ids were in scope.
    expect(countAffectedDwellers(before, after, [1, 2, 3])).toBe(1);
  });

  it('skips ids that do not resolve and unchanged dwellers', () => {
    const before = makeSave();
    const after = setPregnantAll(before, [1, 2, 999], true); // only Alice (female) changes
    expect(countAffectedDwellers(before, after, [1, 2, 999])).toBe(1);
  });
});
