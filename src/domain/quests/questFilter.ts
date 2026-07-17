import type { Quest, QuestLoot, Questline } from '../gamedata/schemas.ts';
import type { SaveData } from '../model/saveSchema.ts';
import { questVariantKeyOf } from './questCompletion.ts';
import { baseName, type QuestMapRegion } from './questGraphLayout.ts';
import { EQuestLootType } from './questLoot.ts';
import { questMatchesQuery } from './questSearch.ts';

// Quest-map filtering (Quests tab). Pure: turns the catalog + a QuestFilter into the SUBSET of
// questlines/quests to lay out, so QuestsView can hand the result straight back to
// buildQuestMapLayout and get a re-packed map. No React, no I/O - unit-testable in Node.
//
// Two rules drive the whole module:
//
//  1. "In quest log" is READ FROM THE SAVE, not derived. A quest being unlocked (all
//     m_questDependancies complete) is NOT the same as being offered: dailies/weeklies/
//     surprises declare no dependencies, so ~790 of the 1040 catalog quests are trivially
//     unlocked and "unlocked" filters almost nothing. The game rolls a small rotation into
//     completedQuestDataManager's picker fields, and that rotation IS the log. Only the story
//     chains are computed (they have no picker - they unlock by dependency).
//
//  2. A match DRAGS IN ITS WHOLE CHAIN CLUSTER. Filtering a graph node-by-node would show
//     "current quests with no past and no future". So chain matches are expanded over the
//     dependency graph UNDIRECTED, which pulls in prerequisites, follow-ups, sibling branches
//     and any questline linked by a cross-lane edge. Lock state is deliberately ignored during
//     expansion: the point is to see the whole line, not only the reachable part of it.

// --- filter model -----------------------------------------------------------------------

/** Save-derived quest states. `inLog` is the rotation the player can actually select. */
export type QuestStatus = 'inLog' | 'completed' | 'incomplete' | 'skipped' | 'deployed';

/** Catalog boolean flags (Unity stores them as 0/1 ints). */
export type QuestFlag = 'repeatable' | 'timeLimited' | 'hidden';

/** Coarse reward groups: the Random* loot types collapse into their concrete counterpart. */
export type RewardBucket =
  | 'weapon'
  | 'outfit'
  | 'pet'
  | 'dweller'
  | 'junk'
  | 'recipe'
  | 'recipeParts'
  | 'caps'
  | 'quantum'
  | 'consumable'
  | 'lunchbox'
  | 'mrHandy'
  | 'clue'
  | 'pokerChip';

/**
 * One facet per field. An EMPTY array means "no constraint" for that facet. Facets AND together;
 * values inside a facet OR together (so `types: [3, 4]` is "Daily or Weekly").
 */
export interface QuestFilter {
  status: readonly QuestStatus[];
  types: readonly number[];
  schemes: readonly number[];
  environments: readonly number[];
  regions: readonly QuestMapRegion[];
  /** Questline titles (the graph's lane titles). */
  questlines: readonly string[];
  flags: readonly QuestFlag[];
  /** Inclusive difficulty window; matches when the quest's own min..max range OVERLAPS it. */
  difficulty: { min: number; max: number } | null;
  rewards: readonly RewardBucket[];
  /**
   * Free text over title / quest id / questline. Just another facet: it ANDs with the rest, and a
   * text hit inside a chain drags in that chain exactly like any other match. Blank = no
   * constraint.
   */
  search: string;
}

export const EMPTY_QUEST_FILTER: QuestFilter = {
  status: [],
  types: [],
  schemes: [],
  environments: [],
  regions: [],
  questlines: [],
  flags: [],
  difficulty: null,
  rewards: [],
  search: '',
};

/** Does `filter` constrain anything? A filter with every facet empty is a no-op. */
export function isFilterActive(filter: QuestFilter): boolean {
  return (
    filter.status.length > 0 ||
    filter.types.length > 0 ||
    filter.schemes.length > 0 ||
    filter.environments.length > 0 ||
    filter.regions.length > 0 ||
    filter.questlines.length > 0 ||
    filter.flags.length > 0 ||
    filter.difficulty !== null ||
    filter.rewards.length > 0 ||
    filter.search.trim() !== ''
  );
}

// --- save-derived context ---------------------------------------------------------------

/** The save-side facts the status facet needs, resolved once per save. */
export interface QuestSaveContext {
  /** Names in the completion ledger, verbatim. */
  completed: ReadonlySet<string>;
  /**
   * Variant keys of the ledger names (questVariantKeyOf): the set the completed STATUS tests, so
   * a QuestlineQuest whose other difficulty cut is in the ledger reads as completed - the same
   * equivalence the game's own checks and the map's node colouring use.
   */
  completedKeys: ReadonlySet<string>;
  /** Names the quest log is offering right now (pickers + unlocked story steps). */
  inLog: ReadonlySet<string>;
  /** Names the player skipped out of a rotation. */
  skipped: ReadonlySet<string>;
  /** Names with a team out on them right now (usually 0 or 1). */
  deployed: ReadonlySet<string>;
  /** True when the daily/weekly rotations have lapsed and the game will re-roll them on load. */
  rotationExpired: boolean;
}

/** EQuestType values that form dependency chains (narrative + seasonal lines). */
const CHAIN_QUEST_TYPES = new Set([0, 5]);

/**
 * Is `quest`'s seasonal window open on `now`? Non-time-limited quests are always open.
 *
 * The catalog splits cleanly: 48 quests set m_isTimeLimited and carry a real window, the other
 * 992 leave it clear and carry a 1970..2100 sentinel. So the flag alone decides whether there is
 * a window to honour.
 *
 * THE WINDOW RECURS ANNUALLY - only month/day are compared and the years are authoring metadata.
 * The save proves it. The Irish line's window is 2018-03-10..2999-03-19, which a literal
 * year-aware comparison would call open every day for the next thousand years, yet the game does
 * not offer it in July. Read as month/day, every event lands on its holiday instead: Halloween
 * 10-12..11-01, Valentines 02-10..02-17, Thanksgiving 11-18..11-28. Windows may wrap the new year
 * (Vault-Tec Saves Christmas! runs 12-14..01-02), which is what the `start > end` branch handles.
 *
 * Hour is ignored: it only shifts the two boundary days, and treating both endpoints as inclusive
 * whole days keeps this comparison independent of the player's clock time.
 */
export function isSeasonOpen(quest: Quest, now: Date): boolean {
  if (quest.m_isTimeLimited !== 1) return true;
  const { m_startDate: start, m_endDate: end } = quest;
  if (!start || !end) return true;
  const monthDay = (month: number, day: number): number => month * 100 + day;
  const today = monthDay(now.getMonth() + 1, now.getDate());
  const from = monthDay(start.m_month, start.m_day);
  const to = monthDay(end.m_month, end.m_day);
  return from <= to ? today >= from && today <= to : today >= from || today <= to;
}

/**
 * Story steps the log offers: a chain quest that is visible, in season, not yet done, and whose
 * every dependency is done. Variant-aware - the game treats `_Diff_30`/`_Diff_40` cuts of a step
 * as the same step, so completion is compared on base names.
 *
 * The season check is what keeps the holiday lines out. Every seasonal line's opening step
 * declares no dependencies, so without it all nine (Halloween, Valentines, Christmas, ...) count
 * as unlocked on any day of the year and the log over-reports by nine quests.
 */
function unlockedStoryQuests(
  quests: readonly Quest[],
  completed: ReadonlySet<string>,
  now: Date,
): string[] {
  const completedBases = new Set([...completed].map(baseName));
  const out: string[] = [];
  for (const q of quests) {
    if (!CHAIN_QUEST_TYPES.has(q.m_questType)) continue;
    if (!q.questlineTitle) continue; // seasonal one-offs are pickers' business, not the chain's
    if (q.m_isVisible === 0) continue;
    if (!isSeasonOpen(q, now)) continue;
    if (completedBases.has(baseName(q.m_questName))) continue;
    const deps = q.m_questDependancies ?? [];
    if (deps.every((d) => completedBases.has(baseName(d)))) out.push(q.m_questName);
  }
  return out;
}

/**
 * Resolve the save's quest-log state. `quests` is the whole catalog (needed to work out which
 * story steps have unlocked). A save with no ledger yields empty sets, never throws.
 *
 * `now` decides which seasonal lines are in season and is injectable so tests can pin a date.
 */
export function questSaveContext(
  save: SaveData,
  quests: readonly Quest[],
  now: Date = new Date(),
): QuestSaveContext {
  const mgr = save.completedQuestDataManager;
  const completed = new Set(mgr?.completedQuests ?? []);
  const byName = new Map(quests.map((q) => [q.m_questName, q]));
  const completedKeys = new Set(
    [...completed].map((n) => {
      const quest = byName.get(n);
      return quest ? questVariantKeyOf(quest) : n;
    }),
  );

  const currentDailies = mgr?.dailyQuestPicker?.currentDailies ?? [];
  const currentWeeklies = mgr?.weeklyQuestPicker?.currentWeeklies ?? [];
  const hadRotation =
    (mgr?.dailyQuestPicker?.historyDailies?.length ?? 0) > 0 ||
    (mgr?.weeklyQuestPicker?.historyWeeklies?.length ?? 0) > 0;

  const inLog = new Set<string>(unlockedStoryQuests(quests, completed, now));
  const standalone = mgr?.standaloneQuestPicker?.currentStandalone;
  if (standalone) inLog.add(standalone);
  for (const r of [...currentDailies, ...currentWeeklies]) {
    if (r.questName) inLog.add(r.questName);
  }

  const skipped = new Set<string>();
  for (const s of [mgr?.standaloneQuestSkipper, mgr?.dailyQuestSkipper, mgr?.weeklyQuestSkipper]) {
    for (const row of s?.skippedQuests ?? []) if (row.questName) skipped.add(row.questName);
  }

  // Two independent "a team is out" signals: a wasteland team flagged onto a quest, and the
  // single questDataManager instance while it is still running (a finished run keeps its id).
  const deployed = new Set<string>();
  for (const team of save.vault?.wasteland?.teams ?? []) {
    if (team.isDoingQuest && team.questName) deployed.add(team.questName);
  }
  const qdm = save.questDataManager;
  const currentId = qdm?.questTeam?.CurrentQuestID;
  if (currentId && qdm?.questDone === false && qdm?.cancelled !== true) deployed.add(currentId);

  return {
    completed,
    completedKeys,
    inLog,
    skipped,
    deployed,
    rotationExpired: hadRotation && currentDailies.length === 0 && currentWeeklies.length === 0,
  };
}

// --- reward scanning --------------------------------------------------------------------

/** EQuestLootType -> coarse bucket. Concrete and Random* variants share a bucket. */
const REWARD_BUCKET: Record<number, RewardBucket> = {
  [EQuestLootType.Weapon]: 'weapon',
  [EQuestLootType.RandomCommonWeapon]: 'weapon',
  [EQuestLootType.RandomRareWeapon]: 'weapon',
  [EQuestLootType.RandomLegendaryWeapon]: 'weapon',
  [EQuestLootType.Outfit]: 'outfit',
  [EQuestLootType.RandomCommonOutfit]: 'outfit',
  [EQuestLootType.RandomRareOutfit]: 'outfit',
  [EQuestLootType.RandomLegendaryOutfit]: 'outfit',
  [EQuestLootType.Pet]: 'pet',
  [EQuestLootType.PetCarrier]: 'pet',
  [EQuestLootType.RandomCommonPet]: 'pet',
  [EQuestLootType.RandomRarePet]: 'pet',
  [EQuestLootType.RandomLegendaryPet]: 'pet',
  [EQuestLootType.Dweller]: 'dweller',
  [EQuestLootType.RandomRareDweller]: 'dweller',
  [EQuestLootType.Junk]: 'junk',
  [EQuestLootType.RandomCommonJunk]: 'junk',
  [EQuestLootType.RandomRareJunk]: 'junk',
  [EQuestLootType.RandomLegendaryJunk]: 'junk',
  [EQuestLootType.Recipe]: 'recipe',
  [EQuestLootType.RandomRareWeaponRecipe]: 'recipe',
  [EQuestLootType.RandomRareOutfitRecipe]: 'recipe',
  [EQuestLootType.RandomLegendaryWeaponRecipe]: 'recipe',
  [EQuestLootType.RandomLegendaryOutfitRecipe]: 'recipe',
  [EQuestLootType.RecipeParts]: 'recipeParts',
  [EQuestLootType.RandomRecipePart]: 'recipeParts',
  [EQuestLootType.Nuka]: 'caps',
  [EQuestLootType.Quantum]: 'quantum',
  [EQuestLootType.Stimpak]: 'consumable',
  [EQuestLootType.Radaway]: 'consumable',
  [EQuestLootType.Lunchbox]: 'lunchbox',
  [EQuestLootType.MrHandyBox]: 'lunchbox',
  [EQuestLootType.MrHandy]: 'mrHandy',
  [EQuestLootType.QuestClue]: 'clue',
  [EQuestLootType.RandomClue]: 'clue',
  [EQuestLootType.PokerChip]: 'pokerChip',
};

/** Every loot slot a quest declares across its mandatory rooms. */
function* lootSlots(quest: Quest): Generator<QuestLoot> {
  for (const room of quest.m_mandatoryRooms ?? []) {
    if (room.m_combatLoot) yield room.m_combatLoot;
    if (room.m_roomCompletionLoot) yield room.m_roomCompletionLoot;
    for (const slot of room.m_pickableLoot ?? []) yield slot;
    for (const slot of room.m_extraRoomCompletionLoot ?? []) yield slot;
  }
}

/**
 * The reward buckets a quest can pay out. Unlike planQuestLoot this needs no RNG and no GameData:
 * it reports what the catalog CAN drop, which is what a filter should match on.
 */
export function questRewardBuckets(quest: Quest): Set<RewardBucket> {
  const out = new Set<RewardBucket>();
  for (const slot of lootSlots(quest)) {
    const bucket = REWARD_BUCKET[slot.m_lootType];
    if (bucket) out.add(bucket);
  }
  return out;
}

// --- matching ---------------------------------------------------------------------------

const REPEATABLE_QUEST_TYPES = new Set([3, 4, 6]);

/**
 * Mirror of buildQuestMapLayout's region assignment, keyed off the chain node-id set.
 *
 * Exported for the detail panel: "which region is this quest in" is the Region facet's question,
 * and a second implementation of it could disagree with the map the user is looking at.
 */
export function regionOf(quest: Quest, chainIds: ReadonlySet<string>): QuestMapRegion {
  if (chainIds.has(quest.m_questName) || chainIds.has(baseName(quest.m_questName))) return 'chain';
  return REPEATABLE_QUEST_TYPES.has(quest.m_questType) ? 'repeatable' : 'standalone';
}

/**
 * The id of the map node a quest draws into - a mirror of buildQuestMapLayout's node identity
 * (chains collapse difficulty variants, the flat grids collapse by title).
 *
 * Facet counts are in NODE units because the map is. The catalog holds 95 "Game Show Gauntlet"
 * rows that draw as ONE card, so a quest-counting facet would offer "Daily (95)" and then draw a
 * single node - the count has to promise what the user will actually see.
 *
 * questNodeKey stays in sync with the layout by test, not by hope: questFilter.test.ts asserts
 * these keys reproduce buildQuestMapLayout's node ids exactly.
 */
export function questNodeKey(quest: Quest, chainIds: ReadonlySet<string>): string {
  const name = quest.m_questName;
  if (chainIds.has(name)) return name;
  const base = baseName(name);
  if (chainIds.has(base)) return base;
  return `${regionOf(quest, chainIds)}:${quest.title || name}`;
}

/**
 * Every status a quest answers to. Exactly one of completed/incomplete always applies.
 *
 * Exported for the detail panel, which badges the same statuses the Status facet filters on.
 */
export function questStatuses(quest: Quest, ctx: QuestSaveContext): QuestStatus[] {
  const name = quest.m_questName;
  const out: QuestStatus[] = [];
  if (ctx.inLog.has(name)) out.push('inLog');
  out.push(ctx.completedKeys.has(questVariantKeyOf(quest)) ? 'completed' : 'incomplete');
  if (ctx.skipped.has(name)) out.push('skipped');
  if (ctx.deployed.has(name)) out.push('deployed');
  return out;
}

/** Every flag a quest carries (Unity stores them as 0/1 ints). */
function questFlags(quest: Quest): QuestFlag[] {
  const out: QuestFlag[] = [];
  if (quest.m_isRepeatable === 1) out.push('repeatable');
  if (quest.m_isTimeLimited === 1) out.push('timeLimited');
  if (quest.m_isVisible === 0) out.push('hidden');
  return out;
}

function matchesStatus(quest: Quest, filter: QuestFilter, ctx: QuestSaveContext): boolean {
  if (filter.status.length === 0) return true;
  const has = questStatuses(quest, ctx);
  return filter.status.some((s) => has.includes(s));
}

/** Does one quest satisfy every constrained facet? */
export function questMatchesFilter(
  quest: Quest,
  filter: QuestFilter,
  ctx: QuestSaveContext,
  chainIds: ReadonlySet<string>,
): boolean {
  if (!questMatchesQuery(quest, filter.search)) return false;
  if (!matchesStatus(quest, filter, ctx)) return false;
  if (filter.types.length > 0 && !filter.types.includes(quest.m_questType)) return false;
  if (filter.schemes.length > 0 && !filter.schemes.includes(quest.m_questScheme ?? 0)) return false;
  if (
    filter.environments.length > 0 &&
    (quest.m_questEnvironment === undefined ||
      !filter.environments.includes(quest.m_questEnvironment))
  ) {
    return false;
  }
  if (filter.regions.length > 0 && !filter.regions.includes(regionOf(quest, chainIds))) {
    return false;
  }
  if (
    filter.questlines.length > 0 &&
    (!quest.questlineTitle || !filter.questlines.includes(quest.questlineTitle))
  ) {
    return false;
  }
  if (filter.flags.length > 0) {
    // OR, like every other facet: ticking two boxes in one Excel column widens the result, it
    // never narrows it. This used to AND, so "Repeatable + Hidden" quietly asked for quests that
    // were both at once while "Daily + Weekly" one facet over asked for either.
    const flags = questFlags(quest);
    if (!filter.flags.some((f) => flags.includes(f))) return false;
  }
  if (filter.difficulty) {
    // Overlap, not containment: a 7..42 quest belongs in a 30..60 window.
    const min = quest.m_questDifficultyMin ?? 0;
    const max = quest.m_questDifficultyMax ?? min;
    if (max < filter.difficulty.min || min > filter.difficulty.max) return false;
  }
  if (filter.rewards.length > 0) {
    const buckets = questRewardBuckets(quest);
    if (!filter.rewards.some((r) => buckets.has(r))) return false;
  }
  return true;
}

// --- facet options (Excel-style cascading lists) -----------------------------------------

/** Node ids of every quest that sits in a chain lane. Exported as regionOf's second argument. */
export function chainIdSet(questlines: readonly Questline[]): Set<string> {
  const ids = new Set<string>();
  for (const ql of questlines) for (const n of ql.nodes) ids.add(n.id);
  return ids;
}

/**
 * The list-backed facets. `difficulty` (a range) and `search` (free text) have no option list to
 * narrow, though both still constrain the lists of every OTHER facet.
 */
export type FacetKey = Exclude<keyof QuestFilter, 'difficulty' | 'search'>;

/**
 * Drop one facet's own constraint. Excel builds a column's dropdown from the rows passing every
 * OTHER column's filter, never that column's own - if ticking "Daily" narrowed the Type list to
 * just "Daily", there would be no way to widen the selection to "Daily or Weekly".
 */
const WITHOUT_FACET: Record<FacetKey, (f: QuestFilter) => QuestFilter> = {
  status: (f) => ({ ...f, status: [] }),
  types: (f) => ({ ...f, types: [] }),
  schemes: (f) => ({ ...f, schemes: [] }),
  environments: (f) => ({ ...f, environments: [] }),
  regions: (f) => ({ ...f, regions: [] }),
  questlines: (f) => ({ ...f, questlines: [] }),
  flags: (f) => ({ ...f, flags: [] }),
  rewards: (f) => ({ ...f, rewards: [] }),
};

/**
 * Per facet, the values still worth offering mapped to HOW MANY MAP NODES each would leave.
 *
 * A value's absence from the map means "ticking this returns nothing"; its number is the size of
 * the result you would get, so the list doubles as a preview of every branch.
 */
export interface QuestFacetOptions {
  status: ReadonlyMap<QuestStatus, number>;
  types: ReadonlyMap<number, number>;
  schemes: ReadonlyMap<number, number>;
  environments: ReadonlyMap<number, number>;
  regions: ReadonlyMap<QuestMapRegion, number>;
  questlines: ReadonlyMap<string, number>;
  flags: ReadonlyMap<QuestFlag, number>;
  rewards: ReadonlyMap<RewardBucket, number>;
}

/**
 * Narrow every facet's option list to values that still yield MATCHES, and count each one.
 *
 * The count is "tick ONLY this value and you get N nodes", measured against every OTHER facet's
 * constraint - the same rows the list itself is built from. It is deliberately not "add this to
 * what is already ticked": a facet's own selection is dropped before counting (see WITHOUT_FACET),
 * so every value in the column is measured on equal footing and the numbers stay comparable.
 *
 * Chain context deliberately does not count, in the list or in the number. A quest only drawn
 * because a neighbour matched is not a match, so counting it would inflate every number by the
 * chains they drag in, and offering its environment would promise results the filter cannot
 * deliver: ticking it would return nothing and the map would empty out.
 *
 * There is no "(Blanks)" entry because the catalog has no blanks to speak of - every quest
 * declares a type, scheme and environment. The one exception is questlineTitle, empty on 765 of
 * 1040 quests, but "no questline" is exactly "not in a chain", which the Region facet already
 * expresses as Standalone / Repeatable.
 */
export function questFacetOptions(
  questlines: readonly Questline[],
  quests: readonly Quest[],
  filter: QuestFilter,
  ctx: QuestSaveContext,
): QuestFacetOptions {
  const chainIds = chainIdSet(questlines);
  // Count DISTINCT node keys, not quests: several quests collapse into one card, and a node draws
  // as soon as any one of them matches.
  const collect = <T>(key: FacetKey, valuesOf: (q: Quest) => Iterable<T>): Map<T, number> => {
    const rest = WITHOUT_FACET[key](filter);
    const nodesByValue = new Map<T, Set<string>>();
    for (const q of quests) {
      if (!questMatchesFilter(q, rest, ctx, chainIds)) continue;
      const nodeKey = questNodeKey(q, chainIds);
      for (const v of valuesOf(q)) {
        let seen = nodesByValue.get(v);
        if (!seen) {
          seen = new Set<string>();
          nodesByValue.set(v, seen);
        }
        seen.add(nodeKey);
      }
    }
    const out = new Map<T, number>();
    for (const [value, seen] of nodesByValue) out.set(value, seen.size);
    return out;
  };

  return {
    status: collect('status', (q) => questStatuses(q, ctx)),
    types: collect('types', (q) => [q.m_questType]),
    schemes: collect('schemes', (q) => [q.m_questScheme ?? 0]),
    environments: collect('environments', (q) =>
      q.m_questEnvironment === undefined ? [] : [q.m_questEnvironment],
    ),
    regions: collect('regions', (q) => [regionOf(q, chainIds)]),
    questlines: collect('questlines', (q) => (q.questlineTitle ? [q.questlineTitle] : [])),
    flags: collect('flags', questFlags),
    rewards: collect('rewards', questRewardBuckets),
  };
}

// --- cluster expansion ------------------------------------------------------------------

/**
 * Undirected adjacency over chain node ids. Undirected is the whole point: walking only
 * `dependencies` would show prerequisites but not follow-ups, and walking only dependents would
 * do the reverse.
 */
function buildAdjacency(questlines: readonly Questline[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const ids = chainIdSet(questlines);

  const link = (a: string, b: string): void => {
    let set = adjacency.get(a);
    if (!set) {
      set = new Set<string>();
      adjacency.set(a, set);
    }
    set.add(b);
  };
  for (const ql of questlines) {
    for (const node of ql.nodes) {
      for (const dep of node.dependencies) {
        if (!ids.has(dep)) continue; // edge out of the graph (dep is a flat quest)
        link(node.id, dep);
        link(dep, node.id);
      }
    }
  }
  return adjacency;
}

/** Flood-fill every node reachable from `seeds` through undirected dependency edges. */
function expandClusters(
  seeds: Iterable<string>,
  adjacency: ReadonlyMap<string, Set<string>>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [...seeds];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adjacency.get(id) ?? []) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

export interface FilteredQuestCatalog {
  questlines: Questline[];
  quests: Quest[];
  /** Quests that matched the filter outright, BEFORE chain expansion pulled their cluster in. */
  matched: ReadonlySet<string>;
}

/**
 * Narrow the catalog to what the map should draw. Chain hits expand to their full cluster; flat
 * quests (standalone/repeatable) have no dependencies, so they filter one-by-one.
 *
 * The returned `quests` array deliberately EXCLUDES chain quests whose node was filtered out.
 * buildQuestMapLayout decides "is this quest chained?" from the questlines handed to it, so a
 * dropped chain quest left in `quests` would resurface as a bogus node in the Standalone grid.
 *
 * An inactive filter returns the inputs unchanged (same references) - no needless re-layout.
 */
export function filterQuestCatalog(
  questlines: readonly Questline[],
  quests: readonly Quest[],
  filter: QuestFilter,
  ctx: QuestSaveContext,
): FilteredQuestCatalog {
  const chainIds = chainIdSet(questlines);

  if (!isFilterActive(filter)) {
    return {
      questlines: questlines as Questline[],
      quests: quests as Quest[],
      matched: new Set(quests.map((q) => q.m_questName)),
    };
  }

  const matched = new Set<string>();
  for (const q of quests) {
    if (questMatchesFilter(q, filter, ctx, chainIds)) matched.add(q.m_questName);
  }

  const adjacency = buildAdjacency(questlines);
  const seeds: string[] = [];
  for (const ql of questlines) {
    for (const node of ql.nodes) {
      if (node.questNames.some((n) => matched.has(n))) seeds.push(node.id);
    }
  }
  const keptNodeIds = expandClusters(seeds, adjacency);

  const keptQuestlines = questlines
    .map((ql) => ({ ...ql, nodes: ql.nodes.filter((n) => keptNodeIds.has(n.id)) }))
    .filter((ql) => ql.nodes.length > 0);

  const keptChainNames = new Set<string>();
  for (const ql of keptQuestlines) {
    for (const node of ql.nodes) for (const n of node.questNames) keptChainNames.add(n);
  }

  const keptQuests = quests.filter((q) => {
    const isChained = chainIds.has(q.m_questName) || chainIds.has(baseName(q.m_questName));
    return isChained ? keptChainNames.has(q.m_questName) : matched.has(q.m_questName);
  });

  return { questlines: keptQuestlines, quests: keptQuests, matched };
}
