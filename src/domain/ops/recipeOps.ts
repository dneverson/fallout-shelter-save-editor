import type { SaveData } from '../model/saveSchema.ts';
import { setRoomTheme } from './roomOps.ts';
import { NO_THEME, themeRecipeInfo } from '../rooms/themes.ts';

// Pure, immutable RECIPE collection ops, the same
// `(save, …args) => SaveData` structural-sharing contract as the other ops modules: a
// no-op returns the SAME save reference so the store never grows an empty undo step.
//
// A recipe has up to three states, mirroring the in-game lifecycle (get → build → apply):
//   • KNOWN   - id present in `survivalW.recipes` (weapon/outfit recipes stop here).
//   • BUILT   - theme recipes only: a fully-crafted entry in
//               `survivalW.collectedThemes.themeList` (partsCollectedCount 9 + IsCrafted).
//   • APPLIED - theme recipes only: the theme set for its room type in
//               `specialTheme.themeByRoomType` (reuses roomOps.setRoomTheme).
// Removing a known theme recipe CASCADES - it also un-applies and un-builds it so the
// three structures never disagree.

/** parts a theme needs to count as fully crafted/built (the game's per-theme part count). */
export const BUILT_PARTS = 9;

/** A themeList entry the way the game writes a fully-crafted, claimed theme. */
function makeThemeEntry(id: string) {
  return {
    id,
    type: 'Theme',
    hasBeenAssigned: false,
    hasRandonWeaponBeenAssigned: false,
    extraData: {
      partsCollectedCount: BUILT_PARTS,
      IsCraftingInProgress: false,
      IsCrafted: true,
      IsClaimed: true,
      IsClaimedInCraftingRoom: true,
      IsNew: false,
    },
  };
}

type ThemeList = NonNullable<NonNullable<SaveData['survivalW']>['collectedThemes']>['themeList'];

/** Replace `survivalW.collectedThemes.themeList`, preserving sibling subtrees by reference. */
function withThemeList(save: SaveData, themeList: ThemeList): SaveData {
  const survivalW = save.survivalW ?? {};
  const collectedThemes = survivalW.collectedThemes ?? {};
  return {
    ...save,
    survivalW: { ...survivalW, collectedThemes: { ...collectedThemes, themeList } },
  };
}

/** Is `id` a known recipe (present in `survivalW.recipes`)? */
export function recipeKnown(save: SaveData, id: string): boolean {
  return (save.survivalW?.recipes ?? []).includes(id);
}

/** Is the theme recipe `recipeId` fully built (a crafted entry in the themeList)? */
export function isThemeBuilt(save: SaveData, recipeId: string): boolean {
  const entry = (save.survivalW?.collectedThemes?.themeList ?? []).find((t) => t.id === recipeId);
  return !!entry && (entry.extraData?.partsCollectedCount ?? 0) >= BUILT_PARTS;
}

/** Is the theme recipe `recipeId` currently applied to its room type? */
export function isThemeApplied(save: SaveData, recipeId: string): boolean {
  const info = themeRecipeInfo(recipeId);
  if (!info) return false;
  return (save.specialTheme?.themeByRoomType ?? {})[info.roomType] === info.theme;
}

/** Add `ids` to the known recipe collection (union; existing ids untouched). */
export function addRecipes(save: SaveData, ids: readonly string[]): SaveData {
  const recipes = save.survivalW?.recipes ?? [];
  const have = new Set(recipes);
  const toAdd = ids.filter((id) => !have.has(id));
  if (toAdd.length === 0) return save;
  return { ...save, survivalW: { ...(save.survivalW ?? {}), recipes: [...recipes, ...toAdd] } };
}

/**
 * Add `parts` theme-recipe parts toward `recipeId`, the partial-progress step the quest engine
 * awards (EQuestLootType.RecipeParts / RandomRecipePart).
 *
 * Parts accumulate on the themeList entry and CAP at BUILT_PARTS; reaching the cap crafts the
 * theme, which is what the game's own crafting flow does when the last part lands. Below the cap
 * the entry stays un-crafted, so a half-collected theme survives a round-trip as half-collected.
 * An already-built theme is a no-op (same ref) - there is no progress left to add.
 *
 * Unlike buildTheme this does NOT mark the recipe known: parts are collected toward a theme the
 * vault may not have the recipe for yet, exactly as in game.
 */
export function addRecipeParts(save: SaveData, recipeId: string, parts: number): SaveData {
  if (!themeRecipeInfo(recipeId) || parts <= 0) return save;
  const list = save.survivalW?.collectedThemes?.themeList ?? [];
  const idx = list.findIndex((t) => t.id === recipeId);
  const current = idx >= 0 ? (list[idx].extraData?.partsCollectedCount ?? 0) : 0;
  if (current >= BUILT_PARTS) return save;

  const collected = Math.min(current + parts, BUILT_PARTS);
  const crafted = collected >= BUILT_PARTS;
  const base = idx >= 0 ? list[idx] : makeThemeEntry(recipeId);
  const entry = {
    ...base,
    extraData: {
      ...(base.extraData ?? {}),
      partsCollectedCount: collected,
      IsCraftingInProgress: false,
      IsCrafted: crafted,
      IsClaimed: crafted,
      IsClaimedInCraftingRoom: crafted,
      IsNew: true,
    },
  };
  const next = idx >= 0 ? [...list] : [...list, entry];
  if (idx >= 0) next[idx] = entry;
  return withThemeList(save, next);
}

/**
 * Build the theme recipe `recipeId`: ensure it is KNOWN, then ensure a fully-crafted
 * themeList entry exists. No-op (same ref) for a non-theme id or an already-built theme.
 */
export function buildTheme(save: SaveData, recipeId: string): SaveData {
  if (!themeRecipeInfo(recipeId)) return save;
  const known = addRecipes(save, [recipeId]);
  const list = known.survivalW?.collectedThemes?.themeList ?? [];
  const idx = list.findIndex((t) => t.id === recipeId);
  if (idx >= 0) {
    const entry = list[idx];
    const built =
      (entry.extraData?.partsCollectedCount ?? 0) >= BUILT_PARTS && !!entry.extraData?.IsCrafted;
    if (built) return known; // already crafted (known may have just been added → return known)
    const next = [...list];
    next[idx] = { ...entry, ...makeThemeEntry(recipeId) };
    return withThemeList(known, next);
  }
  return withThemeList(known, [...list, makeThemeEntry(recipeId)]);
}

/** Remove the themeList entry for `recipeId` (un-build). No-op when not present. */
export function unbuildTheme(save: SaveData, recipeId: string): SaveData {
  const list = save.survivalW?.collectedThemes?.themeList;
  if (!Array.isArray(list) || !list.some((t) => t.id === recipeId)) return save;
  return withThemeList(
    save,
    list.filter((t) => t.id !== recipeId),
  );
}

/**
 * Apply the theme recipe `recipeId` to its room type: ensures it is KNOWN + BUILT, then
 * sets `themeByRoomType` (via roomOps.setRoomTheme). A room type shows ONE theme at a time,
 * so this overwrites any other applied theme for that type, mirroring the in-game picker.
 * No-op for a non-theme id or when everything is already in place.
 */
export function applyThemeRecipe(save: SaveData, recipeId: string): SaveData {
  const info = themeRecipeInfo(recipeId);
  if (!info) return save;
  const built = buildTheme(save, recipeId);
  return setRoomTheme(built, info.roomType, info.theme);
}

/** Clear the applied theme for `recipeId`'s room type (back to None). No-op when not applied. */
export function unapplyThemeRecipe(save: SaveData, recipeId: string): SaveData {
  const info = themeRecipeInfo(recipeId);
  if (!info) return save;
  if ((save.specialTheme?.themeByRoomType ?? {})[info.roomType] !== info.theme) return save;
  return setRoomTheme(save, info.roomType, NO_THEME);
}

/**
 * Remove `ids` from the known recipe collection. For theme recipes this CASCADES: any
 * applied theme is cleared and any built themeList entry dropped first, so the recipe /
 * built / applied structures never disagree. No-op (same ref) when nothing changes.
 */
export function removeRecipes(save: SaveData, ids: readonly string[]): SaveData {
  let next = save;
  for (const id of ids) {
    if (themeRecipeInfo(id)) {
      next = unapplyThemeRecipe(next, id);
      next = unbuildTheme(next, id);
    }
  }
  const idSet = new Set(ids);
  const recipes = next.survivalW?.recipes;
  if (Array.isArray(recipes) && recipes.some((r) => idSet.has(r))) {
    next = {
      ...next,
      survivalW: { ...next.survivalW, recipes: recipes.filter((r) => !idSet.has(r)) },
    };
  }
  return next;
}
