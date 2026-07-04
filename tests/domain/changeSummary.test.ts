// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import { summarizeChanges } from '../../src/domain/diff/changeSummary.ts';
import { createDwellerAtDoor, remove, setLevel, setStat } from '../../src/domain/ops/dwellerOps.ts';

function makeSave(): SaveData {
  return {
    dwellers: {
      id: 2,
      dwellers: [
        {
          serializeId: 1,
          name: 'Alice',
          lastName: 'Cox',
          gender: 1,
          rarity: 'Normal',
          happiness: { happinessValue: 50 },
          health: { healthValue: 80, maxHealth: 100, radiationValue: 0 },
          experience: { currentLevel: 5, experienceValue: 0, needLvUp: false },
          stats: { stats: [{ value: 0 }, { value: 3 }, { value: 3 }] },
        },
        { serializeId: 2, name: 'Bob', gender: 2 },
      ],
    },
    vault: { inventory: { items: [{ id: 'TeddyBear', type: 'Junk' }] } },
    appVersion: '1.0',
  } as SaveData;
}

describe('summarizeChanges', () => {
  it('reports no changes for an unedited save', () => {
    const s = makeSave();
    const summary = summarizeChanges(s, s);
    expect(summary.hasChanges).toBe(false);
    expect(summary.dwellersModified).toHaveLength(0);
  });

  it('detects an added dweller', () => {
    const before = makeSave();
    const after = createDwellerAtDoor(before, { name: 'New', lastName: 'Comer' });
    const summary = summarizeChanges(before, after);
    expect(summary.hasChanges).toBe(true);
    expect(summary.dwellersAdded).toEqual([{ serializeId: 3, name: 'New Comer' }]);
    expect(summary.dwellersRemoved).toHaveLength(0);
  });

  it('detects a removed dweller by name', () => {
    const before = makeSave();
    const after = remove(before, 1);
    const summary = summarizeChanges(before, after);
    expect(summary.dwellersRemoved).toEqual([{ serializeId: 1, name: 'Alice Cox' }]);
  });

  it('reports field-level changes on a modified dweller', () => {
    const before = makeSave();
    const after = setLevel(setStat(before, 1, 1, 10), 1, 50);
    const summary = summarizeChanges(before, after);
    expect(summary.dwellersModified).toHaveLength(1);
    const mod = summary.dwellersModified[0];
    expect(mod.serializeId).toBe(1);
    expect(mod.fields).toEqual(
      expect.arrayContaining([
        { label: 'Strength', before: '3', after: '10' },
        { label: 'Level', before: '5', after: '50' },
      ]),
    );
  });

  it('skips unchanged dwellers via structural sharing (no false field diffs)', () => {
    const before = makeSave();
    const after = setStat(before, 1, 1, 10); // only dweller 1 changes
    const summary = summarizeChanges(before, after);
    expect(summary.dwellersModified.map((m) => m.serializeId)).toEqual([1]);
  });

  it('reports an inventory item-count delta', () => {
    const before = makeSave();
    const after = {
      ...before,
      vault: { inventory: { items: [] } },
    } as SaveData;
    const summary = summarizeChanges(before, after);
    expect(summary.inventoryDelta).toEqual({ before: 1, after: 0 });
  });

  it('flags an unrelated top-level section change generically', () => {
    const before = makeSave();
    const after = { ...before, appVersion: '2.0' } as SaveData;
    const summary = summarizeChanges(before, after);
    expect(summary.otherSectionsChanged).toContain('appVersion');
  });
});
