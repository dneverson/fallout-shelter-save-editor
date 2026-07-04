import { z } from 'zod';
import {
  enumsSchema,
  hairSchema,
  junkSchema,
  metaSchema,
  handySchema,
  outfitSchema,
  petSchema,
  roomCapacitySchema,
  roomMetadataSchema,
  roomProductionSchema,
  unlockablesSchema,
  uniqueDwellersSchema,
  weaponSchema,
  type GameDataMeta,
  type GameEnums,
  type Hair,
  type Handy,
  type Junk,
  type Outfit,
  type Pet,
  type RoomCapacity,
  type RoomMetadata,
  type RoomMetadataEntry,
  type RoomProduction,
  type Unlockables,
  type UniqueDwellers,
  type Weapon,
} from './schemas.ts';
import { assetUrl } from './assetBase.ts';

// Game-data access layer. Validates the committed JSON and
// builds id→entry lookup maps. Writing an item validates the id exists here,
// guarding the "wrong id → game swaps to default" failure mode.

export interface GameData {
  weapons: Weapon[];
  outfits: Outfit[];
  junk: Junk[];
  pets: Pet[];
  /** Vault-helper robot catalog (Mr. Handy / Snip Snip / Victor / Curie). */
  handies: Handy[];
  hair: Hair[];
  enums: GameEnums;
  meta: GameDataMeta;
  /** Unlock-all catalogs for the vault quick actions. */
  unlockables: Unlockables;
  /** Per-room storage/production capacity catalog (vault caps + storage meter). */
  roomCapacity: RoomCapacity;
  /** Per-room-type metadata catalog (build palette / validator / room ops). */
  roomMetadata: RoomMetadata;
  /** Per-room production/consumption catalog + economy constants (Advisor). */
  roomProduction: RoomProduction;
  /** Unique/special-character catalog keyed by `uniqueData` id (family viewer). */
  uniqueDwellers: UniqueDwellers;
  /** roomType → metadata entry (cost, footprint, merge/level maxima, primary stat). */
  roomMetadataByType: ReadonlyMap<string, RoomMetadataEntry>;
  weaponById: ReadonlyMap<string, Weapon>;
  outfitById: ReadonlyMap<string, Outfit>;
  junkById: ReadonlyMap<string, Junk>;
  petById: ReadonlyMap<string, Pet>;
  /** Handy catalog keyed by the save's `MrHandyVariantID` value. */
  handyByVariant: ReadonlyMap<string, Handy>;
  /**
   * Hair/face catalog indexed by `pieceName` - the value actually stored in a
   * dweller's `hair`/`faceMask` field (e.g. "03", "Kellogg_hair", "ghoul_face").
   * `pieceName` is NOT unique across genders, so this keeps the last entry for
   * label lookup; use `hairOptions` to build a gender-filtered, deduped picker.
   */
  hairByPiece: ReadonlyMap<string, Hair>;
}

export interface RawGameData {
  weapons: unknown;
  outfits: unknown;
  junk: unknown;
  pets: unknown;
  /** Optional so pre-existing test fixtures stay minimal; the loader always fetches it. */
  handies?: unknown;
  hair: unknown;
  enums: unknown;
  meta: unknown;
  unlockables: unknown;
  roomCapacity: unknown;
  roomMetadata: unknown;
  roomProduction: unknown;
  uniqueDwellers: unknown;
}

/**
 * Canonicalize a room display name to Title Case. The extracted localization mixes
 * ALL-CAPS ("ARMORY", "NUCLEAR REACTOR") and Title-Case ("Classroom", "Nuka Cola")
 * names, which reads as unfinished across the Build palette, grid, side panel, loadouts,
 * and Advisor. Normalizing here - the single point every surface reads room names through
 * (`roomMetadataByType`) - makes the casing consistent everywhere at once. Capitalizes the
 * first letter of each whitespace-separated word and lowercases the rest, preserving
 * intra-word punctuation ("OVERSEER'S OFFICE" → "Overseer's Office").
 */
export function normalizeRoomName(name: string): string {
  return name.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/** Validate raw JSON and index it. Pure - no I/O, so it's unit-testable in Node. */
export function parseGameData(raw: RawGameData): GameData {
  const weapons = z.array(weaponSchema).parse(raw.weapons);
  const outfits = z.array(outfitSchema).parse(raw.outfits);
  const junk = z.array(junkSchema).parse(raw.junk);
  const pets = z.array(petSchema).parse(raw.pets);
  const handies = z.array(handySchema).parse(raw.handies ?? []);
  const hair = z.array(hairSchema).parse(raw.hair);
  const enums = enumsSchema.parse(raw.enums);
  const meta = metaSchema.parse(raw.meta);
  const unlockables = unlockablesSchema.parse(raw.unlockables);
  const roomCapacity = roomCapacitySchema.parse(raw.roomCapacity);
  const roomMetadata = roomMetadataSchema.parse(raw.roomMetadata);
  const roomProduction = roomProductionSchema.parse(raw.roomProduction);
  const uniqueDwellers = uniqueDwellersSchema.parse(raw.uniqueDwellers);

  return {
    weapons,
    outfits,
    junk,
    pets,
    handies,
    hair,
    enums,
    meta,
    unlockables,
    roomCapacity,
    roomMetadata,
    roomProduction,
    uniqueDwellers,
    roomMetadataByType: new Map(
      Object.entries(roomMetadata.rooms).map(([type, entry]) => [
        type,
        { ...entry, name: normalizeRoomName(entry.name) },
      ]),
    ),
    weaponById: new Map(weapons.map((w) => [w.id, w])),
    outfitById: new Map(outfits.map((o) => [o.id, o])),
    junkById: new Map(junk.map((j) => [j.id, j])),
    petById: new Map(pets.map((p) => [p.id, p])),
    handyByVariant: new Map(handies.map((h) => [h.variantId, h])),
    hairByPiece: new Map(hair.map((h) => [h.pieceName, h])),
  };
}

// --- Hair / facial-hair pickers -------------------------------------------------
//
// A dweller's `hair` field maps to catalog entries with attribute "Hair"; `faceMask`
// (facial hair / face accessory) maps to attribute "Face". The catalog's `gender` is
// INVERTED relative to the save: catalog 1 = Male, 2 = Female, but the save stores
// 1 = Female, 2 = Male. `hairOptions` translates the dweller's save-gender so the
// picker only offers gender-appropriate pieces, mirroring the in-game barbershop.

export type HairKind = 'hair' | 'face';

/** One choice in the hair/face picker; `value` is written verbatim to the save. */
export interface HairOption {
  value: string;
  label: string;
  sortId: number;
}

const CATALOG_ATTRIBUTE: Record<HairKind, string> = { hair: 'Hair', face: 'Face' };

/** Save gender (1=F, 2=M) → catalog gender (1=M, 2=F); undefined = no filter. */
const catalogGenderFor = (saveGender?: number): number | undefined =>
  saveGender === 1 ? 2 : saveGender === 2 ? 1 : undefined;

/**
 * Deduped, gender-filtered options for the hair (`kind: 'hair'`) or facial-hair
 * (`kind: 'face'`) picker, sorted by the catalog's display order. Pass the dweller's
 * SAVE gender to limit the list; omit it to list every piece.
 */
export function hairOptions(data: GameData, kind: HairKind, saveGender?: number): HairOption[] {
  const attribute = CATALOG_ATTRIBUTE[kind];
  const wantedGender = catalogGenderFor(saveGender);
  const seen = new Set<string>();
  const out: HairOption[] = [];
  for (const piece of data.hair) {
    if (piece.attribute !== attribute) continue;
    if (wantedGender !== undefined && piece.gender !== wantedGender) continue;
    if (seen.has(piece.pieceName)) continue;
    seen.add(piece.pieceName);
    out.push({ value: piece.pieceName, label: piece.name, sortId: piece.sortId });
  }
  out.sort((a, b) => a.sortId - b.sortId || a.label.localeCompare(b.label));
  return out;
}

/** Display label for a stored `hair`/`faceMask` value, falling back to the raw code. */
export const hairLabel = (data: GameData, pieceName: string): string =>
  data.hairByPiece.get(pieceName)?.name ?? pieceName;

const GAMEDATA_FILES = [
  'weapons',
  'outfits',
  'junk',
  'pets',
  'handies',
  'hair',
  'enums',
  'meta',
  'unlockables',
  'room-capacity',
  'room-metadata',
  'room-production',
  'unique-dwellers',
] as const;

/** Fetch + validate the game data from the served gamedata directory (browser). */
export async function loadGameData(baseUrl = assetUrl('gamedata')): Promise<GameData> {
  const [
    weapons,
    outfits,
    junk,
    pets,
    handies,
    hair,
    enums,
    meta,
    unlockables,
    roomCapacity,
    roomMetadata,
    roomProduction,
    uniqueDwellers,
  ] = await Promise.all(
    GAMEDATA_FILES.map(async (name) => {
      const res = await fetch(`${baseUrl}/${name}.json`);
      if (!res.ok) throw new Error(`Failed to load ${name}.json (HTTP ${res.status})`);
      return res.json() as Promise<unknown>;
    }),
  );
  return parseGameData({
    weapons,
    outfits,
    junk,
    pets,
    handies,
    hair,
    enums,
    meta,
    unlockables,
    roomCapacity,
    roomMetadata,
    roomProduction,
    uniqueDwellers,
  });
}

// --- Id-existence guards ------------------------------------------------
export const isKnownWeaponId = (data: GameData, id: string): boolean => data.weaponById.has(id);
export const isKnownOutfitId = (data: GameData, id: string): boolean => data.outfitById.has(id);
export const isKnownPetId = (data: GameData, id: string): boolean => data.petById.has(id);

/**
 * The Endurance bonus (`special.E`) an outfit grants, or 0 for an unknown/empty id. Feeds
 * dweller HP scaling: the game adds the equipped outfit's Endurance to base Endurance when
 * computing max HP at each level-up (see domain/ops/dwellerHealth.ts).
 */
export const outfitEnduranceBonus = (data: GameData, outfitId: string | undefined): number =>
  (outfitId ? data.outfitById.get(outfitId)?.special.E : 0) ?? 0;

// --- Pet bonus range (value within the breed/rarity's legal range) ----

/** The legal [min, max] bonus-value range for a pet id, and whether it's integer-only. */
export interface PetBonusRange {
  /** EBonusEffect name locked to this pet (e.g. "DamageBoost"). */
  bonus: string;
  min: number;
  max: number;
  /** The game rolls integers when the min is whole (DwellerPetItem.GenerateRandomData). */
  integer: boolean;
}

/**
 * A pet's special in-game name when it has one (e.g. "Mr. Pebbles", "Dogmeat"), else its
 * breed name. The catalog stores the special name in `baseName` and the breed display name
 * in `name`; 63 legendaries carry a distinct `baseName`. Used as the default unique name
 * for a freshly-minted catalog instance so creating Mr. Pebbles yields a pet so named.
 */
export const petSpecialName = (pet: Pet): string =>
  pet.baseName && pet.baseName !== pet.name ? pet.baseName : pet.name;

/** Resolve a pet id's locked bonus + value range, or null if the id is unknown. */
export function petBonusRange(data: GameData, id: string): PetBonusRange | null {
  const pet = data.petById.get(id);
  if (!pet) return null;
  return {
    bonus: pet.bonus,
    min: pet.bonusMin,
    max: pet.bonusMax,
    integer: pet.bonusMin % 1 === 0,
  };
}
