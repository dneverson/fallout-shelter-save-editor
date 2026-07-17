// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { GameData } from '../../src/domain/gamedata/gameData.ts';
import type { Quest } from '../../src/domain/gamedata/schemas.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import { resources } from '../../src/domain/ops/vaultOps.ts';
import { EQuestLootType as T } from '../../src/domain/quests/questLoot.ts';
import {
  completedQuestSet,
  isQuestComplete,
  questCompletionClosure,
  questVariantKey,
  isQuestTip,
  completedDependents,
  completeQuest,
  uncompleteQuest,
  isReactivatingEventQuest,
  PERMANENT_EVENT_STAMP_TICKS,
  type QuestIndex,
} from '../../src/domain/quests/questCompletion.ts';

// A linear chain Q1 <- Q2 <- Q3 (Q2 depends on Q1, Q3 on Q2), plus an isolated cross-dep C1
// that Q1 depends on (models the real catalog's cross-questline edges).
const loot = (m_lootType: number, m_lootQuantity: number, m_lootID = '') => ({
  m_lootType,
  m_lootID,
  m_lootQuantity,
  m_fromVaultQuantity: 0,
});

function quest(name: string, deps: string[], caps = 0): Quest {
  return {
    m_questName: name,
    m_questType: 0,
    title: name,
    m_questDependancies: deps,
    m_mandatoryRooms: caps ? [{ m_questRoomType: 1, m_combatLoot: loot(T.Nuka, caps) }] : [],
  } as Quest;
}

function makeIndex(): QuestIndex {
  return new Map([
    ['C1', quest('C1', [], 100)],
    ['Q1', quest('Q1', ['C1'], 200)],
    ['Q2', quest('Q2', ['Q1'], 400)],
    ['Q3', quest('Q3', ['Q2'], 800)],
  ]);
}

// `unlockables.recipes` backs the recipe draw pool, and uniqueDwellers/handies back the
// character grants; empty is fine here (this suite only grants caps) but they must EXIST -
// buildLootPools reads them for every completion.
const gameData = {
  weapons: [],
  outfits: [],
  junk: [],
  pets: [],
  handies: [],
  uniqueDwellers: {},
  unlockables: { recipes: [], roomUnlocks: [] },
} as unknown as GameData;

function saveWith(completed: string[]): SaveData {
  return {
    completedQuestDataManager: { taskID: 1, completedQuests: [...completed] },
    vault: { storage: { resources: { Nuka: 0 } } },
  } as unknown as SaveData;
}

describe('completion ledger reads', () => {
  it('completedQuestSet + isQuestComplete reflect the ledger', () => {
    const save = saveWith(['Q1']);
    expect(completedQuestSet(save)).toEqual(new Set(['Q1']));
    expect(isQuestComplete(save, 'Q1', makeIndex())).toBe(true);
    expect(isQuestComplete(save, 'Q2', makeIndex())).toBe(false);
  });

  it('treats a missing ledger as empty', () => {
    expect(completedQuestSet({} as SaveData)).toEqual(new Set());
  });
});

describe('questCompletionClosure (downward-closed, 5.6)', () => {
  it('returns the quest + all unmet transitive prereqs, prereqs-first', () => {
    const closure = questCompletionClosure(saveWith([]), 'Q3', makeIndex());
    expect(closure).toEqual(['C1', 'Q1', 'Q2', 'Q3']);
  });

  it('skips prereqs already completed', () => {
    const closure = questCompletionClosure(saveWith(['C1', 'Q1']), 'Q3', makeIndex());
    expect(closure).toEqual(['Q2', 'Q3']);
  });

  it('is empty when the quest is already complete', () => {
    expect(questCompletionClosure(saveWith(['C1', 'Q1', 'Q2', 'Q3']), 'Q3', makeIndex())).toEqual(
      [],
    );
  });
});

describe('completeQuest (ledger + loot in one edit)', () => {
  it('adds the whole closure and grants each newly-completed quest loot', () => {
    const result = completeQuest(saveWith([]), 'Q3', gameData, makeIndex());
    expect(result.completedNames).toEqual(['C1', 'Q1', 'Q2', 'Q3']);
    expect(result.save.completedQuestDataManager?.completedQuests).toEqual([
      'C1',
      'Q1',
      'Q2',
      'Q3',
    ]);
    // Caps loot summed across the four quests: 100 + 200 + 400 + 800 = 1500.
    expect(resources(result.save).Nuka).toBe(1500);
    expect(result.granted.every((l) => l.kind === 'resource')).toBe(true);
  });

  it('grants only the auto-completed remainder when some prereqs are already done', () => {
    const result = completeQuest(saveWith(['C1', 'Q1']), 'Q3', gameData, makeIndex());
    expect(result.completedNames).toEqual(['Q2', 'Q3']);
    expect(resources(result.save).Nuka).toBe(1200); // 400 + 800 only
  });

  it('is a no-op (same ref) when the quest is already complete', () => {
    const save = saveWith(['C1', 'Q1', 'Q2', 'Q3']);
    const result = completeQuest(save, 'Q3', gameData, makeIndex());
    expect(result.save).toBe(save);
    expect(result.granted).toEqual([]);
  });

  it('respects resource caps when supplied', () => {
    const result = completeQuest(saveWith([]), 'Q3', gameData, makeIndex(), {
      caps: { Nuka: 500 },
    });
    expect(resources(result.save).Nuka).toBe(500);
  });
});

describe('tip rules (5.7)', () => {
  it('isQuestTip: only a completed quest with no completed dependents is a tip', () => {
    const idx = makeIndex();
    const save = saveWith(['C1', 'Q1', 'Q2', 'Q3']);
    expect(isQuestTip(save, 'Q3', idx)).toBe(true); // nothing depends on Q3
    expect(isQuestTip(save, 'Q2', idx)).toBe(false); // Q3 depends on Q2
    expect(isQuestTip(save, 'Q1', idx)).toBe(false); // Q2 depends on Q1
  });

  it('a not-completed quest is never a tip', () => {
    expect(isQuestTip(saveWith(['C1']), 'Q1', makeIndex())).toBe(false);
  });

  it('completedDependents lists the blocking chain', () => {
    expect(completedDependents(saveWith(['C1', 'Q1', 'Q2', 'Q3']), 'Q1', makeIndex())).toEqual([
      'Q2',
    ]);
  });

  it('uncompleteQuest removes the name and never claws back loot', () => {
    const save = saveWith(['C1', 'Q1', 'Q2', 'Q3']);
    // pretend loot was granted earlier:
    (save.vault!.storage!.resources as Record<string, number>).Nuka = 1500;
    const next = uncompleteQuest(save, 'Q3', makeIndex());
    expect(next.completedQuestDataManager?.completedQuests).toEqual(['C1', 'Q1', 'Q2']);
    expect(resources(next).Nuka).toBe(1500); // unchanged - no clawback
  });

  it('uncompleteQuest is a no-op (same ref) for an absent name', () => {
    const save = saveWith(['Q1']);
    expect(uncompleteQuest(save, 'Nope', makeIndex())).toBe(save);
  });
});

// The TV Show questlines ship each step as parallel difficulty cuts (V_01_Diff10 / V_01_Diff40)
// that the game treats as ONE step for completion (includeQuestlineQuestVariants). Dailies use
// _Diff names too but are NOT equivalent (the game's variant rule is QuestlineQuest-only).
describe('difficulty variants (QuestlineQuest _Diff cuts are one step)', () => {
  function variantIndex(): QuestIndex {
    const daily = (name: string): Quest => ({ ...quest(name, []), m_questType: 3 }) as Quest;
    return new Map([
      ['V_01_Diff10', quest('V_01_Diff10', [], 100)],
      ['V_01_Diff40', quest('V_01_Diff40', [], 100)],
      ['V_02_Diff10', quest('V_02_Diff10', ['V_01_Diff10'], 200)],
      ['V_02_Diff40', quest('V_02_Diff40', ['V_01_Diff40'], 200)],
      ['D_01_Diff10', daily('D_01_Diff10')],
      ['D_01_Diff40', daily('D_01_Diff40')],
    ]);
  }

  it('questVariantKey: questline cuts share a key; dailies and unknown names key as themselves', () => {
    const idx = variantIndex();
    expect(questVariantKey('V_01_Diff10', idx)).toBe('V_01_Diff');
    expect(questVariantKey('V_01_Diff40', idx)).toBe('V_01_Diff');
    expect(questVariantKey('D_01_Diff10', idx)).toBe('D_01_Diff10');
    expect(questVariantKey('Unknown_Diff40', idx)).toBe('Unknown_Diff40');
  });

  it('a step is complete when any of its cuts is in the ledger', () => {
    const save = saveWith(['V_01_Diff40']);
    expect(isQuestComplete(save, 'V_01_Diff10', variantIndex())).toBe(true);
    expect(isQuestComplete(save, 'V_02_Diff10', variantIndex())).toBe(false);
  });

  it('closure skips a dep whose other cut is done - no double-complete, no double loot', () => {
    const save = saveWith(['V_01_Diff40']);
    expect(questCompletionClosure(save, 'V_02_Diff10', variantIndex())).toEqual(['V_02_Diff10']);
    const result = completeQuest(save, 'V_02_Diff10', gameData, variantIndex());
    expect(result.completedNames).toEqual(['V_02_Diff10']);
    expect(resources(result.save).Nuka).toBe(200); // step 1's 100 caps NOT granted again
  });

  it('tip rules see through variants: a completed later cut blocks un-completing the earlier step', () => {
    const save = saveWith(['V_01_Diff40', 'V_02_Diff10']);
    expect(isQuestTip(save, 'V_01_Diff40', variantIndex())).toBe(false);
    expect(completedDependents(save, 'V_01_Diff40', variantIndex())).toEqual(['V_02_Diff10']);
    expect(isQuestTip(save, 'V_02_Diff10', variantIndex())).toBe(true);
  });

  it('uncompleteQuest removes every cut of the step', () => {
    const save = saveWith(['V_01_Diff10', 'V_01_Diff40']);
    const next = uncompleteQuest(save, 'V_01_Diff40', variantIndex());
    expect(next.completedQuestDataManager?.completedQuests).toEqual([]);
  });

  it('daily _Diff names stay independent', () => {
    const save = saveWith(['D_01_Diff10']);
    expect(isQuestComplete(save, 'D_01_Diff40', variantIndex())).toBe(false);
    const next = uncompleteQuest(save, 'D_01_Diff10', variantIndex());
    expect(next.completedQuestDataManager?.completedQuests).toEqual([]);
  });
});

// Dated EventQuests are un-completed by the game on quest-list open unless their
// eventQuestCompletedTimes stamp is younger than the ~180-day cooldown - or, for the editor's
// purposes, pinned far in the future so it never expires (see PERMANENT_EVENT_STAMP_TICKS).
describe('event-quest completion stamps', () => {
  const eventQuest = (name: string, deps: string[], caps: number, year = 2017): Quest =>
    ({
      ...quest(name, deps, caps),
      m_questType: 5,
      m_startDate: { m_year: year, m_month: 2, m_day: 10 },
    }) as Quest;

  function eventIndex(): QuestIndex {
    return new Map([
      ['E1', eventQuest('E1', [], 100)],
      ['E2', eventQuest('E2', ['E1'], 200)],
      ['Sentinel', eventQuest('Sentinel', [], 100, 1970)],
      ['Q1', quest('Q1', [], 100)],
    ]);
  }

  it('isReactivatingEventQuest: dated event quests only', () => {
    const idx = eventIndex();
    expect(isReactivatingEventQuest(idx.get('E1')!)).toBe(true);
    expect(isReactivatingEventQuest(idx.get('Sentinel')!)).toBe(false); // year < 2000 is exempt
    expect(isReactivatingEventQuest(idx.get('Q1')!)).toBe(false); // not an EventQuest
  });

  it('completeQuest pins a stamp for every newly-completed dated event quest', () => {
    const result = completeQuest(saveWith([]), 'E2', gameData, eventIndex());
    expect(result.completedNames).toEqual(['E1', 'E2']);
    expect(result.save.completedQuestDataManager?.eventQuestCompletedTimes).toEqual({
      E1: PERMANENT_EVENT_STAMP_TICKS,
      E2: PERMANENT_EVENT_STAMP_TICKS,
    });
  });

  it('writes no stamps for non-event or sentinel-dated quests', () => {
    const noStamp = completeQuest(saveWith([]), 'Q1', gameData, eventIndex());
    expect(noStamp.save.completedQuestDataManager?.eventQuestCompletedTimes).toBeUndefined();
    const sentinel = completeQuest(saveWith([]), 'Sentinel', gameData, eventIndex());
    expect(sentinel.save.completedQuestDataManager?.eventQuestCompletedTimes).toBeUndefined();
  });

  it('preserves existing stamps and the stamp survives to a JSON round-trip intact', () => {
    const save = saveWith([]);
    save.completedQuestDataManager!.eventQuestCompletedTimes = { Old: 42 };
    const result = completeQuest(save, 'E1', gameData, eventIndex());
    const times = result.save.completedQuestDataManager?.eventQuestCompletedTimes;
    expect(times).toEqual({ Old: 42, E1: PERMANENT_EVENT_STAMP_TICKS });
    // The game reads the value back as a C# long via (long)value: it must serialize as a plain
    // integer literal, not scientific notation.
    expect(JSON.stringify(times?.E1)).toMatch(/^\d+$/);
  });

  it('uncompleteQuest removes the stamp with the ledger entry', () => {
    const done = completeQuest(saveWith([]), 'E2', gameData, eventIndex()).save;
    const next = uncompleteQuest(done, 'E2', eventIndex());
    expect(next.completedQuestDataManager?.completedQuests).toEqual(['E1']);
    expect(next.completedQuestDataManager?.eventQuestCompletedTimes).toEqual({
      E1: PERMANENT_EVENT_STAMP_TICKS,
    });
  });
});
