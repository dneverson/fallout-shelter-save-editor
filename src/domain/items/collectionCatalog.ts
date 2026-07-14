import type { Rarity } from '../gamedata/schemas.ts';
import type { ItemIconType } from '../gamedata/visualSchemas.ts';
import type { CollectionKey } from '../ops/collectionOps.ts';

// Browsable SURVIVAL GUIDE catalog, mirroring recipeCatalog: pure reference rows the
// view layers per-save state onto. One row per entry the in-game guide can show
// (SurvivalWindow.Initialize, verified against the decompiled game):
//   • weapons - every weapon except the vault default ("Fist") and rarity None.
//   • outfits - the PREMIUM outfit list only (EOutfitCategory.Premium = 2; the game
//     resolves saved codes via GetPremiumOutfitByCode, so other categories never load).
//   • dwellers - the DwellerManager legendary roster == the "L_*" unique-dweller catalog
//     entries, minus L_SnipSnip (a Mr. Handy variant that shares the naming scheme but
//     is absent from m_legendaryDwellers).
//   • pets - legendary pets only (non-legendaries are tracked per-BREED instead).
//   • breeds - every EPetBreed 0..Count-1 except DefaultRollerbrain (43), named/iconed
//     via that breed's lowest-rarity pet.
//   • junk - every junk item (rarity None excluded, matching the game's guard).
// Each row's `code` is exactly what `survivalW.<category>` stores after its N/O prefix.

export interface CollectionRow {
  /** Stable row id: `<category>:<code>` (codes are only unique per category). */
  key: string;
  category: CollectionKey;
  /** Save code (`survivalW` entry minus its N/O prefix). */
  code: string;
  name: string;
  /** Item rarity; null for breeds (a breed has no rarity of its own). */
  rarity: Rarity | null;
  /** Item-icon atlas ref, or null when there is no item sprite (legendary dwellers). */
  icon: { type: ItemIconType; id: string } | null;
}

/** Section labels for the category column/filter (singular, like the Recipes Type column). */
export const COLLECTION_CATEGORY_LABELS: Record<CollectionKey, string> = {
  weapons: 'Weapon',
  outfits: 'Outfit',
  dwellers: 'Dweller',
  pets: 'Pet',
  breeds: 'Pet Breed',
  junk: 'Junk',
};

/** EOutfitCategory.Premium - the only outfit list the guide serializes/deserializes. */
const PREMIUM_OUTFIT_CATEGORY = 2;
/** m_vaultDefaultWeapon: never listed in the guide. */
const DEFAULT_WEAPON_ID = 'Fist';
/** EPetBreed.DefaultRollerbrain - skipped by the game's breed loop. */
const EXCLUDED_BREED_CODE = 43;
/** EPetBreed.Count - end of the game's breed loop. */
const BREED_COUNT = 44;
/** A UniqueMrHandyData that shares the "L_" naming but is not a legendary dweller. */
const NON_DWELLER_UNIQUE_IDS = new Set(['L_SnipSnip']);

/**
 * The slice of game data the catalog needs. Structurally satisfied by `GameData` (the
 * view passes it whole); narrowed so it stays decoupled from the full catalog type.
 */
export interface CollectionCatalogSource {
  weapons: ReadonlyArray<{ id: string; name: string; rarity: Rarity; codeId: string }>;
  outfits: ReadonlyArray<{
    id: string;
    name: string;
    rarity: Rarity;
    category: number;
    codeId: string;
  }>;
  junk: ReadonlyArray<{ id: string; name: string; rarity: Rarity; codeId: string }>;
  pets: ReadonlyArray<{
    id: string;
    name: string;
    baseName: string;
    breedCode: number;
    rarity: Rarity;
    rarityCode: number;
    codeId: number;
  }>;
  uniqueDwellers: Readonly<Record<string, { name: string; lastName: string }>>;
  enums: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** Humanize an enum-style id for display (e.g. "GermanShepherd" → "German Shepherd"). */
const humanize = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

const byName = (a: CollectionRow, b: CollectionRow): number => a.name.localeCompare(b.name);

/**
 * Project game data into Survival Guide display rows, grouped in game tab order
 * (weapons, outfits, dwellers, pets, breeds, junk) and name-sorted within each group.
 * Returns [] until game data has loaded. Items without a code (stale fixtures) are
 * dropped - a code is the row's identity in the save.
 */
export function buildCollectionRows(
  gameData: CollectionCatalogSource | undefined,
): CollectionRow[] {
  if (!gameData) return [];

  const row = (
    category: CollectionKey,
    code: string,
    name: string,
    rarity: Rarity | null,
    icon: CollectionRow['icon'],
  ): CollectionRow => ({ key: `${category}:${code}`, category, code, name, rarity, icon });

  const weapons = gameData.weapons
    .filter((w) => w.rarity !== 'None' && w.id !== DEFAULT_WEAPON_ID && w.codeId !== '')
    .map((w) => row('weapons', w.codeId, w.name, w.rarity, { type: 'weapons', id: w.id }));

  const outfits = gameData.outfits
    .filter((o) => o.category === PREMIUM_OUTFIT_CATEGORY && o.rarity !== 'None' && o.codeId !== '')
    .map((o) => row('outfits', o.codeId, o.name, o.rarity, { type: 'outfits', id: o.id }));

  const dwellers = Object.entries(gameData.uniqueDwellers)
    .filter(([id]) => id.startsWith('L_') && !NON_DWELLER_UNIQUE_IDS.has(id))
    .map(([id, d]) =>
      row('dwellers', id, [d.name, d.lastName].filter(Boolean).join(' '), 'Legendary', null),
    );

  const pets = gameData.pets
    .filter((p) => p.rarity === 'Legendary')
    .map((p) =>
      row(
        'pets',
        String(p.codeId),
        // Legendary pets carry a special name (e.g. "Dogmeat") in baseName; keep the
        // breed name alongside so the row stays searchable by either.
        p.baseName && p.baseName !== p.name ? `${p.baseName} (${p.name})` : p.name,
        p.rarity,
        { type: 'pets', id: p.id },
      ),
    );

  // Breeds: name + icon come from that breed's lowest-rarity pet (the breed entry in the
  // in-game guide reuses the pet art); enum-name fallback covers breeds with no pet art.
  const petsByBreed = new Map<number, CollectionCatalogSource['pets'][number]>();
  for (const p of gameData.pets) {
    const existing = petsByBreed.get(p.breedCode);
    if (!existing || p.rarityCode < existing.rarityCode) petsByBreed.set(p.breedCode, p);
  }
  const breeds = Object.entries(gameData.enums['EPetBreed'] ?? {})
    .filter(([, value]) => value >= 0 && value < BREED_COUNT && value !== EXCLUDED_BREED_CODE)
    .map(([enumName, value]) => {
      const pet = petsByBreed.get(value);
      return row(
        'breeds',
        String(value),
        pet?.name ?? humanize(enumName),
        null,
        pet ? { type: 'pets', id: pet.id } : null,
      );
    });

  const junk = gameData.junk
    .filter((j) => j.rarity !== 'None' && j.codeId !== '')
    .map((j) => row('junk', j.codeId, j.name, j.rarity, { type: 'junk', id: j.id }));

  return [
    ...weapons.sort(byName),
    ...outfits.sort(byName),
    ...dwellers.sort(byName),
    ...pets.sort(byName),
    ...breeds.sort(byName),
    ...junk.sort(byName),
  ];
}

// --- Item id → guide code index (auto-collect) -----------------------------------
//
// The inverse join: what guide entry (if any) does an ITEM ID map to? Consumed by
// domain/ops/guideAutoCollect.ts, which marks objects the user adds elsewhere in the
// editor (storage grants, equips, special dwellers, pets, …) as collected - mirroring
// the game's OnNewItem/OnNewUniqueDweller. Uses the exact same membership rules as
// `buildCollectionRows` above; ids that map to nothing (casual outfits, Fist, …) have
// no guide entry, matching the game's guards.

/** What each pet id contributes: its own legendary card and/or its breed entry. */
export interface GuidePetRef {
  /** `survivalW.pets` code, or null for non-legendary pets (tracked per breed). */
  petCode: string | null;
  /** `survivalW.breeds` code, or null for legendary pets / excluded breeds. */
  breedCode: string | null;
}

export interface GuideCodeIndex {
  /** weapon id → `survivalW.weapons` code. */
  weapons: ReadonlyMap<string, string>;
  /** PREMIUM outfit id → `survivalW.outfits` code. */
  outfits: ReadonlyMap<string, string>;
  /** junk id → `survivalW.junk` code. */
  junk: ReadonlyMap<string, string>;
  /** pet id → its guide contributions. */
  pets: ReadonlyMap<string, GuidePetRef>;
  /** Legendary `uniqueData` ids (== `survivalW.dwellers` codes). */
  dwellers: ReadonlySet<string>;
}

/** Build the item-id → guide-code index from game data (same rules as the catalog rows). */
export function buildGuideCodeIndex(gameData: CollectionCatalogSource): GuideCodeIndex {
  const pets = new Map<string, GuidePetRef>();
  for (const p of gameData.pets) {
    const legendary = p.rarity === 'Legendary';
    const breedValid =
      p.breedCode >= 0 && p.breedCode < BREED_COUNT && p.breedCode !== EXCLUDED_BREED_CODE;
    pets.set(p.id, {
      petCode: legendary ? String(p.codeId) : null,
      // The game only writes a breed entry for NON-legendary acquisitions
      // (SurvivalWindow.OnNewItem skips the breed when rarity is Legendary).
      breedCode: !legendary && breedValid ? String(p.breedCode) : null,
    });
  }
  return {
    weapons: new Map(
      gameData.weapons
        .filter((w) => w.rarity !== 'None' && w.id !== DEFAULT_WEAPON_ID && w.codeId !== '')
        .map((w) => [w.id, w.codeId]),
    ),
    outfits: new Map(
      gameData.outfits
        .filter(
          (o) => o.category === PREMIUM_OUTFIT_CATEGORY && o.rarity !== 'None' && o.codeId !== '',
        )
        .map((o) => [o.id, o.codeId]),
    ),
    junk: new Map(
      gameData.junk
        .filter((j) => j.rarity !== 'None' && j.codeId !== '')
        .map((j) => [j.id, j.codeId]),
    ),
    pets,
    dwellers: new Set(
      Object.keys(gameData.uniqueDwellers).filter(
        (id) => id.startsWith('L_') && !NON_DWELLER_UNIQUE_IDS.has(id),
      ),
    ),
  };
}
