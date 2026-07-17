import type { SaveData, ObjectiveSlot } from '../model/saveSchema.ts';

// Pure, immutable edit ops for the 3 rotating daily objectives (`objectiveMgr.slotArray`).
// Structural sharing throughout: a no-op returns the SAME save reference so the undo history
// never grows an empty step. Game-data-free - the objective catalog is supplied by the call site
// (an objectiveID string is enough; the game re-attaches the catalog objective by id on load).
//
// Save shape (confirmed against ObjectiveMgr.cs / Objective.cs):
//   objectiveMgr.slotArray[] = 3 slots, each
//     { objective: { objectiveID, requirements[], completed, incrementLevel }, incLevel, lottery[5] }
// On load the objective's requirements come from the CATALOG (matched by requirementID); an empty
// saved `requirements` array is tolerated and every requirement is initialized fresh. `completed:
// true` sticks unconditionally (the game skips the requirement re-check). An unknown objectiveID
// does NOT crash - the game back-fills the slot - but it will not stick, so callers must pass a
// valid catalog id. The game assumes exactly 3 slots, so these ops only ever REPLACE a slot's
// contents, never add or remove slots (Section 7 "replace, never remove").

/** The 3 active objective slots (`objectiveMgr.slotArray`), or `[]` when absent. */
export function objectiveSlots(save: SaveData): ObjectiveSlot[] {
  return save.objectiveMgr?.slotArray ?? [];
}

/**
 * The slot's CURRENT objective's escalation level: the level it was assigned at, falling back
 * to the slot counter. Goal/reward scaling reads this, so card and panel must agree on it.
 */
export function slotEscalation(slot: ObjectiveSlot): number {
  return slot.objective?.incrementLevel ?? slot.incLevel ?? 0;
}

/** Immutably replace slot `index` via `fn`; same-ref no-op when out of range or unchanged. */
function updateSlot(
  save: SaveData,
  index: number,
  fn: (slot: ObjectiveSlot) => ObjectiveSlot,
): SaveData {
  const slots = save.objectiveMgr?.slotArray;
  if (!slots || index < 0 || index >= slots.length) return save;
  const next = fn(slots[index]);
  if (next === slots[index]) return save;
  const nextSlots = slots.slice();
  nextSlots[index] = next;
  return { ...save, objectiveMgr: { ...save.objectiveMgr, slotArray: nextSlots } };
}

/**
 * Swap the objective occupying slot `index` for the catalog objective `objectiveID`, resetting
 * its progress (fresh requirements, not completed). The slot's `lottery` and `incLevel` are
 * preserved, and the new objective is assigned AT the slot's escalation level - mirroring the
 * game's own assign path, so the shown goal/reward stay scaled instead of dropping to base.
 * No-op if the slot already holds `objectiveID`.
 */
export function replaceObjectiveSlot(save: SaveData, index: number, objectiveID: string): SaveData {
  return updateSlot(save, index, (slot) => {
    if (slot.objective?.objectiveID === objectiveID) return slot;
    return {
      ...slot,
      objective: {
        objectiveID,
        requirements: [],
        completed: false,
        incrementLevel: slot.incLevel ?? 0,
      },
    };
  });
}

/**
 * Set one numeric progress counter (e.g. `rushCount`) on requirement `reqIndex` of slot `index`,
 * clamped to [0, `goal`] when the goal is known. Reaching the goal marks the requirement
 * `satisfied` and the objective `completed` (ready to collect); editing back below the goal
 * unmarks both. With no derivable goal only the counter is written. No-op when `key` is not a
 * numeric field of that requirement row.
 */
export function setObjectiveProgress(
  save: SaveData,
  index: number,
  reqIndex: number,
  key: string,
  value: number,
  goal: number | null,
): SaveData {
  const floored = Math.max(0, Math.trunc(value));
  const next = goal != null ? Math.min(floored, goal) : floored;
  return updateSlot(save, index, (slot) => {
    const objective = slot.objective;
    const row = objective?.requirements?.[reqIndex];
    if (!objective || !row) return slot;
    const current = (row as Record<string, unknown>)[key];
    if (typeof current !== 'number') return slot;
    const met = goal != null && next >= goal;
    const rowInSync = goal == null || (row.satisfied === true) === met;
    const objectiveInSync = goal == null || (objective.completed === true) === met;
    if (current === next && rowInSync && objectiveInSync) return slot;
    const requirements = objective.requirements!.slice();
    requirements[reqIndex] = { ...row, [key]: next, ...(goal != null ? { satisfied: met } : {}) };
    return {
      ...slot,
      objective: { ...objective, requirements, ...(goal != null ? { completed: met } : {}) },
    };
  });
}

type RequirementRow = NonNullable<NonNullable<ObjectiveSlot['objective']>['requirements']>[number];

/**
 * Requirement rows re-synced to the `completed` flag at `goal`: completing sets every numeric
 * counter to the goal and `satisfied: true`; un-completing sets `satisfied: false` and pulls
 * counters that sit at/above the goal down to just below it (so the game does not immediately
 * re-satisfy the requirement from the stored count). Counters already below the goal are left
 * alone. `changed: false` (with the input array) when every row already matches.
 */
function syncRequirementRows(
  requirements: RequirementRow[] | undefined,
  completed: boolean,
  goal: number,
): { requirements: RequirementRow[] | undefined; changed: boolean } {
  if (!requirements || requirements.length === 0) return { requirements, changed: false };
  let changed = false;
  const next = requirements.map((row) => {
    const patch: Record<string, unknown> = {};
    if ((row.satisfied === true) !== completed) patch.satisfied = completed;
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (typeof value !== 'number') continue;
      const target = completed ? goal : Math.min(value, Math.max(goal - 1, 0));
      if (target !== value) patch[key] = target;
    }
    if (Object.keys(patch).length === 0) return row;
    changed = true;
    return { ...row, ...patch };
  });
  return { requirements: changed ? next : requirements, changed };
}

/**
 * Mark the objective in slot `index` complete (ready-to-collect) or not. When `goal` is known
 * the requirement rows are kept consistent with the flag (see {@link syncRequirementRows}).
 */
export function setObjectiveCompleted(
  save: SaveData,
  index: number,
  completed: boolean,
  goal?: number | null,
): SaveData {
  return updateSlot(save, index, (slot) => {
    const objective = slot.objective;
    if (!objective) return slot;
    const synced =
      goal != null
        ? syncRequirementRows(objective.requirements, completed, goal)
        : { requirements: objective.requirements, changed: false };
    if (objective.completed === completed && !synced.changed) return slot;
    return {
      ...slot,
      objective: {
        ...objective,
        completed,
        ...(synced.changed ? { requirements: synced.requirements } : {}),
      },
    };
  });
}

/** Set the 5-boolean reward-tier lottery (`m_availableLevels`) for slot `index`. */
export function setObjectiveLottery(save: SaveData, index: number, lottery: boolean[]): SaveData {
  return updateSlot(save, index, (slot) => {
    const cur = slot.lottery;
    if (cur && cur.length === lottery.length && cur.every((v, i) => v === lottery[i])) return slot;
    return { ...slot, lottery: [...lottery] };
  });
}

/**
 * Set slot `index`'s escalation level: the slot's `incLevel` AND the active objective's
 * `incrementLevel`, kept in lockstep (as the game does each completion cycle - the slot counter
 * seeds the objective it assigns). Syncing both makes the CURRENT objective's goal/reward scale
 * to the edited level on load, not just the next one drawn. When `goal` (the scaled goal AT the
 * new level) is known, the requirement rows are re-synced to the objective's completed flag (see
 * {@link syncRequirementRows}) so a completed objective's counters follow the goal (15/15, not
 * 1/15) and an in-progress counter never sits at/above a lowered goal.
 */
export function setObjectiveIncLevel(
  save: SaveData,
  index: number,
  incLevel: number,
  goal?: number | null,
): SaveData {
  const level = Math.max(0, Math.trunc(incLevel));
  return updateSlot(save, index, (slot) => {
    const objective = slot.objective;
    const synced =
      objective && goal != null
        ? syncRequirementRows(objective.requirements, objective.completed === true, goal)
        : { requirements: objective?.requirements, changed: false };
    const objectiveInSync = !objective || objective.incrementLevel === level;
    if (slot.incLevel === level && objectiveInSync && !synced.changed) return slot;
    return {
      ...slot,
      incLevel: level,
      ...(objective
        ? {
            objective: {
              ...objective,
              incrementLevel: level,
              ...(synced.changed ? { requirements: synced.requirements } : {}),
            },
          }
        : {}),
    };
  });
}
