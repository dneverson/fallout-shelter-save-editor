import { themeLabel, themeRecipeInfo } from '../rooms/themes.ts';

// Browsable RECIPE catalog, mirroring the standalone
// weapon/outfit catalogs. The game stores known recipes as a flat id list in
// `survivalW.recipes`; this projects the static catalog (gameData.unlockables.recipes)
// into display rows by joining each id to the weapon/outfit catalogs (for a real name +
// icon) or to the theme reverse-map (theme recipes, e.g. "CafeteriaInstitute"). Per-save
// known/built/applied STATE is layered on by the view - this stays pure reference data.

export type RecipeKind = 'Weapon' | 'Outfit' | 'Theme';

export interface RecipeRow {
  /** Recipe id == the entry written to `survivalW.recipes`. */
  id: string;
  /** Display name (joined weapon/outfit name, or "<Room>: <Theme>" for themes). */
  name: string;
  kind: RecipeKind;
  /** Theme recipes only: the ERoomType the theme applies to. */
  roomType?: string;
  /** Theme recipes only: the ESpecialTheme enum value written to themeByRoomType. */
  themeValue?: string;
}

/**
 * The slice of game data the catalog needs - the recipe id list and the name lookups.
 * Structurally satisfied by `GameData` (the view passes it whole); narrowed so it stays
 * decoupled from the full catalog type.
 */
export interface RecipeCatalogSource {
  unlockables: { recipes: readonly string[] };
  weaponById: ReadonlyMap<string, { name: string }>;
  outfitById: ReadonlyMap<string, { name: string }>;
}

/** Humanize an enum-style id for display (e.g. "LivingQuarters" → "Living Quarters"). */
const humanize = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

/**
 * Project the static recipe catalog into display rows. Theme recipes are classified via
 * the theme reverse-map; everything else is joined to the weapon then outfit catalog for
 * its name. Ids that match nothing (e.g. the stray ESpecialTheme "None" in the list) are
 * dropped. Returns [] until game data has loaded.
 */
export function buildRecipeRows(gameData: RecipeCatalogSource | undefined): RecipeRow[] {
  if (!gameData) return [];
  const rows: RecipeRow[] = [];
  for (const id of gameData.unlockables.recipes) {
    const theme = themeRecipeInfo(id);
    if (theme) {
      rows.push({
        id,
        kind: 'Theme',
        roomType: theme.roomType,
        themeValue: theme.theme,
        name: `${humanize(theme.roomType)}: ${themeLabel(theme.theme)}`,
      });
      continue;
    }
    const weapon = gameData.weaponById.get(id);
    if (weapon) {
      rows.push({ id, kind: 'Weapon', name: weapon.name });
      continue;
    }
    const outfit = gameData.outfitById.get(id);
    if (outfit) {
      rows.push({ id, kind: 'Outfit', name: outfit.name });
      continue;
    }
    // Unmatched id (e.g. ESpecialTheme.None) - not a craftable item; skip.
  }
  return rows;
}
