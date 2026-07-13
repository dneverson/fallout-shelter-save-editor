import { LosslessInt } from '../codec/losslessJson.ts';
import type { SaveData, TaskEntry } from '../model/saveSchema.ts';

// Read-only helpers over the save's task/time managers, plus the ONLY home for
// .NET-tick arithmetic. Every timer in the game is either a task in
// `taskMgr.tasks[]` (elapsed vault seconds measured against `taskMgr.time`) or a
// raw field; `timeMgr.timeSaveDate`/`timeGameBegin` are .NET DateTime ticks
// (100 ns units) far above Number.MAX_SAFE_INTEGER, carried as LosslessInt by the
// codec - all math on them is BigInt on the exact literal.
//
// Pure domain code: no React/DOM imports.

/** .NET ticks per second (1 tick = 100 ns). */
export const TICKS_PER_SECOND = 10_000_000n;

/** .NET ticks at the Unix epoch (0001-01-01 -> 1970-01-01). */
const UNIX_EPOCH_TICKS = 621_355_968_000_000_000n;

/**
 * endTime given to the deathclaw blocker task: ~126 years of vault play time.
 * Task times are elapsed play seconds, so this never fires in practice.
 */
export const DISABLE_BLOCKER_SECONDS = 4_000_000_000;

/**
 * A referenced cooldown task with more remaining than this is treated as an
 * editor-injected blocker rather than a natural in-game cooldown (which is ~30 min).
 */
export const BLOCKER_DETECT_THRESHOLD_SECONDS = 10 * 365 * 86_400;

/** True for a real task id. Ids <= 0 are "no task" sentinels (-1, training's -2 / -32768). */
export function isValidTaskId(id: number | undefined): id is number {
  return id !== undefined && Number.isFinite(id) && id > 0;
}

/** The task clock (`taskMgr.time`, elapsed vault seconds; 0 if absent). */
export function taskMgrTime(save: SaveData): number {
  return save.taskMgr?.time ?? 0;
}

/** Find a task by id across `taskMgr.tasks` and `taskMgr.pausedTasks`. */
export function findTask(save: SaveData, id: number | undefined): TaskEntry | null {
  if (!isValidTaskId(id)) return null;
  const mgr = save.taskMgr;
  if (!mgr) return null;
  for (const list of [mgr.tasks, mgr.pausedTasks]) {
    const hit = list?.find((t) => t.id === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * WHOLE seconds until task `id` fires (vault play time), or null when the task
 * cannot be found. Task times in the save are floats, so the value is CEILED:
 * a still-running timer is always >= 1, and 0 means the task is genuinely due
 * (fires during the next on-load catch-up). UI done-states rely on that contract -
 * a row can only read "0s" when its action is already complete.
 */
export function taskRemainingSeconds(save: SaveData, id: number | undefined): number | null {
  const task = findTask(save, id);
  if (!task || task.endTime === undefined) return null;
  return Math.ceil(Math.max(0, task.endTime - taskMgrTime(save)));
}

/**
 * Human duration: "2d 3h", "3h 5m", "3m 5s", "45s". Two largest units only -
 * timer rows need scannable estimates, not exact triples. Countdown convention:
 * fractional input is CEILED, so "0s" only ever appears for a true zero.
 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const seconds = s % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// --- .NET tick arithmetic (BigInt) ------------------------------------------------

/**
 * Read a tick field (`number | LosslessInt`) as a BigInt, or null when absent /
 * not an integer value.
 */
export function toTicks(value: number | LosslessInt | undefined): bigint | null {
  if (value instanceof LosslessInt) {
    try {
      return BigInt(value.literal);
    } catch {
      return null;
    }
  }
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  return null;
}

/**
 * Re-box a tick value for the save. Containment rule (losslessJson): a native
 * `number` when the value is a safe integer, else a `LosslessInt` carrying the
 * exact literal - real timeSaveDate values (~6.4e17) always take the second path.
 */
export function fromTicks(ticks: bigint): number | LosslessInt {
  const asNumber = Number(ticks);
  if (Number.isSafeInteger(asNumber)) return asNumber;
  return new LosslessInt(ticks.toString());
}

/** Unix milliseconds -> .NET ticks (e.g. `ticksFromUnixMs(Date.now())` = "now"). */
export function ticksFromUnixMs(ms: number): bigint {
  return BigInt(Math.round(ms)) * 10_000n + UNIX_EPOCH_TICKS;
}
