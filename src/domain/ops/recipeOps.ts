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
const BUILT_PARTS = 9;

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
