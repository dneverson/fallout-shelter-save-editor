// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ObjectiveDef } from '../../src/domain/gamedata/schemas.ts';
import {
  formatObjectiveDescription,
  objectiveGoal,
  objectiveModeLabel,
  objectiveRewardLabel,
  requirementProgressEntries,
  scaledObjectiveGoal,
} from '../../src/domain/quests/objectiveDisplay.ts';

const def = (over: Partial<ObjectiveDef>): ObjectiveDef =>
  ({
    m_objectiveID: 'X1',
    requirements: [{ m_requirementID: 'r1' }],
    assignmentRequisites: [],
    ...over,
  }) as ObjectiveDef;

describe('objectiveGoal', () => {
  it('reads the largest non-zero resource goal', () => {
    expect(
      objectiveGoal(
        def({ requirements: [{ m_baseGoalResources: { m_food: 200, m_power: 0 } }] as never }),
      ),
    ).toBe(200);
  });

  it('reads a non-resource m_base* goal key', () => {
    expect(objectiveGoal(def({ requirements: [{ m_baseGoalRushes: 3 }] as never }))).toBe(3);
  });

  it('falls back to m_numberItemsToCollect', () => {
    expect(
      objectiveGoal(
        def({
          requirements: [{ m_numberItemsToCollect: 5, m_rarityOutfitsToCollect: 1 }] as never,
        }),
      ),
    ).toBe(5);
  });

  it('reads non-m_base goal keys like m_numRequiredDays', () => {
    expect(objectiveGoal(def({ requirements: [{ m_numRequiredDays: 7 }] as never }))).toBe(7);
  });

  it('ignores per-level / bookkeeping keys and returns null when no goal', () => {
    expect(
      objectiveGoal(
        def({
          requirements: [{ m_requirementIncreasePerLevel: 10, m_requirementMaxValue: 99 }] as never,
        }),
      ),
    ).toBeNull();
  });
});

describe('formatObjectiveDescription', () => {
  it('substitutes the {0} goal placeholder', () => {
    expect(
      formatObjectiveDescription(
        def({
          description: 'Collect {0} Food',
          requirements: [{ m_baseGoalResources: { m_food: 500 } }] as never,
        }),
      ),
    ).toBe('Collect 500 Food');
  });

  it('strips leftover multi-parameter placeholders', () => {
    expect(
      formatObjectiveDescription(
        def({
          description: 'Kill {0} enemies with {1}',
          requirements: [{ m_baseNumberEnemiesToKill: 10 }] as never,
        }),
      ),
    ).toBe('Kill 10 enemies with');
  });

  it('falls back to the objective id when no template exists', () => {
    expect(
      formatObjectiveDescription(def({ m_objectiveID: 'Mystery', description: undefined })),
    ).toBe('Mystery');
  });

  it('does not rewrite the id fallback even when a goal exists', () => {
    expect(
      formatObjectiveDescription(
        def({
          m_objectiveID: 'Food1',
          description: undefined,
          requirements: [{ m_baseGoalResources: { m_food: 200 } }] as never,
        }),
      ),
    ).toBe('Food1');
  });

  it('replaces a hardcoded goal number when the template has no placeholder', () => {
    const d = def({
      description: 'Level up 1 Dweller',
      requirements: [
        { m_baseDwellersToLevelUp: 4, m_requirementIncreasePerLevel: 1, m_permanentTrigger: 1 },
      ] as never,
    });
    expect(formatObjectiveDescription(d)).toBe('Level up 4 Dweller');
    expect(formatObjectiveDescription(d, 2)).toBe('Level up 6 Dweller');
  });

  it('leaves a number > 1 alone when it matches a non-goal parameter', () => {
    expect(
      formatObjectiveDescription(
        def({
          description: 'Merge 2 rooms together',
          requirements: [
            { m_baseNumberOfRooms: 1, m_mergeLevel: 2, m_requirementIncreasePerLevel: 1 },
          ] as never,
        }),
      ),
    ).toBe('Merge 2 rooms together');
  });

  it('replaces a stale hardcoded number that matches no parameter', () => {
    expect(
      formatObjectiveDescription(
        def({
          description: 'Collect 200 CAPS in the Vault',
          requirements: [{ m_baseTargetCaps: 300, m_requirementIncreasePerLevel: 250 }] as never,
        }),
      ),
    ).toBe('Collect 300 CAPS in the Vault');
  });

  it('leaves numberless templates unchanged', () => {
    expect(
      formatObjectiveDescription(
        def({
          description: 'Make a friend in the Wasteland',
          requirements: [{ m_baseWastelandEncounter: 3 }] as never,
        }),
      ),
    ).toBe('Make a friend in the Wasteland');
  });
});

describe('scaledObjectiveGoal', () => {
  const scalable = def({
    requirements: [
      {
        m_baseGoalResources: { m_food: 200 },
        m_requirementIncreasePerLevel: 10,
        m_requirementMaxValue: 250,
      },
    ] as never,
  });

  it('adds the per-level increase to the base goal', () => {
    expect(scaledObjectiveGoal(scalable, 0)).toBe(200);
    expect(scaledObjectiveGoal(scalable, 3)).toBe(230);
  });

  it('caps at m_requirementMaxValue and floors negative levels', () => {
    expect(scaledObjectiveGoal(scalable, 100)).toBe(250);
    expect(scaledObjectiveGoal(scalable, -5)).toBe(200);
  });

  it('returns null when the objective has no goal amount', () => {
    expect(scaledObjectiveGoal(def({ requirements: [{}] as never }), 3)).toBeNull();
  });
});

describe('scaled description and reward', () => {
  it('substitutes the scaled goal at a given escalation level', () => {
    expect(
      formatObjectiveDescription(
        def({
          description: 'Collect {0} Food',
          requirements: [
            { m_baseGoalResources: { m_food: 200 }, m_requirementIncreasePerLevel: 10 },
          ] as never,
        }),
        5,
      ),
    ).toBe('Collect 250 Food');
  });

  it('scales the reward by m_rewardIncrement per level', () => {
    const d = def({ m_baseRewardType: 0, m_baseRewardAmount: 50, m_rewardIncrement: 10 });
    expect(objectiveRewardLabel(d, 0)).toBe('50 Caps');
    expect(objectiveRewardLabel(d, 5)).toBe('100 Caps');
  });
});

describe('requirementProgressEntries', () => {
  it('humanizes scalar progress counters and skips identity/status keys', () => {
    expect(
      requirementProgressEntries({
        requirementID: 'r1',
        satisfied: false,
        rushCount: 3,
        numSpinsMade: 0,
        currentBabies: 2,
      }),
    ).toEqual([
      { key: 'rushCount', label: 'Rush count', value: '3', numeric: 3 },
      { key: 'numSpinsMade', label: 'Spins made', value: '0', numeric: 0 },
      { key: 'currentBabies', label: 'Babies', value: '2', numeric: 2 },
    ]);
  });

  it('skips non-scalar values like id lists', () => {
    expect(requirementProgressEntries({ requirementID: 'r1', lastWeapons: ['a', 'b'] })).toEqual(
      [],
    );
  });
});

describe('objectiveModeLabel', () => {
  it('labels the mode from the normal/survival flags', () => {
    expect(objectiveModeLabel(def({ m_isNormalMode: 1, m_isSurvivalMode: 1 }))).toBe('Both');
    expect(objectiveModeLabel(def({ m_isNormalMode: 0, m_isSurvivalMode: 1 }))).toBe('Survival');
    expect(objectiveModeLabel(def({ m_isNormalMode: 1, m_isSurvivalMode: 0 }))).toBe('Normal');
  });
});

describe('objectiveRewardLabel', () => {
  it('labels the base reward by EReward type', () => {
    expect(objectiveRewardLabel(def({ m_baseRewardType: 0, m_baseRewardAmount: 50 }))).toBe(
      '50 Caps',
    );
    expect(objectiveRewardLabel(def({ m_baseRewardType: 1, m_baseRewardAmount: 1 }))).toBe(
      '1 Lunchbox',
    );
    expect(objectiveRewardLabel(def({ m_baseRewardType: 4, m_baseRewardAmount: 2 }))).toBe(
      '2 Nuka-Cola Quantum',
    );
  });
});
