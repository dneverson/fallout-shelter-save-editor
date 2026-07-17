// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Quest, Questline, QuestlineNode } from '../../src/domain/gamedata/schemas.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  EMPTY_QUEST_FILTER,
  filterQuestCatalog,
  isFilterActive,
  isSeasonOpen,
  questFacetOptions,
  questNodeKey,
  questRewardBuckets,
  questSaveContext,
  questStatuses,
  type QuestFilter,
} from '../../src/domain/quests/questFilter.ts';
import { buildQuestMapLayout } from '../../src/domain/quests/questGraphLayout.ts';

function node(id: string, deps: string[], questNames = [id]): QuestlineNode {
  return { id, title: id, questNames, dependencies: deps } as QuestlineNode;
}
function line(title: string, nodes: QuestlineNode[]): Questline {
  return { title, nodes } as Questline;
}
function quest(name: string, type: number, extra: Partial<Quest> = {}): Quest {
  return { m_questName: name, m_questType: type, title: name, ...extra } as Quest;
}
/** A chain quest: type 0 + a questlineTitle is what makes it a story step. */
function chainQuest(name: string, questlineTitle: string, deps: string[] = []): Quest {
  return quest(name, 0, { questlineTitle, m_questDependancies: deps, m_isVisible: 1 });
}
/**
 * A seasonal (EQuestType 5) story step gated by a `[month, day]` window. The years mirror the
 * catalog's own stale authoring stamps, which the season check is meant to ignore.
 */
function seasonalQuest(
  name: string,
  questlineTitle: string,
  [startMonth, startDay]: [number, number],
  [endMonth, endDay]: [number, number],
): Quest {
  return quest(name, 5, {
    questlineTitle,
    m_isVisible: 1,
    m_isTimeLimited: 1,
    m_startDate: { m_year: 2016, m_month: startMonth, m_day: startDay, m_hour: 12 },
    m_endDate: { m_year: 2017, m_month: endMonth, m_day: endDay, m_hour: 12 },
  });
}
/** Mid-July: no holiday window is open, which is what makes it a useful "out of season" date. */
const JULY_14 = new Date(2026, 6, 14);
const filter = (over: Partial<QuestFilter>): QuestFilter => ({ ...EMPTY_QUEST_FILTER, ...over });

// Alpha: A1 <- A2 <- A3, plus a sibling branch A2 <- A4.
// Bravo: B1 <- B2, where B1 depends on A3 (a cross-lane link, so Alpha+Bravo are ONE cluster).
// Charlie: C1 alone, unconnected to either.
const lineA = line('Alpha', [
  node('A1', []),
  node('A2', ['A1']),
  node('A3', ['A2']),
  node('A4', ['A2']),
]);
const lineB = line('Bravo', [node('B1', ['A3']), node('B2', ['B1'])]);
const lineC = line('Charlie', [node('C1', [])]);
const questlines = [lineA, lineB, lineC];

const chainQuests = [
  chainQuest('A1', 'Alpha'),
  chainQuest('A2', 'Alpha', ['A1']),
  chainQuest('A3', 'Alpha', ['A2']),
  chainQuest('A4', 'Alpha', ['A2']),
  chainQuest('B1', 'Bravo', ['A3']),
  chainQuest('B2', 'Bravo', ['B1']),
  chainQuest('C1', 'Charlie'),
];
const daily = quest('Daily_01', 3, { m_isRepeatable: 1 });
const standalone = quest('Standalone_26', 1);
const allQuests = [...chainQuests, daily, standalone];

const saveWith = (over: Record<string, unknown>): SaveData => over as SaveData;

describe('questSaveContext - the log is read from the pickers, not derived', () => {
  it('reads the rotation the game is actually offering', () => {
    const ctx = questSaveContext(
      saveWith({
        completedQuestDataManager: {
          completedQuests: ['A1'],
          standaloneQuestPicker: { currentStandalone: 'Standalone_26' },
          dailyQuestPicker: { currentDailies: [{ questName: 'Daily_01' }] },
          weeklyQuestPicker: { currentWeeklies: [{ questName: 'Weekly_13' }] },
        },
      }),
      allQuests,
    );
    expect(ctx.inLog.has('Standalone_26')).toBe(true);
    expect(ctx.inLog.has('Daily_01')).toBe(true);
    expect(ctx.inLog.has('Weekly_13')).toBe(true);
  });

  it('offers only the unlocked story step, not every dependency-free quest', () => {
    const ctx = questSaveContext(
      saveWith({ completedQuestDataManager: { completedQuests: ['A1'] } }),
      allQuests,
    );
    // A2 unlocked (A1 done). A3/A4 still gated on A2; A1 already done.
    expect(ctx.inLog.has('A2')).toBe(true);
    expect(ctx.inLog.has('A3')).toBe(false);
    expect(ctx.inLog.has('A1')).toBe(false);
    // The un-rolled daily is dependency-free but NOT offered - the picker never named it.
    expect(ctx.inLog.has('Daily_01')).toBe(false);
  });

  it('treats difficulty variants of a step as the same step', () => {
    const quests = [
      chainQuest('Show_01_Diff_30', 'Show'),
      chainQuest('Show_02_Diff_40', 'Show', ['Show_01_Diff_40']),
    ];
    // The save completed the Diff_30 cut; step 02 depends on the Diff_40 cut of the same step.
    const ctx = questSaveContext(
      saveWith({ completedQuestDataManager: { completedQuests: ['Show_01_Diff_30'] } }),
      quests,
    );
    expect(ctx.inLog.has('Show_02_Diff_40')).toBe(true);
  });

  it('hidden story steps never reach the log', () => {
    const hidden = [quest('H1', 0, { questlineTitle: 'Hidden', m_isVisible: 0 })];
    const ctx = questSaveContext(saveWith({ completedQuestDataManager: {} }), hidden);
    expect(ctx.inLog.size).toBe(0);
  });

  it('keeps out-of-season holiday lines out of the log', () => {
    // Every seasonal line's opening step is dependency-free, so without the season check all of
    // them look permanently unlocked. Halloween must not be on offer in July.
    const ctx = questSaveContext(
      saveWith({ completedQuestDataManager: {} }),
      [seasonalQuest('Spooky_01', 'Halloween', [10, 12], [11, 1])],
      JULY_14,
    );
    expect(ctx.inLog.size).toBe(0);
  });

  it('offers a holiday line once its season comes round', () => {
    const ctx = questSaveContext(
      saveWith({ completedQuestDataManager: {} }),
      [seasonalQuest('Spooky_01', 'Halloween', [10, 12], [11, 1])],
      new Date(2026, 9, 20),
    );
    expect(ctx.inLog.has('Spooky_01')).toBe(true);
  });
});

describe('isSeasonOpen - windows recur annually', () => {
  const halloween = seasonalQuest('Spooky_01', 'Halloween', [10, 12], [11, 1]);
  // Vault-Tec Saves Christmas! really does run 12-14..01-02, wrapping the new year.
  const holidays = seasonalQuest('Xmas_01', 'Holidays', [12, 14], [1, 2]);

  it('ignores the authoring years, matching on month/day only', () => {
    // The catalog windows are stamped 2016/2017 and the game still runs these events every year,
    // so a year-aware comparison would retire every holiday line permanently.
    expect(isSeasonOpen(halloween, new Date(2026, 9, 20))).toBe(true);
    expect(isSeasonOpen(halloween, new Date(2031, 9, 20))).toBe(true);
  });

  it('closes the window outside the month/day range', () => {
    expect(isSeasonOpen(halloween, JULY_14)).toBe(false);
    expect(isSeasonOpen(halloween, new Date(2026, 10, 15))).toBe(false);
  });

  it('treats both endpoints as inclusive whole days', () => {
    expect(isSeasonOpen(halloween, new Date(2026, 9, 12))).toBe(true);
    expect(isSeasonOpen(halloween, new Date(2026, 10, 1))).toBe(true);
    expect(isSeasonOpen(halloween, new Date(2026, 9, 11))).toBe(false);
    expect(isSeasonOpen(halloween, new Date(2026, 10, 2))).toBe(false);
  });

  it('handles a window that wraps the new year', () => {
    expect(isSeasonOpen(holidays, new Date(2026, 11, 30))).toBe(true); // Dec 30, after start
    expect(isSeasonOpen(holidays, new Date(2026, 0, 1))).toBe(true); // Jan 1, before end
    expect(isSeasonOpen(holidays, JULY_14)).toBe(false);
  });

  it('leaves quests that are not time-limited permanently open', () => {
    // The 992 non-time-limited quests carry a 1970..2100 sentinel window that must not be read
    // as a month/day range - Jan 1..Jan 1 would close them for all but one day of the year.
    const always = quest('Standalone_26', 1, {
      m_isTimeLimited: 0,
      m_startDate: { m_year: 1970, m_month: 1, m_day: 1, m_hour: 0 },
      m_endDate: { m_year: 2100, m_month: 1, m_day: 1, m_hour: 0 },
    });
    expect(isSeasonOpen(always, JULY_14)).toBe(true);
    expect(isSeasonOpen(always, new Date(2026, 5, 3))).toBe(true);
  });
});

describe('questSaveContext - rotation, skips and deployment', () => {
  it('flags a lapsed rotation instead of silently reporting an empty log', () => {
    const ctx = questSaveContext(
      saveWith({
        completedQuestDataManager: {
          dailyQuestPicker: { currentDailies: [], historyDailies: [{ questName: 'Daily_20_C' }] },
          weeklyQuestPicker: { currentWeeklies: [] },
        },
      }),
      allQuests,
    );
    expect(ctx.rotationExpired).toBe(true);
  });

  it('a save that never rolled a rotation is not "expired"', () => {
    const ctx = questSaveContext(saveWith({ completedQuestDataManager: {} }), allQuests);
    expect(ctx.rotationExpired).toBe(false);
  });

  it('collects skipped quests across all three skippers', () => {
    const ctx = questSaveContext(
      saveWith({
        completedQuestDataManager: {
          standaloneQuestSkipper: { skippedQuests: [{ questName: 'Standalone_53' }] },
          dailyQuestSkipper: { skippedQuests: [{ questName: 'Daily_23_C' }] },
        },
      }),
      allQuests,
    );
    expect([...ctx.skipped].sort()).toEqual(['Daily_23_C', 'Standalone_53']);
  });

  it('reads deployed from a wasteland team and from an in-flight questDataManager', () => {
    const ctx = questSaveContext(
      saveWith({
        vault: { wasteland: { teams: [{ isDoingQuest: true, questName: 'A2' }] } },
        questDataManager: { questDone: false, questTeam: { CurrentQuestID: 'B1' } },
      }),
      allQuests,
    );
    expect([...ctx.deployed].sort()).toEqual(['A2', 'B1']);
  });

  it('a FINISHED questDataManager run is not deployed', () => {
    const ctx = questSaveContext(
      saveWith({ questDataManager: { questDone: true, questTeam: { CurrentQuestID: 'A2' } } }),
      allQuests,
    );
    expect(ctx.deployed.size).toBe(0);
  });

  it('survives a save with no quest managers at all', () => {
    const ctx = questSaveContext(saveWith({}), allQuests);
    expect(ctx.completed.size).toBe(0);
    expect(ctx.skipped.size).toBe(0);
    expect(ctx.deployed.size).toBe(0);
    expect(ctx.rotationExpired).toBe(false);
    // A fresh vault still offers the opening step of every chain: they depend on nothing.
    expect([...ctx.inLog].sort()).toEqual(['A1', 'C1']);
  });
});

describe('filterQuestCatalog - a chain match drags in its whole cluster', () => {
  const ctx = questSaveContext(
    saveWith({ completedQuestDataManager: { completedQuests: [] } }),
    allQuests,
  );

  it('expands one chain hit to prerequisites, follow-ups, branches AND linked lanes', () => {
    // Match A3 alone. It must pull in its past (A1, A2), its sibling branch (A4), and the
    // Bravo lane that links to it - but never the unconnected Charlie.
    const out = filterQuestCatalog(questlines, allQuests, filter({ questlines: ['Alpha'] }), ctx);
    const ids = out.questlines.flatMap((ql) => ql.nodes.map((n) => n.id)).sort();
    expect(ids).toEqual(['A1', 'A2', 'A3', 'A4', 'B1', 'B2']);
    expect(out.questlines.map((ql) => ql.title).sort()).toEqual(['Alpha', 'Bravo']);
  });

  it('drops clusters with no hit at all', () => {
    const out = filterQuestCatalog(questlines, allQuests, filter({ questlines: ['Charlie'] }), ctx);
    expect(out.questlines.map((ql) => ql.title)).toEqual(['Charlie']);
  });

  it('a text hit that fails another facet is context, not a match', () => {
    // The ↑/↓ stepper reads `matched`, so this is the fact that keeps it off chain context.
    // "Alpha" hits all four Alpha steps on questline title alone, but Status=In-log leaves only
    // A1 an actual match: A2-A4 are locked and B1/B2 arrive purely as cluster expansion. All six
    // are DRAWN; exactly one is a match. Re-deriving the hit list by text - which the stepper
    // used to do - answers 4 here, and steps onto three quests the filter rejected.
    const out = filterQuestCatalog(
      questlines,
      allQuests,
      filter({ search: 'Alpha', status: ['inLog'] }),
      ctx,
    );
    expect([...out.matched]).toEqual(['A1']);
    expect(out.quests.map((q) => q.m_questName).sort()).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'B1',
      'B2',
    ]);
  });

  it('search alone makes every drawn chain member a match, which is why the bug hid', () => {
    // With search as the ONLY facet, a text hit IS a match, so a text-derived hit list and the
    // real match set agree exactly and nothing escapes. That is the case people try first.
    const out = filterQuestCatalog(questlines, allQuests, filter({ search: 'Alpha' }), ctx);
    expect([...out.matched].sort()).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('shows locked chain members - lock state must not cut the line short', () => {
    // A1 done -> only A2 is in the log; A3/A4/B1/B2 are all still locked, but the point is the
    // full picture. C1 is completed too, so Charlie contributes no seed and drops out entirely.
    const logCtx = questSaveContext(
      saveWith({ completedQuestDataManager: { completedQuests: ['A1', 'C1'] } }),
      allQuests,
    );
    const out = filterQuestCatalog(questlines, allQuests, filter({ status: ['inLog'] }), logCtx);
    const ids = out.questlines.flatMap((ql) => ql.nodes.map((n) => n.id)).sort();
    expect(ids).toEqual(['A1', 'A2', 'A3', 'A4', 'B1', 'B2']);
  });

  it('does NOT leak a filtered-out chain quest into the flat quest list', () => {
    // Regression guard: buildQuestMapLayout infers "is chained" from the questlines it is given,
    // so a dropped chain quest left in `quests` would resurface as a bogus Standalone node.
    const out = filterQuestCatalog(questlines, allQuests, filter({ questlines: ['Charlie'] }), ctx);
    expect(out.quests.map((q) => q.m_questName)).toEqual(['C1']);
  });

  it('filters flat quests one-by-one (they have no cluster to expand)', () => {
    const out = filterQuestCatalog(questlines, allQuests, filter({ types: [3] }), ctx);
    expect(out.quests.map((q) => q.m_questName)).toEqual(['Daily_01']);
    expect(out.questlines).toEqual([]);
  });

  it('an inactive filter returns the inputs untouched', () => {
    const out = filterQuestCatalog(questlines, allQuests, EMPTY_QUEST_FILTER, ctx);
    expect(out.questlines).toBe(questlines);
    expect(out.quests).toBe(allQuests);
  });

  it('reports pre-expansion matches so the UI can distinguish hits from context', () => {
    const out = filterQuestCatalog(questlines, allQuests, filter({ questlines: ['Bravo'] }), ctx);
    expect([...out.matched].sort()).toEqual(['B1', 'B2']);
    // ...while the drawn map still carries the whole cluster.
    expect(out.questlines.flatMap((ql) => ql.nodes.map((n) => n.id))).toContain('A1');
  });
});

describe('filterQuestCatalog - facets', () => {
  const ctx = questSaveContext(saveWith({}), allQuests);
  const names = (f: QuestFilter) =>
    filterQuestCatalog(questlines, allQuests, f, ctx).quests.map((q) => q.m_questName);

  it('ANDs across facets and ORs within one', () => {
    expect(names(filter({ types: [1, 3] })).sort()).toEqual(['Daily_01', 'Standalone_26']);
    expect(names(filter({ types: [1, 3], flags: ['repeatable'] }))).toEqual(['Daily_01']);
  });

  it('regions mirror the map sections', () => {
    expect(names(filter({ regions: ['repeatable'] }))).toEqual(['Daily_01']);
    expect(names(filter({ regions: ['standalone'] }))).toEqual(['Standalone_26']);
  });

  it('difficulty matches on range OVERLAP, not containment', () => {
    const quests = [quest('Q', 1, { m_questDifficultyMin: 7, m_questDifficultyMax: 42 })];
    const overlap = filterQuestCatalog(
      [],
      quests,
      filter({ difficulty: { min: 30, max: 60 } }),
      ctx,
    );
    expect(overlap.quests).toHaveLength(1);
    const outside = filterQuestCatalog(
      [],
      quests,
      filter({ difficulty: { min: 50, max: 60 } }),
      ctx,
    );
    expect(outside.quests).toHaveLength(0);
  });

  it('isFilterActive tracks every facet', () => {
    expect(isFilterActive(EMPTY_QUEST_FILTER)).toBe(false);
    expect(isFilterActive(filter({ difficulty: { min: 0, max: 60 } }))).toBe(true);
    expect(isFilterActive(filter({ rewards: ['caps'] }))).toBe(true);
  });

  it('treats search as a facet: it ANDs with the others and expands chains', () => {
    // A text hit on A3 drags in its whole cluster (Alpha + Bravo), exactly like any other match.
    const hit = filterQuestCatalog(questlines, allQuests, filter({ search: 'A3' }), ctx);
    expect([...hit.matched]).toEqual(['A3']);
    expect(hit.quests.map((q) => q.m_questName).sort()).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'B1',
      'B2',
    ]);
    // ANDs with the dropdowns: A3 is a chain quest, so a Standalone region filter kills it.
    const anded = filterQuestCatalog(
      questlines,
      allQuests,
      filter({ search: 'A3', regions: ['standalone'] }),
      ctx,
    );
    expect(anded.matched.size).toBe(0);
  });

  it('a blank search constrains nothing', () => {
    expect(isFilterActive(filter({ search: '   ' }))).toBe(false);
    expect(names(filter({ search: '' })).length).toBe(allQuests.length);
  });

  it('search matches title, quest id and questline alike', () => {
    expect(names(filter({ search: 'charlie' }))).toEqual(['C1']); // questline title
    expect(names(filter({ search: 'standalone_26' }))).toEqual(['Standalone_26']); // quest id
  });

  it('ORs within the Flags facet, like every other facet', () => {
    // Excel semantics: ticking a second box in one column widens the result. This used to AND,
    // which turned "Repeatable or Hidden" into "Repeatable AND Hidden" and returned nothing.
    const quests = [
      quest('Rep', 1, { m_isRepeatable: 1 }),
      quest('Hid', 1, { m_isVisible: 0 }),
      quest('Plain', 1, {}),
    ];
    const picked = filterQuestCatalog(
      [],
      quests,
      filter({ flags: ['repeatable', 'hidden'] }),
      ctx,
    ).quests.map((q) => q.m_questName);
    expect(picked.sort()).toEqual(['Hid', 'Rep']);
  });
});

describe('questFacetOptions - Excel-style cascading lists', () => {
  const ctx = questSaveContext(saveWith({}), allQuests);

  it('offers only values that still yield a match under the other facets', () => {
    // Region=repeatable leaves only Daily_01, so Type must stop offering Standalone (1).
    const opts = questFacetOptions(questlines, allQuests, filter({ regions: ['repeatable'] }), ctx);
    expect([...opts.types.keys()]).toEqual([3]);
  });

  it('ignores its OWN facet, so a selection can still be widened', () => {
    // The whole point of Excel building a column's list from the OTHER columns: with Type=Daily
    // ticked, the Type list must still offer Standalone or you could never ask for "Daily or
    // Standalone".
    const opts = questFacetOptions(questlines, allQuests, filter({ types: [3] }), ctx);
    expect(opts.types.has(1)).toBe(true);
  });

  it('does not count chain context, which cannot be filtered to', () => {
    // A fresh vault has A1 and C1 in the log. A1 is a real match, so Alpha is offered. Bravo is
    // drawn too (B1 depends on A3, so Alpha and Bravo are one cluster) but holds no match, so
    // offering it would promise a result the filter cannot deliver.
    const opts = questFacetOptions(questlines, allQuests, filter({ status: ['inLog'] }), ctx);
    expect(opts.questlines.has('Alpha')).toBe(true);
    expect(opts.questlines.has('Charlie')).toBe(true);
    expect(opts.questlines.has('Bravo')).toBe(false);
  });

  it('narrows every list-backed facet at once', () => {
    const opts = questFacetOptions(questlines, allQuests, filter({ questlines: ['Charlie'] }), ctx);
    expect([...opts.regions.keys()]).toEqual(['chain']);
    expect([...opts.types.keys()]).toEqual([0]);
  });

  it('counts what ticking each value would leave', () => {
    const opts = questFacetOptions(questlines, allQuests, EMPTY_QUEST_FILTER, ctx);
    // Alpha's 4 steps, Bravo's 2, Charlie's 1: chains (7) + the daily (1) + the standalone (1).
    expect(opts.types.get(0)).toBe(7);
    expect(opts.types.get(3)).toBe(1);
    expect(opts.types.get(1)).toBe(1);
    expect(opts.regions.get('chain')).toBe(7);
    expect(opts.questlines.get('Alpha')).toBe(4);
  });

  it('counts a value against the OTHER facets, not the map it would draw', () => {
    // Questline=Alpha is 4 matches; the map would then draw Bravo's 2 as well, since B1 depends
    // on A3. The count answers the filter, not the chain expansion, so it stays 4.
    const opts = questFacetOptions(questlines, allQuests, filter({ regions: ['chain'] }), ctx);
    expect(opts.questlines.get('Alpha')).toBe(4);
    expect(opts.questlines.get('Bravo')).toBe(2);
  });

  it('counts each collapsed card once, however many variants sit behind it', () => {
    // Three difficulty cuts of one repeatable, which the map draws as a single title card.
    const variants = [30, 40, 50].map((d) =>
      quest(`Gauntlet_Diff_${d}`, 3, { title: 'Game Show Gauntlet' }),
    );
    const opts = questFacetOptions(
      [],
      variants,
      EMPTY_QUEST_FILTER,
      questSaveContext(saveWith({}), variants),
    );
    expect(opts.types.get(3)).toBe(1);
  });

  it('omits a value that can no longer match, rather than counting it 0', () => {
    // Type=Standalone(1) cannot coexist with Region=repeatable, so 1 leaves the map entirely.
    // Absent and 0 mean the same thing to the bar, which reads a missing count as 0 - that is
    // what lets it keep a ticked-but-now-dead value on screen, showing 0, so it can be un-ticked.
    const opts = questFacetOptions(questlines, allQuests, filter({ regions: ['repeatable'] }), ctx);
    expect(opts.types.has(1)).toBe(false);
  });
});

describe('questStatuses - completed is variant-aware', () => {
  it('a questline step reads completed when its OTHER difficulty cut is in the ledger', () => {
    const cuts = [
      chainQuest('Show_01_Diff10', 'Show'),
      chainQuest('Show_01_Diff40', 'Show'),
      quest('D_01_Diff10', 3),
      quest('D_01_Diff40', 3),
    ];
    const ctx = questSaveContext(
      saveWith({
        completedQuestDataManager: { completedQuests: ['Show_01_Diff40', 'D_01_Diff40'] },
      }),
      cuts,
      JULY_14,
    );
    expect(questStatuses(cuts[0], ctx)).toContain('completed'); // via the Diff40 cut
    expect(questStatuses(cuts[2], ctx)).toContain('incomplete'); // dailies are NOT variants
    expect(questStatuses(cuts[3], ctx)).toContain('completed');
  });
});

describe('questNodeKey - mirrors the layout the counts are quoted in', () => {
  it('reproduces buildQuestMapLayout node ids exactly', () => {
    // The facet counts are only honest while this mirror holds: they count node keys, but what
    // the user then sees on screen is buildQuestMapLayout's nodes.
    const layout = buildQuestMapLayout(questlines, allQuests);
    const chainIds = new Set(questlines.flatMap((ql) => ql.nodes.map((n) => n.id)));
    const keys = new Set(allQuests.map((q) => questNodeKey(q, chainIds)));
    expect([...keys].sort()).toEqual([...layout.nodes.map((n) => n.id)].sort());
  });

  it('collapses difficulty variants onto their chain step', () => {
    const chainIds = new Set(['Show_01']);
    const key = questNodeKey(chainQuest('Show_01_Diff_40', 'Show'), chainIds);
    expect(key).toBe('Show_01');
  });
});

describe('questRewardBuckets', () => {
  it('collapses concrete and Random* loot types into one bucket', () => {
    const q = quest('Q', 1, {
      m_mandatoryRooms: [
        {
          m_combatLoot: { m_lootType: 1 }, // Weapon
          m_roomCompletionLoot: { m_lootType: 102 }, // RandomRareWeapon
          m_pickableLoot: [{ m_lootType: 5 }], // Nuka -> caps
          m_extraRoomCompletionLoot: [{ m_lootType: 107 }], // RandomCommonPet
        },
      ],
    } as Partial<Quest>);
    expect([...questRewardBuckets(q)].sort()).toEqual(['caps', 'pet', 'weapon']);
  });

  it('a quest with no rooms yields no buckets', () => {
    expect(questRewardBuckets(quest('Q', 1)).size).toBe(0);
  });
});
