// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import { summarizeChanges } from '../../src/domain/diff/changeSummary.ts';
import { createDwellerAtDoor, remove, setLevel, setStat } from '../../src/domain/ops/dwellerOps.ts';
import { LosslessInt } from '../../src/domain/codec/losslessJson.ts';
import {
  completeRoomTimersNow,
  fastForwardVault,
  setDeathclawEnabled,
} from '../../src/domain/ops/timerOps.ts';

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

describe('timer edits in the change review', () => {
  it('surfaces a deathclaw toggle as manager leaves + a new task entry', () => {
    const original: SaveData = {
      taskMgr: { id: 100, time: 5_000, tasks: [] },
      DeathclawManager: { canDeathclawEmergencyOccurs: true, deathclawCooldownID: -1 },
    } as SaveData;
    const edited = setDeathclawEnabled(original, false);
    const summary = summarizeChanges(original, edited);
    const paths = summary.otherChanges.map((c) => c.path);
    expect(paths).toContain('DeathclawManager.canDeathclawEmergencyOccurs');
    expect(paths).toContain('DeathclawManager.deathclawCooldownID');
    expect(paths.some((p) => p.startsWith('taskMgr.tasks[0]'))).toBe(true);
  });

  it('surfaces a global fast-forward with exact tick literals', () => {
    const original: SaveData = {
      timeMgr: { timeSaveDate: new LosslessInt('639162074156879513') },
    } as SaveData;
    const edited = fastForwardVault(original, 86_400);
    const summary = summarizeChanges(original, edited);
    const change = summary.otherChanges.find((c) => c.path === 'timeMgr.timeSaveDate');
    expect(change).toBeDefined();
    expect(change?.before).toBe('639162074156879513');
    expect(change?.after).toBe((639162074156879513n - 864_000_000_000n).toString());
  });

  it('surfaces a crafting finish via the room extractor', () => {
    const original: SaveData = {
      taskMgr: {
        id: 100,
        time: 5_000,
        tasks: [{ startTime: 4_000, endTime: 9_000, id: 50, paused: false }],
      },
      vault: {
        rooms: [
          {
            type: 'WeaponFactory',
            deserializeID: 12,
            class: 'Crafting',
            currentState: { taskId: 50 },
            CompletedTime: 120,
          },
        ],
      },
    } as SaveData;
    const edited = completeRoomTimersNow(original, 12);
    const summary = summarizeChanges(original, edited);
    const room = summary.roomsModified.find((r) => r.label === 'WeaponFactory #12');
    expect(room?.fields).toContainEqual({
      label: 'Crafting progress (s)',
      before: '120',
      after: '1000000000',
    });
  });
});
