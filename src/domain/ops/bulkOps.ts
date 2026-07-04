import type { Dweller, SaveData } from '../model/saveSchema.ts';
import {
  autoPickPartner,
  hasDweller,
  maxOutHealth,
  setHappiness,
  setHealth,
  setLevel,
  setPregnancy,
  setRadiation,
  setRarity,
  setStat,
} from './dwellerOps.ts';

// Pure, immutable dweller BULK operations.
// Each op takes a list of `serializeId`s (the table's selected / select-all rows)
// and folds the corresponding single-dweller op from dwellerOps over them. Because
// those ops use structural sharing, a whole batch is still one new save spine plus
// references - so the store records it as ONE undo snapshot via a single applyEdit.
//
// Ids that no longer resolve are skipped (never throw); game-legal ranges are
// clamped by the underlying ops. Gender-gated ops (pregnancy) silently skip
// non-female dwellers, matching "make all females pregnant".

/** S P E C I A L stat indices (`stats.stats[1..7]`). */
const SPECIAL_INDICES = [1, 2, 3, 4, 5, 6, 7] as const;

function dwellerList(save: SaveData): Dweller[] {
  const list = save.dwellers?.dwellers;
  return Array.isArray(list) ? list : [];
}

function findDweller(save: SaveData, serializeId: number): Dweller | undefined {
  return dwellerList(save).find((d) => d.serializeId === serializeId);
}

/** Fold a single-dweller op over `ids`, skipping ids that are absent. */
function fold(
  save: SaveData,
  ids: readonly number[],
  op: (save: SaveData, serializeId: number) => SaveData,
): SaveData {
  return ids.reduce((acc, id) => (hasDweller(acc, id) ? op(acc, id) : acc), save);
}

/** Set every SPECIAL stat to 10 for each dweller. */
export const maxSpecialAll = (save: SaveData, ids: readonly number[]): SaveData =>
  fold(save, ids, (s, id) => SPECIAL_INDICES.reduce((acc, idx) => setStat(acc, id, idx, 10), s));

/** Set happiness to 100 for each dweller. */
export const maxHappinessAll = (save: SaveData, ids: readonly number[]): SaveData =>
  fold(save, ids, (s, id) => setHappiness(s, id, 100));

/**
 * Restore each dweller to full health AND cure radiation (revives the dead too:
 * healthValue=maxHealth, radiationValue=0). Skips
 * dwellers with no known maxHealth.
 */
export const healAll = (save: SaveData, ids: readonly number[]): SaveData =>
  fold(save, ids, (s, id) => {
    const max = findDweller(s, id)?.health?.maxHealth;
    return typeof max === 'number' ? setRadiation(setHealth(s, id, max), id, 0) : s;
  });

/**
 * Restore each dweller to full health WITHOUT touching radiation (the heal-only
 * counterpart to the combined {@link healAll}). Skips dwellers with no known maxHealth.
 */
export const setMaxHealthAll = (save: SaveData, ids: readonly number[]): SaveData =>
  fold(save, ids, (s, id) => {
    const max = findDweller(s, id)?.health?.maxHealth;
    return typeof max === 'number' ? setHealth(s, id, max) : s;
  });

/** Set radiation to 0 for each dweller. */
export const setRadiationAll = (save: SaveData, ids: readonly number[]): SaveData =>
  fold(save, ids, (s, id) => setRadiation(s, id, 0));

/** Revive ONLY the dead (healthValue <= 0) to full health; leaves the living untouched. */
export const reviveAll = (save: SaveData, ids: readonly number[]): SaveData =>
  fold(save, ids, (s, id) => {
    const health = findDweller(s, id)?.health;
    const hp = health?.healthValue;
    const max = health?.maxHealth;
    if (typeof hp === 'number' && hp <= 0 && typeof max === 'number') return setHealth(s, id, max);
    return s;
  });

/** Resolve a dweller's equipped-outfit Endurance bonus (game data lives in the UI layer). */
export type EnduranceBonusFor = (dweller: Dweller) => number;

/**
 * Set the level (clamped 1..50, XP reset) for each dweller, rescaling HP via `setLevel`.
 * `enduranceBonusFor` resolves each dweller's outfit Endurance bonus so HP scales from the
 * true total Endurance (keeps bulkOps game-data-free - the caller passes the resolver);
 * omitting it scales from base Endurance alone.
 */
export const setLevelAll = (
  save: SaveData,
  ids: readonly number[],
  level: number,
  enduranceBonusFor?: EnduranceBonusFor,
): SaveData =>
  fold(save, ids, (s, id) => {
    const d = findDweller(s, id);
    const bonus = enduranceBonusFor && d ? (enduranceBonusFor(d) ?? 0) : 0;
    return setLevel(s, id, level, undefined, bonus);
  });

/** Push each dweller to the 644 in-game max HP (maxHealth + current health). */
export const maxHpAll = (save: SaveData, ids: readonly number[]): SaveData =>
  fold(save, ids, (s, id) => maxOutHealth(s, id));

/** Set rarity to Legendary for each dweller. */
export const makeLegendaryAll = (save: SaveData, ids: readonly number[]): SaveData =>
  fold(save, ids, (s, id) => setRarity(s, id, 'Legendary'));

/**
 * Set the `pregnant` flag for each FEMALE dweller (gender 1); skips males. Forcing a
 * pregnancy also auto-picks a partner when none is recorded (random compatible dweller,
 * non-relatives preferred) so the baby has a second parent.
 */
export const setPregnantAll = (
  save: SaveData,
  ids: readonly number[],
  pregnant: boolean,
): SaveData =>
  fold(save, ids, (s, id) => {
    if (findDweller(s, id)?.gender !== 1) return s;
    const next = setPregnancy(s, id, { pregnant });
    return pregnant ? autoPickPartner(next, id) : next;
  });

/**
 * Set the `babyReady` flag for each eligible FEMALE dweller (gender 1). Baby-ready only
 * makes sense for an already-pregnant dweller, so this skips males, the non-pregnant, and
 * anyone whose flag already matches - leaving the affected count equal to "pregnant females
 * who weren't already baby-ready".
 */
export const setBabyReadyAll = (
  save: SaveData,
  ids: readonly number[],
  babyReady: boolean,
): SaveData =>
  fold(save, ids, (s, id) => {
    const d = findDweller(s, id);
    if (d?.gender !== 1 || d.pregnant !== true || (d.babyReady ?? false) === babyReady) return s;
    return setPregnancy(s, id, { babyReady });
  });

/**
 * How many of `ids` a bulk op actually changed. Because the ops use structural sharing, a
 * dweller left untouched keeps its exact object reference, so a reference inequality means
 * that dweller was modified - letting a toast report what was affected, not the scope size.
 */
export function countAffectedDwellers(
  before: SaveData,
  after: SaveData,
  ids: readonly number[],
): number {
  let affected = 0;
  for (const id of ids) {
    const b = findDweller(before, id);
    const a = findDweller(after, id);
    if (b && a && b !== a) affected += 1;
  }
  return affected;
}
