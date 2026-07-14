import type { SaveData } from '../model/saveSchema.ts';

// Pure, immutable SURVIVAL GUIDE collection ops, the same
// `(save, …args) => SaveData` structural-sharing contract as the other ops modules: a
// no-op returns the SAME save reference so the store never grows an empty undo step.
//
// The game (SurvivalWindow.Serialize/Deserialize, Assembly-CSharp) stores each guide
// collection as a flat string list under `survivalW`; every entry is a one-letter state
// prefix + a code:
//   • "N" + code - collected and NEW (the in-game tab shows the NEW badge until tapped).
//   • "O" + code - collected and seen.
// The code is the item's CodeId for weapons/outfits/pets (numeric strings, e.g. "24"),
// the item id for junk ("AlarmClock"), the legendary character's asset name for dwellers
// (already "L_"-prefixed → entries like "NL_NickValentine"), and the EPetBreed int for
// breeds ("N7"). Codes live in game data (weapons/outfits/junk `codeId`, pets `codeId`,
// unique-dwellers keys, enums.EPetBreed) - see domain/items/collectionCatalog.ts.

/** The `survivalW` collection lists this editor manages (save keys, game tab order). */
export const COLLECTION_KEYS = [
  'weapons',
  'outfits',
  'dwellers',
  'pets',
  'breeds',
  'junk',
] as const;
export type CollectionKey = (typeof COLLECTION_KEYS)[number];

/** Per-code guide state: absent, collected-and-new, or collected-and-seen. */
export type CollectionStatus = 'missing' | 'new' | 'seen';

const entryCode = (entry: string): string => entry.slice(1);
const entryIsNew = (entry: string): boolean => entry.startsWith('N');

function getList(save: SaveData, key: CollectionKey): readonly string[] {
  return save.survivalW?.[key] ?? [];
}

/** Replace one collection list, preserving sibling `survivalW` subtrees by reference. */
function withList(save: SaveData, key: CollectionKey, entries: string[]): SaveData {
  return { ...save, survivalW: { ...(save.survivalW ?? {}), [key]: entries } };
}

/** code → is-new for one collection list (single pass; feeds per-row status in the view). */
export function collectionCodes(save: SaveData, key: CollectionKey): ReadonlyMap<string, boolean> {
  const map = new Map<string, boolean>();
  for (const entry of getList(save, key)) {
    if (entry.length > 1) map.set(entryCode(entry), entryIsNew(entry));
  }
  return map;
}

/** Guide state of `code` in the `key` collection. */
export function collectionStatus(
  save: SaveData,
  key: CollectionKey,
  code: string,
): CollectionStatus {
  const isNew = collectionCodes(save, key).get(code);
  return isNew === undefined ? 'missing' : isNew ? 'new' : 'seen';
}

/**
 * Add `codes` to the `key` collection (union; codes already present - under either
 * prefix - are untouched). `asNew: true` writes "N" entries so the game shows the NEW
 * badge (the reddit-documented "NL_…" trick); false writes pre-seen "O" entries.
 */
export function addCollectionEntries(
  save: SaveData,
  key: CollectionKey,
  codes: readonly string[],
  asNew = true,
): SaveData {
  const have = collectionCodes(save, key);
  const toAdd = codes.filter((code) => code.length > 0 && !have.has(code));
  if (toAdd.length === 0) return save;
  const prefix = asNew ? 'N' : 'O';
  return withList(save, key, [...getList(save, key), ...toAdd.map((code) => prefix + code)]);
}

/** Remove `codes` (either prefix) from the `key` collection. No-op when none present. */
export function removeCollectionEntries(
  save: SaveData,
  key: CollectionKey,
  codes: readonly string[],
): SaveData {
  const drop = new Set(codes);
  const list = getList(save, key);
  const next = list.filter((entry) => !drop.has(entryCode(entry)));
  if (next.length === list.length) return save;
  return withList(save, key, next);
}

/**
 * Rewrite the state prefix of `codes` already in the `key` collection ("N" ↔ "O");
 * codes not collected are ignored (this never adds entries). No-op when nothing flips.
 */
export function setCollectionEntriesNew(
  save: SaveData,
  key: CollectionKey,
  codes: readonly string[],
  isNew: boolean,
): SaveData {
  const wanted = new Set(codes);
  const prefix = isNew ? 'N' : 'O';
  let changed = false;
  const next = getList(save, key).map((entry) => {
    if (!wanted.has(entryCode(entry)) || entry.startsWith(prefix)) return entry;
    changed = true;
    return prefix + entryCode(entry);
  });
  return changed ? withList(save, key, next) : save;
}
