import type { Child, Partner, Room, SaveData, TaskEntry } from '../model/saveSchema.ts';
import { setPregnancy } from './dwellerOps.ts';
import {
  BLOCKER_DETECT_THRESHOLD_SECONDS,
  DISABLE_BLOCKER_SECONDS,
  findTask,
  isValidTaskId,
  taskMgrTime,
  taskRemainingSeconds,
  toTicks,
  fromTicks,
  TICKS_PER_SECOND,
} from '../tasks/taskLookup.ts';

// Pure, immutable TIMER edit operations. Same contract as every ops module:
// `(save, …args) => SaveData`, structural sharing, and the SAME save reference on
// a no-op (the store depends on that to skip history/toasts).
//
// How game timers work (verified against the decompiled 2.4.1 game code):
// - `timeMgr.time` / `taskMgr.time` = elapsed vault play seconds (the task clock).
// - `timeMgr.timeSaveDate` = .NET ticks of the last save. On load the game adds
//   (deviceNow - timeSaveDate) to the clock and "catch-up" fires every task whose
//   endTime has passed - so subtracting ticks fast-forwards EVERYTHING at once.
// - Every scheduled timer is a `taskMgr.tasks[]` entry; owners store only its id.
//   Completing one early = lowering its endTime to the current clock. Recurrent
//   tasks (production, training) complete one cycle and re-derive the next span.
//
// Deliberately NOT exposed here (reachable via the Advanced raw editor):
// - Transient animation tasks (rushing-state rushTaskId, recoveryTaskId,
//   skipTimeTaskId): created serializeTask:false / rebuilt on load - meaningless.
// - Daily/weekly quest picker dates: culture-formatted DateTime strings parsed with
//   the DEVICE locale; rewriting them risks corrupting the quest board.
// - objectiveMgr.taskID / completedQuestDataManager.taskID / vault.emergencyData
//   tasks / wasteland cycles[].taskId: recurrent and self-healing - the game
//   regenerates them, so edits have no lasting effect.
// - PlayerPrefs cooldowns: not stored in the save file.
// - ratingMgr / tutorial tasks: cosmetic, or soft-lock risk if broken.

// --- shared task-list helpers -----------------------------------------------------

function withTaskMgr(save: SaveData, taskMgr: NonNullable<SaveData['taskMgr']>): SaveData {
  return { ...save, taskMgr };
}

/** Replace the task with `id` in `taskMgr.tasks` via `patch`; same save when absent. */
function patchTask(save: SaveData, id: number | undefined, patch: Partial<TaskEntry>): SaveData {
  if (!isValidTaskId(id)) return save;
  const mgr = save.taskMgr;
  const tasks = mgr?.tasks;
  if (!mgr || !Array.isArray(tasks)) return save;
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return save;
  const current = tasks[index];
  const next = { ...current, ...patch };
  if (Object.entries(patch).every(([k, v]) => current[k as keyof TaskEntry] === v)) return save;
  const nextTasks = [...tasks];
  nextTasks[index] = next;
  return withTaskMgr(save, { ...mgr, tasks: nextTasks });
}

/**
 * Make task `id` fire during the next on-load catch-up: endTime = the current task
 * clock (startTime lowered alongside so the span stays non-negative). No-op for
 * sentinel/unknown ids or when the task is already due.
 */
export function completeTaskNow(save: SaveData, taskId: number | undefined): SaveData {
  if (!isValidTaskId(taskId)) return save;
  const task = findTask(save, taskId);
  if (!task || task.endTime === undefined) return save;
  const now = taskMgrTime(save);
  if (task.endTime <= now) return save;
  const startTime = Math.min(task.startTime ?? now, now);
  return patchTask(save, taskId, { startTime, endTime: now });
}

// --- Global clock (fast-forward the whole vault) -----------------------------------

/** Longest single fast-forward we allow: 10 years. */
export const MAX_FAST_FORWARD_SECONDS = 10 * 365 * 86_400;

/**
 * Fast-forward every timer in the vault by `seconds` by moving the last-save
 * timestamp (`timeMgr.timeSaveDate`, .NET ticks) into the past. On the next load
 * the game believes the player was away that much longer and its offline catch-up
 * advances production, crafting, training, pregnancies, exploration and cooldowns
 * exactly as if the time had really passed. BigInt math on the exact literal -
 * the value exceeds Number.MAX_SAFE_INTEGER.
 */
export function fastForwardVault(save: SaveData, seconds: number): SaveData {
  const s = Math.min(MAX_FAST_FORWARD_SECONDS, Math.trunc(seconds));
  if (!Number.isFinite(s) || s <= 0) return save;
  const timeMgr = save.timeMgr;
  const ticks = toTicks(timeMgr?.timeSaveDate);
  if (ticks === null) return save;
  const next = ticks - BigInt(s) * TICKS_PER_SECOND;
  return { ...save, timeMgr: { ...timeMgr, timeSaveDate: fromTicks(next) } };
}

/**
 * How far the working save's clock has been fast-forwarded relative to the imported
 * original, in seconds (0 = untouched; the UI's persistent feedback for the
 * fast-forward buttons). Null when either save lacks a readable timeSaveDate.
 */
export function vaultClockAheadSeconds(original: SaveData, current: SaveData): number | null {
  const before = toTicks(original.timeMgr?.timeSaveDate);
  const after = toTicks(current.timeMgr?.timeSaveDate);
  if (before === null || after === null) return null;
  return Number((before - after) / TICKS_PER_SECOND);
}

// --- Deathclaw attacks toggle -------------------------------------------------------

export type DeathclawState = 'enabled' | 'cooldown' | 'disabled';

/**
 * Current deathclaw-attack state. `canDeathclawEmergencyOccurs` is a cooldown latch:
 * - enabled: flag is not false - attacks can trigger (vault door / radio rolls).
 * - cooldown: flag false with a normal (~30 min) cooldown task - the game re-enables
 *   attacks when it fires.
 * - disabled: flag false with a far-future blocker task (written by this editor).
 */
export function deathclawState(save: SaveData): {
  state: DeathclawState;
  remainingSeconds: number | null;
} {
  const mgr = save.DeathclawManager;
  if (mgr?.canDeathclawEmergencyOccurs !== false)
    return { state: 'enabled', remainingSeconds: null };
  const remaining = taskRemainingSeconds(save, mgr.deathclawCooldownID);
  if (remaining !== null && remaining > BLOCKER_DETECT_THRESHOLD_SECONDS) {
    return { state: 'disabled', remainingSeconds: remaining };
  }
  return { state: 'cooldown', remainingSeconds: remaining };
}

/**
 * Durably enable/disable deathclaw attacks.
 *
 * Disable: the flag alone is NOT enough - on load, a false flag with a missing
 * cooldown task makes the game re-create a ~30 min cooldown and re-enable attacks.
 * So we set the flag false AND inject a far-future blocker task into `taskMgr.tasks`
 * (fresh id from the taskMgr counter) that `deathclawCooldownID` points at.
 * Any existing natural-cooldown task is removed first.
 *
 * Enable: flag true, `deathclawCooldownID: -1`, and the referenced task (blocker or
 * natural cooldown - both are ours to drop once the flag is true) is removed from
 * `taskMgr.tasks`, leaving the task list exactly as the game would write it.
 */
export function setDeathclawEnabled(save: SaveData, enabled: boolean): SaveData {
  const mgr = save.DeathclawManager ?? {};
  const taskMgr = save.taskMgr;
  const tasks = taskMgr?.tasks;
  const cooldownId = mgr.deathclawCooldownID;

  if (enabled) {
    if (mgr.canDeathclawEmergencyOccurs !== false && (cooldownId ?? -1) === -1) return save;
    let next: SaveData = {
      ...save,
      DeathclawManager: {
        ...mgr,
        canDeathclawEmergencyOccurs: true,
        deathclawCooldownID: -1,
      },
    };
    if (taskMgr && Array.isArray(tasks) && isValidTaskId(cooldownId)) {
      const remaining = tasks.filter((t) => t.id !== cooldownId);
      if (remaining.length !== tasks.length) {
        next = withTaskMgr(next, { ...taskMgr, tasks: remaining });
      }
    }
    return next;
  }

  // Disable. Without a task list we cannot write a durable blocker - stay a no-op
  // (the UI disables the control on such saves rather than corrupting them).
  if (!taskMgr || !Array.isArray(tasks)) return save;
  if (deathclawState(save).state === 'disabled') return save;

  const now = taskMgr.time ?? 0;
  const blockerId = (taskMgr.id ?? 0) + 1;
  const blocker: TaskEntry = {
    startTime: now,
    endTime: now + DISABLE_BLOCKER_SECONDS,
    id: blockerId,
    paused: false,
    rescheduleToOldest: true,
  };
  // Replace any existing (natural) cooldown task so exactly one task backs the id.
  const kept = !isValidTaskId(cooldownId) ? tasks : tasks.filter((t) => t.id !== cooldownId);
  return {
    ...save,
    DeathclawManager: {
      ...mgr,
      canDeathclawEmergencyOccurs: false,
      deathclawCooldownID: blockerId,
    },
    taskMgr: { ...taskMgr, id: blockerId, tasks: [...kept, blocker] },
  };
}

// --- Bottle & Cappy toggle ----------------------------------------------------------

/** True when Bottle & Cappy visits are allowed (`SerializeLocked` is not true). */
export function isBottleAndCappyEnabled(save: SaveData): boolean {
  return save.BottleAndCappyMgrSerializeKey?.SerializeLocked !== true;
}

/**
 * Allow/prevent Bottle & Cappy visits. Locked with NO unlock-task key means the
 * appearance cycle never starts on load; both directions drop `SerializeUnlockTask`
 * (its task is never persisted by the game, so the pointer is stale either way).
 */
export function setBottleAndCappyEnabled(save: SaveData, enabled: boolean): SaveData {
  const current = save.BottleAndCappyMgrSerializeKey ?? {};
  const locked = !enabled;
  if ((current.SerializeLocked ?? false) === locked && current.SerializeUnlockTask === undefined) {
    return save;
  }
  const next = { ...current, SerializeLocked: locked };
  delete next.SerializeUnlockTask; // fresh copy - the input save is never mutated
  return { ...save, BottleAndCappyMgrSerializeKey: next };
}

// --- Dweller timers (pregnancy / child grow-up) --------------------------------------

/** Partnership statuses whose task `t` we surface (RaisingBaby = the pregnancy). */
const PREGNANCY_STATUS = 'RaisingBaby';

export interface DwellerTimers {
  /** Pregnancy (mother only): the RaisingBaby partnership task. */
  pregnancy: { roomId: number; taskId: number; remainingSeconds: number | null } | null;
  /** Child grow-up task (when this dweller IS a child). */
  childGrowUp: { roomId: number; taskId: number; remainingSeconds: number | null } | null;
}

function findPartnerEntry(
  save: SaveData,
  dwellerId: number,
): { room: Room; partner: Partner } | null {
  for (const room of save.vault?.rooms ?? []) {
    for (const partner of room.partners ?? []) {
      if (partner.f === dwellerId && partner.s === PREGNANCY_STATUS) return { room, partner };
    }
  }
  return null;
}

function findChildEntry(save: SaveData, dwellerId: number): { room: Room; child: Child } | null {
  for (const room of save.vault?.rooms ?? []) {
    for (const child of room.children ?? []) {
      if (child.dwellerID === dwellerId) return { room, child };
    }
  }
  return null;
}

/** The timers attached to one dweller (searched across every Living Quarters). */
export function dwellerTimers(save: SaveData, dwellerId: number): DwellerTimers {
  const partnerHit = findPartnerEntry(save, dwellerId);
  const childHit = findChildEntry(save, dwellerId);
  return {
    pregnancy:
      partnerHit && isValidTaskId(partnerHit.partner.t)
        ? {
            roomId: partnerHit.room.deserializeID,
            taskId: partnerHit.partner.t,
            remainingSeconds: taskRemainingSeconds(save, partnerHit.partner.t),
          }
        : null,
    childGrowUp:
      childHit && isValidTaskId(childHit.child.taskID)
        ? {
            roomId: childHit.room.deserializeID,
            taskId: childHit.child.taskID,
            remainingSeconds: taskRemainingSeconds(save, childHit.child.taskID),
          }
        : null,
  };
}

/**
 * Make the pregnancy due immediately: the mother's RaisingBaby task fires on next
 * load AND her `babyReady` flag is set - the exact pair the game produces itself
 * (OnBabyBirthEvent sets BabyReady when the task fires, and a loaded save with
 * BabyReady already true re-enters the birth flow directly). Keeping both in sync
 * means the sheet's "Baby ready" checkbox reflects the delivered state. Works on
 * flag-only pregnancies too (no birth task recorded: just the flag). The
 * partnership entry is never touched; the birth still needs vault space, as in-game.
 */
export function deliverBabyNow(save: SaveData, dwellerId: number): SaveData {
  const hit = findPartnerEntry(save, dwellerId);
  let next = hit ? completeTaskNow(save, hit.partner.t) : save;
  const mother = next.dwellers?.dwellers?.find((d) => d.serializeId === dwellerId);
  if (mother && mother.babyReady !== true) {
    next = setPregnancy(next, dwellerId, { babyReady: true });
  }
  return next;
}

/**
 * Undo a delivery: clear `babyReady` AND put the birth task's start/end times back
 * to what the IMPORTED save recorded, so unticking "Baby ready" returns the due
 * timer to its original countdown instead of leaving it stranded at 0s. When the
 * original has no such task (flag-only pregnancy), only the flag is cleared.
 */
export function cancelBabyDelivery(
  save: SaveData,
  original: SaveData,
  dwellerId: number,
): SaveData {
  let next = save;
  const mother = save.dwellers?.dwellers?.find((d) => d.serializeId === dwellerId);
  if (mother && mother.babyReady === true) {
    next = setPregnancy(next, dwellerId, { babyReady: false });
  }
  const hit = findPartnerEntry(next, dwellerId);
  const before = hit ? findTask(original, hit.partner.t) : null;
  if (hit && before && before.endTime !== undefined) {
    const patch: Partial<TaskEntry> = { endTime: before.endTime };
    if (before.startTime !== undefined) patch.startTime = before.startTime;
    next = patchTask(next, hit.partner.t, patch);
  }
  return next;
}

/**
 * Finish a child's grow-up timer (becomes an adult on next load). Only the task's
 * endTime changes - the child entry itself must NEVER be removed or re-pointed
 * (the game discards children whose task is missing).
 */
export function growUpChildNow(save: SaveData, dwellerId: number): SaveData {
  const hit = findChildEntry(save, dwellerId);
  if (!hit) return save;
  return completeTaskNow(save, hit.child.taskID);
}

// --- Room timers ---------------------------------------------------------------------

export type RoomTimerKind = 'production' | 'crafting' | 'training' | 'radio' | 'rush';

export interface RoomTimer {
  kind: RoomTimerKind;
  taskId: number;
  remainingSeconds: number | null;
  /** Training only: the dweller occupying this slot. */
  slotDwellerId?: number;
}

function roomByDeserializeId(save: SaveData, deserializeID: number): Room | undefined {
  return save.vault?.rooms?.find((r) => r.deserializeID === deserializeID);
}

function workCycleKind(room: Room): RoomTimerKind {
  if (room.class === 'Crafting') return 'crafting';
  if (room.type === 'Radio') return 'radio';
  return 'production';
}

/** The editable timers running in one room (empty for idle rooms). */
export function roomTimers(save: SaveData, deserializeID: number): RoomTimer[] {
  const room = roomByDeserializeId(save, deserializeID);
  if (!room) return [];
  const timers: RoomTimer[] = [];
  const cycleId = room.currentState?.taskId;
  if (isValidTaskId(cycleId) && findTask(save, cycleId)) {
    timers.push({
      kind: workCycleKind(room),
      taskId: cycleId,
      remainingSeconds: taskRemainingSeconds(save, cycleId),
    });
  }
  for (const slot of room.slots ?? []) {
    if (isValidTaskId(slot.taskID) && findTask(save, slot.taskID)) {
      timers.push({
        kind: 'training',
        taskId: slot.taskID,
        remainingSeconds: taskRemainingSeconds(save, slot.taskID),
        ...(slot.dwellerID !== undefined ? { slotDwellerId: slot.dwellerID } : {}),
      });
    }
  }
  const rushRemaining = taskRemainingSeconds(save, room.rushTask);
  if (isValidTaskId(room.rushTask) && rushRemaining !== null && rushRemaining > 0) {
    timers.push({ kind: 'rush', taskId: room.rushTask, remainingSeconds: rushRemaining });
  }
  return timers;
}

/**
 * True when a staffed production room has NO running cycle task: its output buffer is
 * full and waiting to be collected in game (the game stops the cycle at capacity and
 * starts a fresh one after collection). This is why not every staffed reactor carries
 * a timer in the save - the UI shows an explanatory note instead of an empty section.
 */
export function isProductionAwaitingCollect(save: SaveData, deserializeID: number): boolean {
  const room = roomByDeserializeId(save, deserializeID);
  const output = room?.storage?.resources;
  if (!room || !output || (room.dwellers?.length ?? 0) === 0) return false;
  const cycleId = room.currentState?.taskId;
  if (isValidTaskId(cycleId) && findTask(save, cycleId)) {
    return false; // cycle running - the normal timer row covers it
  }
  return Object.values(output).some((v) => typeof v === 'number' && v > 0);
}

/** Crafting sentinel: far above any recipe's required seconds; the game clamps on load. */
const CRAFTING_DONE_SECONDS = 1_000_000_000;

function completeOneRoomTimer(save: SaveData, deserializeID: number, timer: RoomTimer): SaveData {
  let next = completeTaskNow(save, timer.taskId);
  if (timer.kind === 'crafting' || timer.kind === 'radio') {
    const rooms = next.vault?.rooms;
    const index = rooms?.findIndex((r) => r.deserializeID === deserializeID) ?? -1;
    if (rooms && index !== -1) {
      const room = rooms[index];
      const patched =
        timer.kind === 'crafting'
          ? // Elapsed crafting seconds; a huge value means "done" (clamped on load).
            room.CompletedTime === CRAFTING_DONE_SECONDS
            ? room
            : { ...room, CompletedTime: CRAFTING_DONE_SECONDS }
          : // Radio keeps a display countdown beside the task - sync it.
            (room.currentState?.remainingTime ?? 1) <= 1
            ? room
            : { ...room, currentState: { ...room.currentState, remainingTime: 1 } };
      if (patched !== room) {
        const nextRooms = [...rooms];
        nextRooms[index] = patched;
        next = { ...next, vault: { ...next.vault, rooms: nextRooms } };
      }
    }
  }
  return next;
}

/**
 * Complete the room's running timers (all kinds by default, or just `kinds`).
 * Production/radio finish their current cycle on next load and then continue at the
 * normal pace; crafting finishes the item; training completes one level-up cycle;
 * rush resets the escalated rush cost.
 */
export function completeRoomTimersNow(
  save: SaveData,
  deserializeID: number,
  kinds?: readonly RoomTimerKind[],
): SaveData {
  let next = save;
  for (const timer of roomTimers(save, deserializeID)) {
    if (kinds && !kinds.includes(timer.kind)) continue;
    next = completeOneRoomTimer(next, deserializeID, timer);
  }
  return next;
}

/** Complete a single training slot's cycle (by the dweller occupying it). */
export function completeTrainingSlotNow(
  save: SaveData,
  deserializeID: number,
  slotDwellerId: number,
): SaveData {
  const timer = roomTimers(save, deserializeID).find(
    (t) => t.kind === 'training' && t.slotDwellerId === slotDwellerId,
  );
  if (!timer) return save;
  return completeTaskNow(save, timer.taskId);
}

// --- Wasteland exploration teams (raw counters, not tasks) ---------------------------

export interface TeamTimer {
  index: number;
  phase: 'exploring' | 'returning';
  /** Dweller serializeIds on the team. */
  dwellers: number[];
  elapsedSeconds: number;
  /** Returning only: trip length; arrival when elapsed reaches it. */
  returnTripDuration: number | null;
}

/** Statuses whose elapsed-exploring counter is running. */
const EXPLORING_STATUSES = new Set(['Exploring', 'GoingToQuest']);

/** Teams currently travelling (exploring / heading to a quest / returning). */
export function wastelandTeams(save: SaveData): TeamTimer[] {
  const timers: TeamTimer[] = [];
  (save.vault?.wasteland?.teams ?? []).forEach((team, index) => {
    if (team.status !== undefined && EXPLORING_STATUSES.has(team.status)) {
      timers.push({
        index,
        phase: 'exploring',
        dwellers: team.dwellers ?? [],
        elapsedSeconds: team.elapsedTimeAliveExploring ?? 0,
        returnTripDuration: null,
      });
    } else if (team.status === 'ReturningToVault') {
      timers.push({
        index,
        phase: 'returning',
        dwellers: team.dwellers ?? [],
        elapsedSeconds: team.elapsedReturningTime ?? 0,
        returnTripDuration: team.returnTripDuration ?? null,
      });
    }
  });
  return timers;
}

/**
 * Fast-forward one team's travel counter by `seconds`. Exploring / going-to-quest
 * teams accrue exploration time (loot rolls, quest arrival); returning teams move
 * toward home, clamped at `returnTripDuration` (= arrived on next load).
 */
export function fastForwardTeam(save: SaveData, teamIndex: number, seconds: number): SaveData {
  const s = Math.trunc(seconds);
  if (!Number.isFinite(s) || s <= 0) return save;
  const wasteland = save.vault?.wasteland;
  const teams = wasteland?.teams;
  const team = teams?.[teamIndex];
  if (!teams || !team || team.status === undefined) return save;

  let patched: typeof team;
  if (EXPLORING_STATUSES.has(team.status)) {
    patched = {
      ...team,
      elapsedTimeAliveExploring: Math.max(0, (team.elapsedTimeAliveExploring ?? 0) + s),
    };
  } else if (team.status === 'ReturningToVault') {
    const trip = team.returnTripDuration;
    const raw = Math.max(0, (team.elapsedReturningTime ?? 0) + s);
    const clamped = trip !== undefined ? Math.min(trip, raw) : raw;
    if (clamped === (team.elapsedReturningTime ?? 0)) return save;
    patched = { ...team, elapsedReturningTime: clamped };
  } else {
    return save;
  }

  const nextTeams = [...teams];
  nextTeams[teamIndex] = patched;
  return {
    ...save,
    vault: { ...save.vault, wasteland: { ...wasteland, teams: nextTeams } },
  };
}

// --- Daily login rewards --------------------------------------------------------------

export interface DailyRewardStatus {
  /** Reward timers recorded in the save (the shipped game has ONE: the Spin-to-Win
   *  poker chip, season vaults only). */
  total: number;
  /** How many of them are still counting down (next > nowMs). */
  pending: number;
  /** Soonest pending timer, in seconds from nowMs (null when none pending). */
  soonestSeconds: number | null;
}

/**
 * Status of the daily reward timers (`dayToDayRewardMgr.states[].next`, wall-clock
 * Unix ms). `nowMs` is passed in (Date.now() at the call site) so this stays pure.
 * An EMPTY list is normal: the game then creates a fresh, immediately-claimable
 * state on load - there is nothing to fast-forward.
 */
export function dailyRewardStatus(save: SaveData, nowMs: number): DailyRewardStatus {
  const states = save.dayToDayRewardMgr?.states ?? [];
  let pending = 0;
  let soonestMs: number | null = null;
  for (const state of states) {
    const value = state.next;
    // A LosslessInt next (> 2^53 ms) is astronomically far in the future.
    const ms = typeof value === 'number' ? value : value !== undefined ? Infinity : 0;
    if (ms > nowMs) {
      pending++;
      if (soonestMs === null || ms < soonestMs) soonestMs = ms;
    }
  }
  return {
    total: states.length,
    pending,
    soonestSeconds:
      soonestMs === null ? null : soonestMs === Infinity ? Infinity : (soonestMs - nowMs) / 1_000,
  };
}

/**
 * Make every daily login reward claimable on next load: each `states[].next`
 * (a wall-clock Unix-milliseconds timestamp) is set to 1, i.e. long past. A fixed
 * past value (not Date.now()) keeps the op deterministic.
 */
export function makeDailyRewardsClaimable(save: SaveData): SaveData {
  const mgr = save.dayToDayRewardMgr;
  const states = mgr?.states;
  if (!Array.isArray(states) || states.length === 0) return save;
  let changed = false;
  const next = states.map((state) => {
    const value = state.next;
    const isFuture = typeof value === 'number' ? value > 1 : value !== undefined; // LosslessInt = astronomically far future
    if (!isFuture) return state;
    changed = true;
    return { ...state, next: 1 };
  });
  if (!changed) return save;
  return { ...save, dayToDayRewardMgr: { ...mgr, states: next } };
}
