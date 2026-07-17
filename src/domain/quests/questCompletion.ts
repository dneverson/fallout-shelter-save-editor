import type { GameData } from '../gamedata/gameData.ts';
import type { Quest } from '../gamedata/schemas.ts';
import type { SaveData } from '../model/saveSchema.ts';
import {
  buildLootPools,
  planQuestLoot,
  grantResolvedLoot,
  mulberry32,
  type GrantLine,
} from './questLoot.ts';

// Quest completion ledger ops (Sections 5.6 + 5.7). The editor's completion target is
// `completedQuestDataManager.completedQuests` - a plain list of quest-name strings. Every op is
// pure `(save, ...) => SaveData` with structural sharing, so one completion = one undo step.
//
// Two locked rules from the design:
//   * Complete is DOWNWARD-CLOSED (5.6): completing quest Q also completes every unmet prereq in
//     its `m_questDependancies` chain, so the game's IsQuestUnlocked (needs ALL deps complete)
//     stays correct - no orphan "did step 3 but not 1/2" state. Each newly-completed quest also
//     grants its catalog loot (5.4.5), reusing the loot engine.
//   * Incomplete is TIP-ONLY (5.7): a quest may be un-completed only when no OTHER completed quest
//     depends on it. Peeling the graph from its leaves keeps the set downward-closed. Un-complete
//     never claws back granted loot (items may have been spent).
//
// Every ledger comparison here runs on VARIANT KEYS, not raw names. The TV Show questlines ship
// each step as parallel difficulty cuts (`ShowQuestline_Ryan_01_Diff10/20/30/40`), the game picks
// one by vault QAL, and its dependency/unlock checks treat any cut as the step
// (IsQuestCompleted(..., includeQuestlineQuestVariants: true)). Matching raw names instead would
// re-complete - and re-grant the loot of - a step whose other cut is already in the ledger.

/** ReadonlyMap<m_questName, Quest> - the QuestCatalog.questByName index. */
export type QuestIndex = ReadonlyMap<string, Quest>;

/** EQuestType.QuestlineQuest - the only type whose `_Diff` cuts are interchangeable variants. */
const QUESTLINE_QUEST_TYPE = 0;

/**
 * The game's variant identity for a quest name (GetQuestlineQuestVariants): a QuestlineQuest with
 * a `_Diff` suffix shares one key with its other difficulty cuts - the name up to and INCLUDING
 * `_Diff` ("ShowQuestline_Ryan_01_Diff10" -> "ShowQuestline_Ryan_01_Diff"). Everything else keys
 * as its exact name: dailies/weeklies/surprises use `_Diff` names too, but the game never treats
 * THOSE as equivalent, so neither does this.
 */
export function questVariantKeyOf(quest: Pick<Quest, 'm_questName' | 'm_questType'>): string {
  const name = quest.m_questName;
  if (quest.m_questType !== QUESTLINE_QUEST_TYPE) return name;
  const at = name.lastIndexOf('_Diff');
  return at < 0 ? name : name.slice(0, at + '_Diff'.length);
}

/** {@link questVariantKeyOf} by name; a name with no catalog record keys as itself. */
export function questVariantKey(name: string, questByName: QuestIndex): string {
  const quest = questByName.get(name);
  return quest ? questVariantKeyOf(quest) : name;
}

/** The variant keys of every ledger entry - what completion checks compare against. */
function completedKeySet(save: SaveData, questByName: QuestIndex): Set<string> {
  const out = new Set<string>();
  for (const n of save.completedQuestDataManager?.completedQuests ?? []) {
    out.add(questVariantKey(n, questByName));
  }
  return out;
}

/** The completion ledger's `completedQuests` as a Set (empty if absent). Raw names, no variants. */
export function completedQuestSet(save: SaveData): Set<string> {
  return new Set(save.completedQuestDataManager?.completedQuests ?? []);
}

/** Is `questName` - or, for a QuestlineQuest, any of its difficulty variants - in the ledger? */
export function isQuestComplete(
  save: SaveData,
  questName: string,
  questByName: QuestIndex,
): boolean {
  return completedKeySet(save, questByName).has(questVariantKey(questName, questByName));
}

/**
 * The downward-closed set of quest names a `completeQuest(questName)` will newly add: the quest
 * itself plus every transitive `m_questDependancies` prereq not already completed, prereqs-first
 * (post-order), deduped by variant key (a step whose OTHER difficulty cut is done, or already in
 * this closure, is skipped). Names absent from `questByName` (no catalog record) still count as
 * their own leaf so the target is always included. A `visited` guard makes a malformed cyclic
 * graph safe.
 */
export function questCompletionClosure(
  save: SaveData,
  questName: string,
  questByName: QuestIndex,
): string[] {
  const done = completedKeySet(save, questByName);
  const result: string[] = [];
  const added = new Set<string>();
  const visiting = new Set<string>();

  const walk = (name: string): void => {
    const key = questVariantKey(name, questByName);
    if (added.has(key) || done.has(key) || visiting.has(key)) return;
    visiting.add(key);
    for (const dep of questByName.get(name)?.m_questDependancies ?? []) walk(dep);
    visiting.delete(key);
    added.add(key);
    result.push(name);
  };

  walk(questName);
  return result;
}

/**
 * Is `questName` a TIP - completed, with no OTHER completed quest depending on it (or on any of
 * its difficulty variants)? Only tips may be un-completed (5.7). A not-completed quest is not a
 * tip. Variants of the step itself never count as dependents.
 */
export function isQuestTip(save: SaveData, questName: string, questByName: QuestIndex): boolean {
  if (!isQuestComplete(save, questName, questByName)) return false;
  const key = questVariantKey(questName, questByName);
  for (const other of save.completedQuestDataManager?.completedQuests ?? []) {
    if (questVariantKey(other, questByName) === key) continue;
    const deps = questByName.get(other)?.m_questDependancies ?? [];
    if (deps.some((d) => questVariantKey(d, questByName) === key)) return false;
  }
  return true;
}

/** Completed quests that depend on `questName` or a variant of it (what blocks un-completing it). */
export function completedDependents(
  save: SaveData,
  questName: string,
  questByName: QuestIndex,
): string[] {
  const key = questVariantKey(questName, questByName);
  return (save.completedQuestDataManager?.completedQuests ?? []).filter((n) => {
    if (questVariantKey(n, questByName) === key) return false;
    const deps = questByName.get(n)?.m_questDependancies ?? [];
    return deps.some((d) => questVariantKey(d, questByName) === key);
  });
}

/** EQuestType.QuestClue - the quest type whose NAMES are the clue ids the loot engine draws. */
const CLUE_QUEST_TYPE = 2;

/**
 * Every clue quest-name in the catalog: the source QuestDataManager rebuilds AvailableClue from
 * on load ("all QuestClue quests not in foundClues"). Clues are quests, not items - a clue reward
 * awards the NAME of a Clue-type quest.
 */
function clueQuestNames(questByName: QuestIndex): string[] {
  const out: string[] = [];
  for (const [name, quest] of questByName) {
    if (quest.m_questType === CLUE_QUEST_TYPE) out.push(name);
  }
  return out;
}

/** EQuestType.EventQuest - the holiday/event lines with real (year >= 2000) date windows. */
const EVENT_QUEST_TYPE = 5;

/** .NET ticks (100 ns units) between 0001-01-01 and the Unix epoch. */
const TICKS_AT_UNIX_EPOCH = 62_135_596_800_000 * 10_000;

/**
 * The completion stamp written for dated event quests: 3000-01-01 as .NET ticks.
 *
 * The game's ReactivateEventQuestIfExpired un-completes a dated EventQuest whenever
 * `DateTime.Now - eventQuestCompletedTimes[name]` exceeds the ~180-day cooldown - or IMMEDIATELY
 * when the entry is missing, which is why the editor cannot just append to `completedQuests` and
 * skip the stamp: every event completion it wrote would silently vanish on the next quest-list
 * open, in season or out.
 *
 * The stamp is FORWARD-dated, not `now`, on purpose. A real play-through stamps `now` and the
 * game deliberately clears it 180 days later so next year's event can be replayed - by design no
 * event completion survives a year in-game. The editor's mandate is the opposite (keep the ledger
 * at 100%), and a far-future stamp keeps the difference negative for ~a millennium, so the
 * completion sticks until the user un-completes it here. Safe: CompletedQuestDataManager is the
 * dict's only reader, and the value fits both a C# long and a JS double (~9.5e17).
 */
export const PERMANENT_EVENT_STAMP_TICKS = TICKS_AT_UNIX_EPOCH + Date.UTC(3000, 0, 1) * 10_000;

/**
 * Does the game's event-quest reactivation apply to this quest? Only dated EventQuests: the
 * sentinel-dated (year < 2000) ones are exempt in ReactivateEventQuestIfExpired itself.
 */
export function isReactivatingEventQuest(quest: Quest): boolean {
  return quest.m_questType === EVENT_QUEST_TYPE && (quest.m_startDate?.m_year ?? 0) >= 2000;
}

/** A small deterministic string hash -> seed for the loot roll (reproducible + testable rolls). */
function seedFrom(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface CompleteQuestResult {
  /** The save with the closure marked complete + all loot granted (one structurally-shared edit). */
  save: SaveData;
  /** Quest names newly added to the ledger (target + auto-completed prereqs), prereqs-first. */
  completedNames: string[];
  /** The concrete, rolled reward lines granted across every newly-completed quest. */
  granted: GrantLine[];
}

export interface CompleteQuestOptions {
  /** Legal-max resource caps (resource key -> max) so resource grants never exceed them. */
  caps?: Record<string, number>;
  /** Override the loot-roll RNG (tests). Defaults to a per-quest-name seeded PRNG. */
  rng?: () => number;
}

/**
 * Mark `questName` complete: add its downward-closed prereq closure to `completedQuests` (5.6) and
 * grant each newly-completed quest's catalog loot (5.4.5), all in ONE edit so a single undo reverts
 * both the ledger and the loot. Idempotent - a quest already complete (with no unmet prereqs)
 * returns the SAME save reference and no granted lines. The rolled `granted` lines are returned so
 * the UI can show exactly what was awarded; they are baked into `save`, never re-rolled.
 */
export function completeQuest(
  save: SaveData,
  questName: string,
  gameData: GameData,
  questByName: QuestIndex,
  options: CompleteQuestOptions = {},
): CompleteQuestResult {
  const completedNames = questCompletionClosure(save, questName, questByName);
  if (completedNames.length === 0) return { save, completedNames: [], granted: [] };

  const rng = options.rng ?? mulberry32(seedFrom(completedNames.join('|')));

  // ONE pools object for the whole closure. Recipes and clues are drawn without replacement, so
  // sharing the pools is what stops a 10-quest closure handing out the same rare recipe twice -
  // and what makes an exhausted pool stay exhausted for the rest of the grant.
  const pools = buildLootPools(save, gameData, clueQuestNames(questByName));

  const granted: GrantLine[] = [];
  for (const name of completedNames) {
    const quest = questByName.get(name);
    if (quest) granted.push(...planQuestLoot(quest, gameData, rng, pools));
  }

  const mgr = save.completedQuestDataManager ?? {};
  const existing = mgr.completedQuests ?? [];
  const nextMgr = { ...mgr, completedQuests: [...existing, ...completedNames] };

  // Pin dated event quests so the game keeps them (see PERMANENT_EVENT_STAMP_TICKS).
  const eventNames = completedNames.filter((n) => {
    const quest = questByName.get(n);
    return quest !== undefined && isReactivatingEventQuest(quest);
  });
  if (eventNames.length > 0) {
    const times = { ...(mgr.eventQuestCompletedTimes ?? {}) };
    for (const n of eventNames) times[n] = PERMANENT_EVENT_STAMP_TICKS;
    nextMgr.eventQuestCompletedTimes = times;
  }

  const withLedger: SaveData = { ...save, completedQuestDataManager: nextMgr };
  const withLoot = grantResolvedLoot(withLedger, granted, options.caps);
  return { save: withLoot, completedNames, granted };
}

/**
 * Un-complete `questName`: remove it - and, for a QuestlineQuest, every difficulty variant of the
 * same step - from the ledger, along with any event-quest completion stamps the editor wrote for
 * the removed names. The CALLER must ensure it is a tip ({@link isQuestTip}); granted loot is
 * intentionally NOT clawed back (5.7). No-op (same save) when the step is not in the ledger.
 */
export function uncompleteQuest(
  save: SaveData,
  questName: string,
  questByName: QuestIndex,
): SaveData {
  const mgr = save.completedQuestDataManager;
  const existing = mgr?.completedQuests;
  if (!existing) return save;
  const key = questVariantKey(questName, questByName);
  const removed = new Set(existing.filter((n) => questVariantKey(n, questByName) === key));
  if (removed.size === 0) return save;

  const nextMgr = { ...mgr, completedQuests: existing.filter((n) => !removed.has(n)) };
  const times = mgr.eventQuestCompletedTimes;
  if (times && [...removed].some((n) => n in times)) {
    nextMgr.eventQuestCompletedTimes = Object.fromEntries(
      Object.entries(times).filter(([n]) => !removed.has(n)),
    );
  }
  return { ...save, completedQuestDataManager: nextMgr };
}
