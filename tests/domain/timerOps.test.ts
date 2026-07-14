// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import { LosslessInt, stringifyLossless } from '../../src/domain/codec/losslessJson.ts';
import {
  DISABLE_BLOCKER_SECONDS,
  findTask,
  formatDuration,
  fromTicks,
  isValidTaskId,
  taskRemainingSeconds,
  ticksFromUnixMs,
  toTicks,
} from '../../src/domain/tasks/taskLookup.ts';
import {
  cancelBabyDelivery,
  completeRoomTimersNow,
  completeTaskNow,
  completeTrainingSlotNow,
  deathclawState,
  deliverBabyNow,
  dwellerTimers,
  fastForwardTeam,
  fastForwardVault,
  growUpChildNow,
  isBottleAndCappyEnabled,
  isProductionAwaitingCollect,
  dailyRewardStatus,
  makeDailyRewardsClaimable,
  MAX_FAST_FORWARD_SECONDS,
  MAX_PENDING_CHILDREN,
  pregnancyPendingChildren,
  roomTimers,
  setPendingChildren,
  setBottleAndCappyEnabled,
  setDeathclawEnabled,
  vaultClockAheadSeconds,
  wastelandTeams,
} from '../../src/domain/ops/timerOps.ts';

// Real timeSaveDate literal from a decrypted Vault1.sav (~6.4e17, beyond 2^53).
const SAVE_DATE_LITERAL = '639162074156879513';

// Vault clock at 300000s with a representative task set + an untouched sibling
// manager so every test can assert structural sharing.
function makeSave(): SaveData {
  return {
    timeMgr: {
      time: 300_000,
      gameTime: 107_000,
      timeSaveDate: new LosslessInt(SAVE_DATE_LITERAL),
      timeGameBegin: new LosslessInt('639159047064069400'),
    },
    taskMgr: {
      id: 54_000,
      time: 300_000,
      tasks: [
        { startTime: 295_000, endTime: 305_800, id: 501, paused: false, rescheduleToOldest: true }, // pregnancy
        { startTime: 290_000, endTime: 310_000, id: 502, paused: false, rescheduleToOldest: true }, // child grow-up
        { startTime: 299_000, endTime: 302_600, id: 503, paused: false, rescheduleToOldest: true }, // production cycle
        { startTime: 280_000, endTime: 320_000, id: 504, paused: false, rescheduleToOldest: true }, // crafting cycle
        { startTime: 295_000, endTime: 301_000, id: 505, paused: false, rescheduleToOldest: true }, // training slot
        { startTime: 298_546, endTime: 302_146, id: 506, paused: false, rescheduleToOldest: true }, // radio cycle
        { startTime: 299_900, endTime: 300_500, id: 507, paused: false, rescheduleToOldest: true }, // rush decay
      ],
      pausedTasks: [{ startTime: 0, endTime: 100, id: 900, paused: true }],
    },
    dwellers: {
      dwellers: [
        { serializeId: 111, name: 'Mother', gender: 1, pregnant: true, babyReady: false },
        { serializeId: 130, name: 'Kid', gender: 2 },
      ],
    },
    DeathclawManager: {
      deathclawTotalExtraChance: 0.2,
      canDeathclawEmergencyOccurs: true,
      deathclawCooldownID: -1,
    },
    BottleAndCappyMgrSerializeKey: {
      SerializeAccumulatedTriggerChance: 0.1,
      SerializeLocked: false,
    },
    dayToDayRewardMgr: {
      states: [
        { type: 5, next: 4_102_444_800_000 }, // future
        { type: 7, next: 1 }, // already claimable
      ],
    },
    vault: {
      rooms: [
        {
          type: 'LivingQuarters',
          deserializeID: 10,
          partners: [
            { m: 79, f: 111, s: 'RaisingBaby', t: 501 },
            { m: 80, f: 112, s: 'Married', t: -1 },
          ],
          children: [{ taskID: 502, dwellerID: 130, notificationID: -1 }],
        },
        {
          type: 'WaterPlant',
          deserializeID: 11,
          class: 'Facility',
          currentStateName: 'Working',
          currentState: { taskId: 503 },
          rushTask: 507,
        },
        {
          type: 'WeaponFactory',
          deserializeID: 12,
          class: 'Crafting',
          currentStateName: 'Working',
          currentState: { taskId: 504 },
          CompletedTime: 11_382.98,
          CraftingItemId: 'MissileLauncher',
        },
        {
          type: 'Armory',
          deserializeID: 13,
          class: 'Training',
          slots: [
            { dwellerID: 52, taskID: 505 },
            { dwellerID: 53, taskID: -2 },
          ],
        },
        {
          type: 'Radio',
          deserializeID: 14,
          class: 'Facility',
          currentState: { taskId: 506, remainingTime: 1_453.98, estimatedTime: 3_600 },
        },
        { type: 'Storage', deserializeID: 15 },
        {
          // Full reactor: staffed, output buffered, NO cycle task (waiting to collect).
          type: 'Energy2',
          deserializeID: 16,
          class: 'Facility',
          currentStateName: 'Idle',
          currentState: {},
          dwellers: [21, 22],
          storage: { resources: { Nuka: 10, Energy: 85, Water: 0 } },
        },
        {
          // Staffed but empty output and no task - nothing to report.
          type: 'Water2',
          deserializeID: 17,
          class: 'Facility',
          dwellers: [23],
          storage: { resources: { Water: 0, Nuka: 0 } },
        },
      ],
      wasteland: {
        teams: [
          {
            dwellers: [7, 8],
            status: 'Exploring',
            elapsedTimeAliveExploring: 5_000,
            elapsedReturningTime: 0,
            returnTripDuration: 2_500,
          },
          {
            dwellers: [9],
            status: 'ReturningToVault',
            elapsedTimeAliveExploring: 9_000,
            elapsedReturningTime: 1_000,
            returnTripDuration: 4_500,
          },
          { dwellers: [4], status: 'ReturnedToVault' },
        ],
      },
    },
    someManagerWeNeverTouch: { nested: { a: [1, 2, 3] } },
  } as SaveData;
}

// LosslessInt instances survive JSON.stringify as `{"literal": …}`-less empty objects,
// so snapshots go through stringifyLossless (exact literal text) instead.
const snap = (s: SaveData): string => stringifyLossless(s);

describe('taskLookup', () => {
  it('validates task ids (sentinels -1/-2/-32768/0/undefined are invalid)', () => {
    expect(isValidTaskId(501)).toBe(true);
    for (const bad of [-1, -2, -32_768, 0, undefined]) expect(isValidTaskId(bad)).toBe(false);
  });

  it('finds tasks in both live and paused lists', () => {
    const save = makeSave();
    expect(findTask(save, 501)?.endTime).toBe(305_800);
    expect(findTask(save, 900)?.paused).toBe(true);
    expect(findTask(save, 999)).toBeNull();
    expect(findTask(save, -1)).toBeNull();
  });

  it('computes remaining seconds against the task clock, floored at 0', () => {
    const save = makeSave();
    expect(taskRemainingSeconds(save, 501)).toBe(5_800);
    expect(taskRemainingSeconds(save, 900)).toBe(0); // long past
    expect(taskRemainingSeconds(save, 999)).toBeNull();
  });

  it('ceils fractional remainders: a still-running task never reads 0', () => {
    // Task times in real saves are floats ("44190.37"); a 0.3s remainder must
    // count as 1s so UI done-states (remaining <= 0) match what the row displays.
    const base = makeSave();
    const save: SaveData = {
      ...base,
      taskMgr: {
        ...base.taskMgr,
        tasks: [
          ...(base.taskMgr?.tasks ?? []),
          { startTime: 299_000, endTime: 300_000.3, id: 508, paused: false },
        ],
      },
    };
    expect(taskRemainingSeconds(save, 508)).toBe(1);
  });

  it('formats durations with the two largest units', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(185)).toBe('3m 5s');
    expect(formatDuration(3_660)).toBe('1h 1m');
    expect(formatDuration(2 * 86_400 + 3 * 3_600)).toBe('2d 3h');
    expect(formatDuration(-5)).toBe('0s');
    // Countdown convention: fractional input ceils, "0s" means a true zero only.
    expect(formatDuration(0.4)).toBe('1s');
    expect(formatDuration(0)).toBe('0s');
  });

  it('converts ticks exactly (BigInt) and re-boxes by the containment rule', () => {
    expect(toTicks(new LosslessInt(SAVE_DATE_LITERAL))).toBe(639162074156879513n);
    expect(toTicks(12_345)).toBe(12345n);
    expect(toTicks(undefined)).toBeNull();
    expect(toTicks(1.5)).toBeNull();
    // Out of safe range stays a LosslessInt with the exact literal.
    const big = fromTicks(639162074156879513n);
    expect(big).toBeInstanceOf(LosslessInt);
    expect((big as LosslessInt).literal).toBe(SAVE_DATE_LITERAL);
    // In safe range becomes a native number.
    expect(fromTicks(42n)).toBe(42);
  });

  it('maps Unix ms to .NET ticks (epoch offset)', () => {
    expect(ticksFromUnixMs(0)).toBe(621_355_968_000_000_000n);
    expect(ticksFromUnixMs(1_000)).toBe(621_355_968_010_000_000n);
  });
});

describe('timerOps - fastForwardVault', () => {
  it('subtracts exact ticks from timeSaveDate (BigInt, no float drift)', () => {
    const save = makeSave();
    const next = fastForwardVault(save, 86_400); // +1 day
    const value = next.timeMgr?.timeSaveDate;
    expect(value).toBeInstanceOf(LosslessInt);
    expect((value as LosslessInt).literal).toBe(
      (639162074156879513n - 864_000_000_000n).toString(),
    );
    // Only timeMgr changes; siblings shared; original untouched.
    expect(next.taskMgr).toBe(save.taskMgr);
    expect(next.someManagerWeNeverTouch).toBe(save.someManagerWeNeverTouch);
    expect(snap(save)).toBe(snap(makeSave()));
  });

  it('emits the literal as a bare integer through stringifyLossless', () => {
    const next = fastForwardVault(makeSave(), 1);
    expect(stringifyLossless(next)).toContain(
      `"timeSaveDate":${639162074156879513n - 10_000_000n}`,
    );
  });

  it('accepts a plain-number timeSaveDate and stays a number while safe', () => {
    const save = { timeMgr: { timeSaveDate: 9_000_000_000 } } as SaveData;
    const next = fastForwardVault(save, 10);
    expect(next.timeMgr?.timeSaveDate).toBe(9_000_000_000 - 100_000_000);
  });

  it('clamps: zero/negative/absent timeSaveDate are no-ops; huge values cap at 10 years', () => {
    const save = makeSave();
    expect(fastForwardVault(save, 0)).toBe(save);
    expect(fastForwardVault(save, -5)).toBe(save);
    expect(fastForwardVault({} as SaveData, 100)).toEqual({});
    const capped = fastForwardVault(save, Number.MAX_SAFE_INTEGER);
    const expected = 639162074156879513n - BigInt(MAX_FAST_FORWARD_SECONDS) * 10_000_000n;
    expect((capped.timeMgr?.timeSaveDate as LosslessInt).literal).toBe(expected.toString());
  });
});

describe('timerOps - deathclaw toggle', () => {
  it('reports enabled on a fresh save', () => {
    expect(deathclawState(makeSave())).toEqual({ state: 'enabled', remainingSeconds: null });
  });

  it('disable injects exactly one far-future blocker with a fresh id', () => {
    const save = makeSave();
    const next = setDeathclawEnabled(save, false);
    expect(next.DeathclawManager?.canDeathclawEmergencyOccurs).toBe(false);
    expect(next.DeathclawManager?.deathclawCooldownID).toBe(54_001);
    expect(next.taskMgr?.id).toBe(54_001);
    const tasks = next.taskMgr?.tasks ?? [];
    expect(tasks).toHaveLength((save.taskMgr?.tasks?.length ?? 0) + 1);
    const blocker = tasks[tasks.length - 1];
    expect(blocker).toEqual({
      startTime: 300_000,
      endTime: 300_000 + DISABLE_BLOCKER_SECONDS,
      id: 54_001,
      paused: false,
      rescheduleToOldest: true,
    });
    expect(deathclawState(next).state).toBe('disabled');
    expect(next.taskMgr?.pausedTasks).toBe(save.taskMgr?.pausedTasks);
    expect(snap(save)).toBe(snap(makeSave()));
  });

  it('disable is idempotent (same reference)', () => {
    const off = setDeathclawEnabled(makeSave(), false);
    expect(setDeathclawEnabled(off, false)).toBe(off);
  });

  it('enable removes precisely the blocker and restores the manager', () => {
    const save = makeSave();
    const off = setDeathclawEnabled(save, false);
    const on = setDeathclawEnabled(off, true);
    expect(on.DeathclawManager?.canDeathclawEmergencyOccurs).toBe(true);
    expect(on.DeathclawManager?.deathclawCooldownID).toBe(-1);
    expect(on.taskMgr?.tasks).toEqual(save.taskMgr?.tasks);
    expect(on.taskMgr?.pausedTasks).toBe(save.taskMgr?.pausedTasks);
    expect(deathclawState(on).state).toBe('enabled');
  });

  it('enable when already enabled is a no-op (same reference)', () => {
    const save = makeSave();
    expect(setDeathclawEnabled(save, true)).toBe(save);
  });

  it('disable replaces a natural cooldown task instead of stacking a second one', () => {
    const save = makeSave();
    const natural: SaveData = {
      ...save,
      DeathclawManager: {
        deathclawTotalExtraChance: 0,
        canDeathclawEmergencyOccurs: false,
        deathclawCooldownID: 503, // borrow an existing task as the "cooldown"
      },
    };
    expect(deathclawState(natural).state).toBe('cooldown');
    const off = setDeathclawEnabled(natural, false);
    const tasks = off.taskMgr?.tasks ?? [];
    expect(tasks.find((t) => t.id === 503)).toBeUndefined();
    expect(tasks.filter((t) => t.id === 54_001)).toHaveLength(1);
    expect(off.DeathclawManager?.deathclawCooldownID).toBe(54_001);
    expect(deathclawState(off).state).toBe('disabled');
  });

  it('disable without a task list is a refused no-op (cannot write a durable blocker)', () => {
    const bare = { DeathclawManager: { canDeathclawEmergencyOccurs: true } } as SaveData;
    expect(setDeathclawEnabled(bare, false)).toBe(bare);
  });

  it('enable copes with a stale cooldown id pointing at a missing task', () => {
    const save = makeSave();
    const stale: SaveData = {
      ...save,
      DeathclawManager: { canDeathclawEmergencyOccurs: false, deathclawCooldownID: 999 },
    };
    const on = setDeathclawEnabled(stale, true);
    expect(on.DeathclawManager?.canDeathclawEmergencyOccurs).toBe(true);
    expect(on.taskMgr?.tasks).toBe(save.taskMgr?.tasks); // nothing to remove
  });
});

describe('timerOps - Bottle & Cappy toggle', () => {
  it('reads enabled from SerializeLocked', () => {
    expect(isBottleAndCappyEnabled(makeSave())).toBe(true);
    expect(isBottleAndCappyEnabled({} as SaveData)).toBe(true);
  });

  it('disable locks and drops the unlock-task key', () => {
    const save = {
      ...makeSave(),
      BottleAndCappyMgrSerializeKey: {
        SerializeAccumulatedTriggerChance: 0,
        SerializeLocked: false,
        SerializeUnlockTask: 53_328,
      },
    } as SaveData;
    const next = setBottleAndCappyEnabled(save, false);
    expect(next.BottleAndCappyMgrSerializeKey).toEqual({
      SerializeAccumulatedTriggerChance: 0,
      SerializeLocked: true,
    });
    expect(isBottleAndCappyEnabled(next)).toBe(false);
  });

  it('enable unlocks and also drops a stale unlock-task key', () => {
    const locked = {
      BottleAndCappyMgrSerializeKey: { SerializeLocked: true, SerializeUnlockTask: 53_328 },
    } as SaveData;
    const next = setBottleAndCappyEnabled(locked, true);
    expect(next.BottleAndCappyMgrSerializeKey).toEqual({ SerializeLocked: false });
  });

  it('no-ops when the state already matches and no stale key exists', () => {
    const save = makeSave();
    expect(setBottleAndCappyEnabled(save, true)).toBe(save);
    const off = setBottleAndCappyEnabled(save, false);
    expect(setBottleAndCappyEnabled(off, false)).toBe(off);
  });
});

describe('timerOps - completeTaskNow', () => {
  it('pulls endTime to the clock and keeps the span non-negative', () => {
    const save = makeSave();
    const next = completeTaskNow(save, 501);
    const task = findTask(next, 501);
    expect(task).toEqual({
      startTime: 295_000,
      endTime: 300_000,
      id: 501,
      paused: false,
      rescheduleToOldest: true,
    });
    expect(taskRemainingSeconds(next, 501)).toBe(0);
    // Sibling tasks by reference (array is new, entries shared).
    expect(next.taskMgr?.tasks?.[1]).toBe(save.taskMgr?.tasks?.[1]);
  });

  it('no-ops on sentinels, unknown ids and already-due tasks', () => {
    const save = makeSave();
    expect(completeTaskNow(save, -1)).toBe(save);
    expect(completeTaskNow(save, 999)).toBe(save);
    const done = completeTaskNow(save, 501);
    expect(completeTaskNow(done, 501)).toBe(done);
  });
});

describe('timerOps - dweller timers', () => {
  it('finds the pregnancy and child tasks across rooms', () => {
    const save = makeSave();
    expect(dwellerTimers(save, 111)).toEqual({
      pregnancy: { roomId: 10, taskId: 501, remainingSeconds: 5_800 },
      childGrowUp: null,
    });
    expect(dwellerTimers(save, 130)).toEqual({
      pregnancy: null,
      childGrowUp: { roomId: 10, taskId: 502, remainingSeconds: 10_000 },
    });
    // Married (not RaisingBaby) partner entries and unknown dwellers yield nothing.
    expect(dwellerTimers(save, 112)).toEqual({ pregnancy: null, childGrowUp: null });
  });

  it('deliverBabyNow completes the task, ticks babyReady, and never touches the partner entry', () => {
    const save = makeSave();
    const next = deliverBabyNow(save, 111);
    expect(taskRemainingSeconds(next, 501)).toBe(0);
    // The game's own pair: task fired + BabyReady set (OnBabyBirthEvent), so the
    // sheet's "Baby ready" checkbox and the timer stay in sync.
    const mother = next.dwellers?.dwellers?.find((d) => d.serializeId === 111);
    expect(mother?.babyReady).toBe(true);
    expect(next.vault).toBe(save.vault); // rooms (and partners) untouched
    expect(deliverBabyNow(save, 999)).toBe(save);
  });

  it('deliverBabyNow still ticks babyReady when the timer already hit zero', () => {
    const save = makeSave();
    const due = completeTaskNow(save, 501); // timer at 0, babyReady still false
    const next = deliverBabyNow(due, 111);
    expect(next).not.toBe(due); // not a dead no-op
    expect(next.dwellers?.dwellers?.find((d) => d.serializeId === 111)?.babyReady).toBe(true);
    // Fully delivered state is then a no-op.
    expect(deliverBabyNow(next, 111)).toBe(next);
  });

  it('deliverBabyNow sets the flag for flag-only pregnancies (no birth task recorded)', () => {
    const base = makeSave();
    const save: SaveData = { ...base, vault: { ...base.vault, rooms: [] } };
    const next = deliverBabyNow(save, 111);
    expect(next.dwellers?.dwellers?.find((d) => d.serializeId === 111)?.babyReady).toBe(true);
    expect(next.taskMgr).toBe(save.taskMgr); // no task to complete - untouched
  });

  it('cancelBabyDelivery clears the flag AND restores the timer from the imported save', () => {
    const original = makeSave();
    const delivered = deliverBabyNow(original, 111);
    const next = cancelBabyDelivery(delivered, original, 111);
    expect(next.dwellers?.dwellers?.find((d) => d.serializeId === 111)?.babyReady).toBe(false);
    // The due timer is back to the imported countdown, not stranded at 0s.
    const task = next.taskMgr?.tasks?.find((t) => t.id === 501);
    expect(task?.startTime).toBe(295_000);
    expect(task?.endTime).toBe(305_800);
    expect(taskRemainingSeconds(next, 501)).toBe(5_800);
    expect(next.vault).toBe(delivered.vault); // partner entry untouched
  });

  it('cancelBabyDelivery is a same-reference no-op when nothing was delivered', () => {
    const original = makeSave();
    expect(cancelBabyDelivery(original, original, 111)).toBe(original);
  });

  it('growUpChildNow completes the task and never deletes the child entry', () => {
    const save = makeSave();
    const next = growUpChildNow(save, 130);
    expect(taskRemainingSeconds(next, 502)).toBe(0);
    expect(next.vault).toBe(save.vault);
    expect(next.vault?.rooms?.[0]?.children).toHaveLength(1);
    expect(growUpChildNow(save, 999)).toBe(save);
  });

  it('pregnancyPendingChildren reads the RaisingBaby entry (absent key = 0, no entry = null)', () => {
    const save = makeSave();
    expect(pregnancyPendingChildren(save, 111)).toBe(0);
    // Married (not RaisingBaby) entries and unknown dwellers have nothing to write to.
    expect(pregnancyPendingChildren(save, 112)).toBeNull();
    expect(pregnancyPendingChildren(save, 999)).toBeNull();
  });

  it('setPendingChildren writes only the RaisingBaby entry and leaves siblings shared', () => {
    const save = makeSave();
    const next = setPendingChildren(save, 111, 2);
    expect(pregnancyPendingChildren(next, 111)).toBe(2);
    const [raising, married] = next.vault?.rooms?.[0]?.partners ?? [];
    expect(raising?.pendingChildren).toBe(2);
    // The Married entry and unrelated rooms keep their original references.
    expect(married).toBe(save.vault?.rooms?.[0]?.partners?.[1]);
    expect(next.vault?.rooms?.[1]).toBe(save.vault?.rooms?.[1]);
    expect(next.taskMgr).toBe(save.taskMgr);
  });

  it('setPendingChildren caps at the natural triplets maximum and floors at 0', () => {
    const save = makeSave();
    expect(pregnancyPendingChildren(setPendingChildren(save, 111, 7), 111)).toBe(
      MAX_PENDING_CHILDREN,
    );
    const forced = setPendingChildren(save, 111, 3);
    expect(pregnancyPendingChildren(setPendingChildren(forced, 111, -5), 111)).toBe(0);
    expect(setPendingChildren(save, 111, Number.NaN)).toBe(save);
  });

  it('setPendingChildren creates a minimal RaisingBaby entry for flag-only pregnancies', () => {
    const base = makeSave();
    // Editor-forced pregnancy: flag set, no partnership recorded anywhere.
    const rooms = (base.vault?.rooms ?? []).map((r) =>
      r.deserializeID === 10 ? { ...r, partners: [] } : r,
    );
    const save: SaveData = { ...base, vault: { ...base.vault, rooms } };
    const next = setPendingChildren(save, 111, 3);
    expect(next.vault?.rooms?.[0]?.partners).toEqual([
      { m: -1, f: 111, s: 'RaisingBaby', t: -1, fatherId: -1, templateID: -1, pendingChildren: 3 },
    ]);
    expect(pregnancyPendingChildren(next, 111)).toBe(3);
    // The created entry is then edited in place, not duplicated.
    const cleared = setPendingChildren(next, 111, 0);
    expect(cleared.vault?.rooms?.[0]?.partners).toHaveLength(1);
    expect(pregnancyPendingChildren(cleared, 111)).toBe(0);
  });

  it('setPendingChildren never creates an entry for non-pregnant dwellers, 0, or no quarters', () => {
    const base = makeSave();
    const rooms = (base.vault?.rooms ?? []).map((r) =>
      r.deserializeID === 10 ? { ...r, partners: [] } : r,
    );
    const save: SaveData = { ...base, vault: { ...base.vault, rooms } };
    expect(setPendingChildren(save, 130, 2)).toBe(save); // Kid: not pregnant
    expect(setPendingChildren(save, 111, 0)).toBe(save); // default roll: nothing to store
    const noQuarters: SaveData = { ...base, vault: { ...base.vault, rooms: [] } };
    expect(setPendingChildren(noQuarters, 111, 2)).toBe(noQuarters);
  });

  it('setPendingChildren is a same-reference no-op when nothing would change', () => {
    const save = makeSave();
    // No RaisingBaby entry for this dweller.
    expect(setPendingChildren(save, 112, 2)).toBe(save);
    // Clearing to 0 never ADDS the key to an entry imported without one.
    expect(setPendingChildren(save, 111, 0)).toBe(save);
    expect('pendingChildren' in (save.vault?.rooms?.[0]?.partners?.[0] ?? {})).toBe(false);
    // Writing the value already stored changes nothing either.
    const forced = setPendingChildren(save, 111, 2);
    expect(setPendingChildren(forced, 111, 2)).toBe(forced);
  });
});

describe('timerOps - room timers', () => {
  it('classifies work cycles, training slots and rush decay', () => {
    const save = makeSave();
    expect(roomTimers(save, 11)).toEqual([
      { kind: 'production', taskId: 503, remainingSeconds: 2_600 },
      { kind: 'rush', taskId: 507, remainingSeconds: 500 },
    ]);
    expect(roomTimers(save, 12)).toEqual([
      { kind: 'crafting', taskId: 504, remainingSeconds: 20_000 },
    ]);
    expect(roomTimers(save, 13)).toEqual([
      { kind: 'training', taskId: 505, remainingSeconds: 1_000, slotDwellerId: 52 },
    ]);
    expect(roomTimers(save, 14)).toEqual([{ kind: 'radio', taskId: 506, remainingSeconds: 2_146 }]);
    expect(roomTimers(save, 15)).toEqual([]);
    expect(roomTimers(save, 999)).toEqual([]);
  });

  it('completes production + rush in one edit', () => {
    const save = makeSave();
    const next = completeRoomTimersNow(save, 11);
    expect(taskRemainingSeconds(next, 503)).toBe(0);
    expect(taskRemainingSeconds(next, 507)).toBe(0);
    expect(next.vault).toBe(save.vault); // no room-side fields for production
  });

  it('crafting completion also maxes CompletedTime (game clamps on load)', () => {
    const save = makeSave();
    const next = completeRoomTimersNow(save, 12);
    expect(taskRemainingSeconds(next, 504)).toBe(0);
    const room = next.vault?.rooms?.find((r) => r.deserializeID === 12);
    expect(room?.CompletedTime).toBe(1_000_000_000);
    expect(room?.CraftingItemId).toBe('MissileLauncher');
    // Other rooms shared by reference.
    expect(next.vault?.rooms?.[0]).toBe(save.vault?.rooms?.[0]);
  });

  it('radio completion syncs the display countdown', () => {
    const next = completeRoomTimersNow(makeSave(), 14);
    const room = next.vault?.rooms?.find((r) => r.deserializeID === 14);
    expect(room?.currentState?.remainingTime).toBe(1);
    expect(room?.currentState?.estimatedTime).toBe(3_600);
  });

  it('kind filter and per-slot training completion work', () => {
    const save = makeSave();
    expect(completeRoomTimersNow(save, 11, ['crafting'])).toBe(save);
    const slot = completeTrainingSlotNow(save, 13, 52);
    expect(taskRemainingSeconds(slot, 505)).toBe(0);
    expect(completeTrainingSlotNow(save, 13, 53)).toBe(save); // idle sentinel slot
  });
});

describe('timerOps - wasteland teams', () => {
  it('lists travelling teams with phase and elapsed', () => {
    expect(wastelandTeams(makeSave())).toEqual([
      {
        index: 0,
        phase: 'exploring',
        dwellers: [7, 8],
        elapsedSeconds: 5_000,
        returnTripDuration: null,
      },
      {
        index: 1,
        phase: 'returning',
        dwellers: [9],
        elapsedSeconds: 1_000,
        returnTripDuration: 4_500,
      },
    ]);
  });

  it('fast-forwards exploring time unclamped', () => {
    const save = makeSave();
    const next = fastForwardTeam(save, 0, 3_600);
    expect(next.vault?.wasteland?.teams?.[0]?.elapsedTimeAliveExploring).toBe(8_600);
    expect(next.vault?.wasteland?.teams?.[1]).toBe(save.vault?.wasteland?.teams?.[1]);
  });

  it('clamps returning time at the trip duration', () => {
    const save = makeSave();
    const next = fastForwardTeam(save, 1, 999_999);
    expect(next.vault?.wasteland?.teams?.[1]?.elapsedReturningTime).toBe(4_500);
    expect(fastForwardTeam(next, 1, 100)).toBe(next); // already arrived
  });

  it('no-ops for docked teams, bad indices and non-positive seconds', () => {
    const save = makeSave();
    expect(fastForwardTeam(save, 2, 100)).toBe(save);
    expect(fastForwardTeam(save, 9, 100)).toBe(save);
    expect(fastForwardTeam(save, 0, 0)).toBe(save);
  });
});

describe('timerOps - daily login rewards', () => {
  it('moves future timestamps into the past and is idempotent', () => {
    const save = makeSave();
    const next = makeDailyRewardsClaimable(save);
    expect(next.dayToDayRewardMgr?.states).toEqual([
      { type: 5, next: 1 },
      { type: 7, next: 1 },
    ]);
    expect(makeDailyRewardsClaimable(next)).toBe(next);
    expect(makeDailyRewardsClaimable({} as SaveData)).toEqual({});
  });
});

describe('timerOps - vault clock feedback + daily reward status', () => {
  it('vaultClockAheadSeconds diffs original vs current in exact seconds', () => {
    const original = makeSave();
    expect(vaultClockAheadSeconds(original, original)).toBe(0);
    const ff = fastForwardVault(fastForwardVault(original, 3_600), 86_400);
    expect(vaultClockAheadSeconds(original, ff)).toBe(90_000);
    expect(vaultClockAheadSeconds({} as SaveData, ff)).toBeNull();
  });

  it('dailyRewardStatus classifies pending vs claimable vs absent', () => {
    const now = 2_000_000_000_000;
    const save = {
      dayToDayRewardMgr: {
        states: [
          { type: 14, next: now + 7_200_000 }, // 2h out
          { type: 5, next: 1 }, // long past
        ],
      },
    } as SaveData;
    expect(dailyRewardStatus(save, now)).toEqual({
      total: 2,
      pending: 1,
      soonestSeconds: 7_200,
    });
    expect(dailyRewardStatus({} as SaveData, now)).toEqual({
      total: 0,
      pending: 0,
      soonestSeconds: null,
    });
  });
});

describe('timerOps - isProductionAwaitingCollect', () => {
  it('flags a staffed production room with buffered output and no cycle task', () => {
    const save = makeSave();
    expect(isProductionAwaitingCollect(save, 16)).toBe(true);
    expect(roomTimers(save, 16)).toEqual([]); // no timer row - the note explains why
  });

  it('stays false for running cycles, empty buffers, unstaffed and non-production rooms', () => {
    const save = makeSave();
    expect(isProductionAwaitingCollect(save, 11)).toBe(false); // cycle task running
    expect(isProductionAwaitingCollect(save, 17)).toBe(false); // empty output buffer
    expect(isProductionAwaitingCollect(save, 15)).toBe(false); // storage room, no buffer/dwellers
    expect(isProductionAwaitingCollect(save, 10)).toBe(false); // living quarters
    expect(isProductionAwaitingCollect(save, 999)).toBe(false);
  });
});
