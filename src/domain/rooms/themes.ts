// Room theme ("decoration") catalog. SOURCE OF TRUTH: the game's decompiled
// Assembly-CSharp (v2.4.1) - `GameParameters.SpecialThemeRooms`
// (Dictionary<ESpecialTheme, List<ERoomType>>) and the `ESpecialTheme` enum.
//
// Themes are stored in the save at `specialTheme.themeByRoomType` as
// { ERoomType-name: ESpecialTheme-name } and parsed back with Enum.Parse
// (SpecialTheme.Serialize/Deserialize), so the stored VALUE is the ESpecialTheme
// enum name verbatim (e.g. "Institute", "Concord", "AnniversaryParty") and the KEY
// is the ERoomType enum name (e.g. "Cafeteria", "FakeWasteland").
//
// Themes are PER ROOM TYPE, not per room instance - setting a Cafeteria's theme
// themes every Cafeteria, exactly like the in-game theme picker. Only the room types
// below can carry a theme; every other type shows no theme control.
//
// We expose the permanent "user" themes (ESpecialTheme.UserThemeStart range) plus
// None. The three seasonal themes (Xmas / Halloween / ThanksGiving) are gated by
// separately-crafted event items (`specialTheme.eventsThemes`) and are intentionally
// omitted - writing them without the crafted item is a silent no-op in the game.
//
// Each themed (roomType, theme) pair also maps to a RECIPE id - the theme item's
// `m_codeId` from GameParameters' ThemesList (m_themeType + m_roomType + m_codeId).
// These ids are IRREGULAR (e.g. AnniversaryParty→"CafeteriaAnniversary",
// Concord→"ConcordExterior", BrotherOfSteel→"LivingQuartersBrotherOfStell" - sic), so
// they are transcribed verbatim from the export, not derived. Applying a theme adds this
// id to `survivalW.recipes` so the in-game Theme Workshop recognises the recipe.

export interface RoomTheme {
  /** ESpecialTheme enum name written verbatim to themeByRoomType (e.g. "Institute"). */
  value: string;
  /** Human-readable label for the picker. */
  label: string;
}

/** The game's ESpecialTheme.None - "no theme" (always the first option). */
export const NO_THEME = 'None';

/** ESpecialTheme enum name → display label. */
const THEME_LABELS: Record<string, string> = {
  None: 'None',
  BrotherOfSteel: 'Brotherhood of Steel',
  Institute: 'Institute',
  Minutemen: 'Minutemen',
  Railroad: 'Railroad',
  AnniversaryParty: 'Anniversary',
  Vault33: 'Vault 33',
  Ultracite: 'Ultracite',
  SunsetSarsaparilla: 'Sunset Sarsaparilla',
  Enclave: 'Enclave',
  NewVegas: 'New Vegas',
  NewVegasNight: 'New Vegas (Night)',
  Lucky38Penthouse: 'Lucky 38 Penthouse',
  Concord: 'Concord',
};

// ERoomType name → ordered { ESpecialTheme enum name: recipe codeId } valid for it (from
// SpecialThemeRooms + ThemesList). "FakeWasteland" is the vault exterior; "NukaCola" is the
// Nuka-Cola Bottler. Insertion order is the picker order.
const THEMES_BY_ROOM: Record<string, Record<string, string>> = {
  Cafeteria: {
    BrotherOfSteel: 'CafeteriaBrotherOfSteel',
    Institute: 'CafeteriaInstitute',
    Minutemen: 'CafeteriaMinutemen',
    Railroad: 'CafeteriaRailroad',
    AnniversaryParty: 'CafeteriaAnniversary',
    Vault33: 'CafeteriaVault33',
    Enclave: 'CafeteriaEnclave',
  },
  LivingQuarters: {
    BrotherOfSteel: 'LivingQuartersBrotherOfStell',
    Institute: 'LivingQuartersInstitute',
    Minutemen: 'LivingQuartersMinutemen',
    Railroad: 'LivingQuartersRailroad',
    AnniversaryParty: 'LivingQuartersAnniversary',
    Vault33: 'LivingQuartersVault33',
    Enclave: 'LivingQuartersEnclave',
    Lucky38Penthouse: 'LivingQuartersLucky38Penthouse',
  },
  FakeWasteland: {
    Concord: 'ConcordExterior',
    Enclave: 'EnclaveExterior',
    Ultracite: 'ExteriorUltracite',
    NewVegas: 'NewVegasExterior',
    NewVegasNight: 'NewVegasNightExterior',
  },
  WeaponFactory: { Ultracite: 'WeaponFactory_Ultracite' },
  NukaCola: { SunsetSarsaparilla: 'SunsetSarsaparilla' },
};

/** Whether a room type supports themes at all (controls whether the picker is shown). */
export function roomTypeHasThemes(roomType: string): boolean {
  return roomType in THEMES_BY_ROOM;
}

/** Theme options for a room type (always led by None), or [] if the type has no themes. */
export function themeOptionsFor(roomType: string): RoomTheme[] {
  const themes = THEMES_BY_ROOM[roomType];
  if (!themes) return [];
  return [NO_THEME, ...Object.keys(themes)].map((value) => ({
    value,
    label: THEME_LABELS[value] ?? value,
  }));
}

/** Whether `theme` is a legal value for `roomType` (None allowed for any themed type). */
export function isThemeValidFor(roomType: string, theme: string): boolean {
  if (theme === NO_THEME) return roomTypeHasThemes(roomType);
  return theme in (THEMES_BY_ROOM[roomType] ?? {});
}

/**
 * The Theme Workshop RECIPE id (theme item `m_codeId`) for a (roomType, theme) pair, or
 * null if the pair has no recipe (None, or an unthemed type). Adding this to
 * `survivalW.recipes` makes the in-game workshop recognise an editor-applied theme.
 */
export function themeRecipeIdFor(roomType: string, theme: string): string | null {
  return THEMES_BY_ROOM[roomType]?.[theme] ?? null;
}

/** Display label for a stored theme enum name, falling back to the raw value. */
export const themeLabel = (value: string): string => THEME_LABELS[value] ?? value;

// Reverse of THEMES_BY_ROOM: theme RECIPE codeId → the (roomType, ESpecialTheme value) it
// themes. The codeIds are irregular, so this exact inverse lets the Recipes catalog
// classify an id as a theme and apply it back to the correct room type.
const THEME_RECIPE_INFO: Record<string, { roomType: string; theme: string }> = (() => {
  const map: Record<string, { roomType: string; theme: string }> = {};
  for (const [roomType, themes] of Object.entries(THEMES_BY_ROOM)) {
    for (const [theme, codeId] of Object.entries(themes)) {
      map[codeId] = { roomType, theme };
    }
  }
  return map;
})();

/**
 * Reverse-map a theme RECIPE codeId to the (roomType, ESpecialTheme value) it themes, or
 * null if `codeId` is not a known theme recipe. The inverse of {@link themeRecipeIdFor}.
 */
export function themeRecipeInfo(codeId: string): { roomType: string; theme: string } | null {
  return THEME_RECIPE_INFO[codeId] ?? null;
}
