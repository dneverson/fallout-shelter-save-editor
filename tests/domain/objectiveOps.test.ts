// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  objectiveSlots,
  replaceObjectiveSlot,
  setObjectiveCompleted,
  setObjectiveLottery,
  setObjectiveIncLevel,
  setObjectiveProgress,
} from '../../src/domain/quests/objectiveOps.ts';

function saveWith(): SaveData {
  return {
    objectiveMgr: {
      taskID: 7,
      canDiscard: true,
      nukaQuantumIncrement: 0,
      slotArray: [
        {
          objective: {
            objectiveID: 'Food1',
            requirements: [{ requirementID: 'r1', satisfied: false, rushCount: 3 }],
            completed: false,
            incrementLevel: 0,
          },
          incLevel: 2,
          lottery: [true, true, false, true, true],
        },
        {
          objective: {
            objectiveID: 'Water2',
            requirements: [],
            completed: false,
            incrementLevel: 1,
          },
          incLevel: 0,
          lottery: [true, true, true, true, true],
        },
        {
          objective: {
            objectiveID: 'Power3',
            requirements: [],
            completed: true,
            incrementLevel: 0,
          },
          incLevel: 5,
          lottery: [false, false, false, false, false],
        },
      ],
    },
  } as unknown as SaveData;
}

describe('objectiveSlots', () => {
  it('returns the 3 slots, or [] when the manager is absent', () => {
    expect(objectiveSlots(saveWith())).toHaveLength(3);
    expect(objectiveSlots({} as SaveData)).toEqual([]);
  });
});

describe('replaceObjectiveSlot', () => {
  it('swaps the objective and resets progress, preserving lottery + incLevel', () => {
    const next = replaceObjectiveSlot(saveWith(), 0, 'RushT1');
    const slot = next.objectiveMgr!.slotArray![0];
    expect(slot.objective).toEqual({
      objectiveID: 'RushT1',
      requirements: [],
      completed: false,
      // Assigned AT the slot's escalation level (the game's assign path), so the new
      // objective's goal/reward stay scaled instead of dropping to base.
      incrementLevel: 2,
    });
    expect(slot.incLevel).toBe(2); // preserved
    expect(slot.lottery).toEqual([true, true, false, true, true]); // preserved
  });

  it('leaves the other slots untouched (referential equality)', () => {
    const save = saveWith();
    const next = replaceObjectiveSlot(save, 0, 'RushT1');
    expect(next.objectiveMgr!.slotArray![1]).toBe(save.objectiveMgr!.slotArray![1]);
    expect(next.objectiveMgr!.slotArray![2]).toBe(save.objectiveMgr!.slotArray![2]);
  });

  it('is a no-op (same ref) when the slot already holds that objective', () => {
    const save = saveWith();
    expect(replaceObjectiveSlot(save, 0, 'Food1')).toBe(save);
  });

  it('is a no-op (same ref) for an out-of-range slot', () => {
    const save = saveWith();
    expect(replaceObjectiveSlot(save, 9, 'RushT1')).toBe(save);
    expect(replaceObjectiveSlot(save, -1, 'RushT1')).toBe(save);
  });
});

describe('setObjectiveProgress', () => {
  const row = (save: SaveData) =>
    save.objectiveMgr!.slotArray![0].objective!.requirements![0] as Record<string, unknown>;

  it('sets the counter, clamped to [0, goal]', () => {
    expect(row(setObjectiveProgress(saveWith(), 0, 0, 'rushCount', 5, 29)).rushCount).toBe(5);
    expect(row(setObjectiveProgress(saveWith(), 0, 0, 'rushCount', 99, 29)).rushCount).toBe(29);
    expect(row(setObjectiveProgress(saveWith(), 0, 0, 'rushCount', -4, 29)).rushCount).toBe(0);
  });

  it('marks the requirement satisfied and the objective completed at the goal', () => {
    const next = setObjectiveProgress(saveWith(), 0, 0, 'rushCount', 29, 29);
    expect(row(next).satisfied).toBe(true);
    expect(next.objectiveMgr!.slotArray![0].objective!.completed).toBe(true);
  });

  it('unmarks satisfied + completed when edited back below the goal', () => {
    const maxed = setObjectiveProgress(saveWith(), 0, 0, 'rushCount', 29, 29);
    const lowered = setObjectiveProgress(maxed, 0, 0, 'rushCount', 10, 29);
    expect(row(lowered).rushCount).toBe(10);
    expect(row(lowered).satisfied).toBe(false);
    expect(lowered.objectiveMgr!.slotArray![0].objective!.completed).toBe(false);
  });

  it('writes only the counter when no goal is derivable', () => {
    const next = setObjectiveProgress(saveWith(), 0, 0, 'rushCount', 500, null);
    expect(row(next).rushCount).toBe(500);
    expect(row(next).satisfied).toBe(false);
    expect(next.objectiveMgr!.slotArray![0].objective!.completed).toBe(false);
  });

  it('is a no-op (same ref) for a non-numeric key or missing requirement row', () => {
    const save = saveWith();
    expect(setObjectiveProgress(save, 0, 0, 'requirementID', 5, 29)).toBe(save);
    expect(setObjectiveProgress(save, 0, 5, 'rushCount', 5, 29)).toBe(save);
    expect(setObjectiveProgress(save, 1, 0, 'rushCount', 5, 29)).toBe(save); // empty requirements
  });

  it('is a no-op (same ref) when counter and completion state already match', () => {
    const save = saveWith();
    expect(setObjectiveProgress(save, 0, 0, 'rushCount', 3, 29)).toBe(save);
  });
});

describe('setObjectiveCompleted', () => {
  const row = (save: SaveData) =>
    save.objectiveMgr!.slotArray![0].objective!.requirements![0] as Record<string, unknown>;

  it('marks an objective complete', () => {
    const next = setObjectiveCompleted(saveWith(), 0, true);
    expect(next.objectiveMgr!.slotArray![0].objective!.completed).toBe(true);
  });

  it('syncs counters to the goal and satisfied=true when completing with a goal', () => {
    const next = setObjectiveCompleted(saveWith(), 0, true, 29);
    expect(row(next).rushCount).toBe(29);
    expect(row(next).satisfied).toBe(true);
    expect(next.objectiveMgr!.slotArray![0].objective!.completed).toBe(true);
  });

  it('pulls a maxed counter below the goal and satisfied=false when un-completing', () => {
    const maxed = setObjectiveCompleted(saveWith(), 0, true, 29);
    const undone = setObjectiveCompleted(maxed, 0, false, 29);
    expect(row(undone).rushCount).toBe(28);
    expect(row(undone).satisfied).toBe(false);
    expect(undone.objectiveMgr!.slotArray![0].objective!.completed).toBe(false);
  });

  it('leaves a below-goal counter alone when un-completing', () => {
    const completed = setObjectiveCompleted(saveWith(), 0, true); // no goal: flag only
    const undone = setObjectiveCompleted(completed, 0, false, 29);
    expect(row(undone).rushCount).toBe(3); // fixture value, already below goal
    expect(row(undone).satisfied).toBe(false);
  });

  it('is a no-op (same ref) when already in the requested state', () => {
    const save = saveWith();
    expect(setObjectiveCompleted(save, 2, true)).toBe(save); // slot 2 already completed
  });
});

describe('setObjectiveLottery', () => {
  it('replaces the 5-boolean lottery', () => {
    const next = setObjectiveLottery(saveWith(), 1, [false, true, false, true, false]);
    expect(next.objectiveMgr!.slotArray![1].lottery).toEqual([false, true, false, true, false]);
  });

  it('is a no-op (same ref) when the lottery is unchanged', () => {
    const save = saveWith();
    expect(setObjectiveLottery(save, 1, [true, true, true, true, true])).toBe(save);
  });
});

describe('setObjectiveIncLevel', () => {
  it('sets the slot escalation level, flooring negatives to 0', () => {
    expect(setObjectiveIncLevel(saveWith(), 1, 4).objectiveMgr!.slotArray![1].incLevel).toBe(4);
    expect(setObjectiveIncLevel(saveWith(), 1, -3).objectiveMgr!.slotArray![1].incLevel).toBe(0);
  });

  it("syncs the active objective's incrementLevel to the slot level", () => {
    const next = setObjectiveIncLevel(saveWith(), 0, 7);
    const slot = next.objectiveMgr!.slotArray![0];
    expect(slot.incLevel).toBe(7);
    expect(slot.objective!.incrementLevel).toBe(7);
  });

  it('is a no-op (same ref) when slot and objective levels already match', () => {
    const once = setObjectiveIncLevel(saveWith(), 0, 2);
    expect(setObjectiveIncLevel(once, 0, 2)).toBe(once);
  });

  const row = (save: SaveData) =>
    save.objectiveMgr!.slotArray![0].objective!.requirements![0] as Record<string, unknown>;

  it('follows the new goal with the counters when the objective is completed', () => {
    const completed = setObjectiveCompleted(saveWith(), 0, true, 29); // 29/29
    const next = setObjectiveIncLevel(completed, 0, 15, 43); // escalate: goal now 43
    expect(row(next).rushCount).toBe(43);
    expect(row(next).satisfied).toBe(true);
    expect(next.objectiveMgr!.slotArray![0].objective!.completed).toBe(true);
  });

  it('leaves a below-goal counter alone when the objective is in progress', () => {
    const save = saveWith(); // rushCount 3, not completed
    const next = setObjectiveIncLevel(save, 0, 15, 43);
    expect(next.objectiveMgr!.slotArray![0].objective!.requirements).toBe(
      save.objectiveMgr!.slotArray![0].objective!.requirements,
    );
  });

  it('pulls an in-progress counter below a lowered goal', () => {
    const high = setObjectiveProgress(saveWith(), 0, 0, 'rushCount', 10, 29); // 10/29
    const next = setObjectiveIncLevel(high, 0, 0, 5); // de-escalate: goal now 5
    expect(row(next).rushCount).toBe(4);
    expect(row(next).satisfied).toBe(false);
    expect(next.objectiveMgr!.slotArray![0].objective!.completed).toBe(false);
  });

  it('only sets the levels when no goal is passed', () => {
    const completed = setObjectiveCompleted(saveWith(), 0, true, 29);
    const next = setObjectiveIncLevel(completed, 0, 15);
    expect(row(next).rushCount).toBe(29); // untouched
    expect(next.objectiveMgr!.slotArray![0].incLevel).toBe(15);
  });
});
