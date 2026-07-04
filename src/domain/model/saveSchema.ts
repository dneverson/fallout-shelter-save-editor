import { z } from 'zod';

// Typed-permissive save model. We validate ONLY the fields
// we actually read/write and let every other key pass through untouched - this is
// what guarantees round-trip fidelity: unknown/untouched managers survive
// a decode→encode cycle semantically unchanged.
//
// `z.looseObject` keeps unknown keys (Zod 4's replacement for `.passthrough()`).
// The save is never `.parse()`d as a whole (the codec casts - see saveCodec.ts);
// these schemas are the single source of truth for the *types* the edit ops use,
// and stay available for targeted validation. The edit surface grows phase by
// phase; we deliberately never validate the full ~30k-key save.

// --- Dweller edit surface ----------------------------
// Only fields dwellerOps read/write are named; every other dweller key (uniqueData,
// deathSource, savedRoom, assigned, relations, …) rides through via looseObject.
// Leaf numbers that an op may spread over a possibly-absent parent are optional so
// the immutable setters type-check even against a sparse/malformed dweller.

/** 1 = female, 2 = male. */
export type Gender = 1 | 2;

/** Dweller rarity tier (`dweller.rarity`). */
// EDwellerRarity enum names (Common = 0 is the fresh-spawn default in real saves).
export type DwellerRarity = 'Common' | 'Normal' | 'Rare' | 'Legendary';

/** A single SPECIAL entry; index 0 is a placeholder, 1..7 = S P E C I A L. */
const statEntrySchema = z.looseObject({
  value: z.number(),
});

const statsSchema = z.looseObject({
  stats: z.array(statEntrySchema),
});

const healthSchema = z.looseObject({
  healthValue: z.number().optional(),
  maxHealth: z.number().optional(),
  radiationValue: z.number().optional(),
});

const happinessSchema = z.looseObject({
  happinessValue: z.number(),
});

const experienceSchema = z.looseObject({
  currentLevel: z.number(),
  experienceValue: z.number(),
  needLvUp: z.boolean(),
});

/** Pet instance data - present on equipped/stored pets. */
const petExtraDataSchema = z.looseObject({
  uniqueName: z.string().optional(),
  bonus: z.string().optional(),
  bonusValue: z.number().optional(),
});

/**
 * Shared shape for an equipped slot AND a stored inventory entry.
 * `type ∈ Weapon|Outfit|Junk|Pet`; pets additionally carry `extraData`. Unknown
 * keys (hasBeenAssigned, hasRandonWeaponBeenAssigned, …) ride through via looseObject.
 */
const itemSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  extraData: petExtraDataSchema.optional(),
});

// Family tree. `partner` is the partner's serializeId (-1 none).
// `ascendants` = [parent0, parent1, grandparent0..3] storing each ascendant's AscendancyID
// (a normal dweller's = its serializeId; a unique dweller's = a negative per-character id).
const relationsSchema = z.looseObject({
  partner: z.number().optional(),
  ascendants: z.array(z.number()).optional(),
});

const dwellerSchema = z.looseObject({
  serializeId: z.number(),
  // Unique/special-character id string (e.g. "L_Max") - present only on special dwellers.
  uniqueData: z.string().optional(),
  relations: relationsSchema.optional(),
  name: z.string().optional(),
  lastName: z.string().optional(),
  gender: z.number().optional(),
  rarity: z.string().optional(),
  hair: z.string().optional(),
  faceMask: z.string().optional(),
  pregnant: z.boolean().optional(),
  babyReady: z.boolean().optional(),
  skinColor: z.number().optional(),
  hairColor: z.number().optional(),
  outfitColor: z.number().optional(),
  savedRoom: z.number().optional(),
  happiness: happinessSchema.optional(),
  health: healthSchema.optional(),
  experience: experienceSchema.optional(),
  stats: statsSchema.optional(),
  equipedOutfit: itemSchema.optional(),
  equipedWeapon: itemSchema.optional(),
  equippedPet: itemSchema.optional(),
});

// Actors = Mr. Handies (characterType 2) + pet actors (3) + specials. Unlike dwellers,
// an actor's `health` is a flat number (current HP). Only the fields the Mr. Handy ops
// (bulk heal, the Mr. Handies tab) touch are named; everything else rides through via
// looseObject. `savedRoom` mirrors the dweller field (the room the robot stands in);
// `MrHandyVariantID` is the cosmetic skin id ("MrHandy" = the default look).
const actorSchema = z.looseObject({
  serializeId: z.number().optional(),
  characterType: z.number().optional(),
  actorDataId: z.string().nullable().optional(),
  name: z.string().optional(),
  health: z.number().optional(),
  death: z.boolean().optional(),
  savedRoom: z.number().optional(),
  MrHandyVariantID: z.string().optional(),
});

const dwellersBlockSchema = z.looseObject({
  dwellers: z.array(dwellerSchema),
  actors: z.array(actorSchema).optional(),
});

/** An actor (Mr. Handy / pet / special) in `dwellers.actors[]`. */
export type Actor = z.infer<typeof actorSchema>;

/** Actor characterType for Mr. Handies (Snip Snip shares it, keyed by actorDataId). */
export const MR_HANDY_CHARACTER_TYPE = 2;

/**
 * Every vault-helper robot characterType (game's ECharacterType): 2 = MrHandy/SnipSnip,
 * 5 = Victor, 6 = Curie. All three serialize the same actor shape with an
 * `MrHandyVariantID` and are placed via a room's `mrHandyList`.
 */
export const VAULT_HELPER_CHARACTER_TYPES: ReadonlySet<number> = new Set([2, 5, 6]);

// --- Vault rooms (read-only surface: roster location lookup) -------------------
// A dweller's `savedRoom` equals the room's `deserializeID` (verified against the
// real save); -1 = standing at the vault door. Only the fields the location
// projector reads are named; everything else passes through.
// `level`/`mergeLevel` feed the room-capacity lookup (vault caps / storage meter);
// `currentStateName` is the emergency state cleared by the "clear emergencies" quick action.
// `roomHealth.damageValue` is accumulated DAMAGE (0 = healthy; clamps to a max); a repaired
// room has `damageValue: 0`. `initialValue` is the emergency-start damage (reward bookkeeping).
const roomHealthSchema = z.looseObject({
  damageValue: z.number().optional(),
  initialValue: z.number().optional(),
});

const roomSchema = z.looseObject({
  type: z.string(),
  deserializeID: z.number(),
  class: z.string().optional(),
  row: z.number().optional(),
  col: z.number().optional(),
  level: z.number().optional(),
  mergeLevel: z.number().optional(),
  power: z.boolean().optional(),
  broken: z.boolean().optional(),
  roomHealth: roomHealthSchema.optional(),
  assignedDecoration: z.string().optional(),
  currentStateName: z.string().optional(),
  dwellers: z.array(z.number()).optional(),
  // Mr. Handy actor serializeIds attached to this room. On load the game only places a
  // Mr. Handy if SOME room's mrHandyList references it (Room.DeserializeDwellers), so
  // structural ops must never drop these ids or the robot disappears in-game.
  mrHandyList: z.array(z.number()).optional(),
});

// --- Vault inventory (storage) - pet attach "from storage" reads stored pets, and
// detaching a pet returns it here. This schema only needs to read/move items.
const inventorySchema = z.looseObject({
  items: z.array(itemSchema).optional(),
});

// --- Vault settings edit surface ----------------
// `resources` is a flat resource-key → amount map (Nuka = caps; Food/Energy/Water;
// StimPack/RadAway; NukaColaQuantum/PokerChip; …). All values are numbers (some
// fractional in-game), so a number catchall keeps unknown resource keys round-tripping.
const storageSchema = z.looseObject({
  resources: z.record(z.string(), z.number()).optional(),
});

const vaultSchema = z.looseObject({
  rooms: z.array(roomSchema).optional(),
  inventory: inventorySchema.optional(),
  storage: storageSchema.optional(),
  VaultName: z.string().optional(),
  VaultMode: z.string().optional(),
  VaultTheme: z.number().optional(),
  // Consumables live as a per-type code list (0 Lunchbox / 1 MrHandy / 2 PetCarrier /
  // 3 StarterPack); the count is the array length (rebuilt together on edit).
  LunchBoxesByType: z.array(z.number()).optional(),
  LunchBoxesCount: z.number().optional(),
  rocks: z.array(z.unknown()).optional(),
  // Ultracite deposits ({r, c} cells, season vaults only): serialized beside rocks by
  // Vault.Serialize and blocking construction the same way (ConstructionGrid.CanGetSpace).
  ultracite: z.array(z.unknown()).optional(),
});

// --- Top-level managers the vault quick actions edit ------
const mysteriousStrangerSchema = z.looseObject({
  currentState: z.string().optional(),
  canAppear: z.boolean().optional(),
  // Seconds between appearances, and the live countdown to the next one.
  timeToAppear: z.number().optional(),
  remainingTimeToAppear: z.number().optional(),
});

const unlockableMgrSchema = z.looseObject({
  claimed: z.array(z.string()).optional(),
  completed: z.array(z.unknown()).optional(),
  objectivesInProgress: z.array(z.unknown()).optional(),
});

const themeItemSchema = z.looseObject({
  extraData: z.looseObject({ partsCollectedCount: z.number().optional() }).optional(),
});

const survivalWSchema = z.looseObject({
  recipes: z.array(z.string()).optional(),
  collectedThemes: z.looseObject({ themeList: z.array(themeItemSchema).optional() }).optional(),
});

const dwellerSpawnerSchema = z.looseObject({
  dwellersWaiting: z.array(z.unknown()).optional(),
});

// In-game store state. `isStarterPackPurchased` is the only field we edit: setting it true
// HIDES the real-money Starter Pack offer in the shop (it does NOT grant the pack's contents).
// `hasStarterPackPopupShown` and any other keys ride through untouched.
const shopWindowSchema = z.looseObject({
  isStarterPackPurchased: z.boolean().optional(),
  hasStarterPackPopupShown: z.boolean().optional(),
});

// Per-room-TYPE visual themes (the in-game room "decoration"/skin). `themeByRoomType`
// maps an ERoomType name → an ESpecialTheme name ({ "Cafeteria": "Institute", … });
// `eventsThemes`/`lastOverallTheme` ride through untouched. See src/domain/rooms/themes.ts.
const specialThemeSchema = z.looseObject({
  themeByRoomType: z.record(z.string(), z.string()).optional(),
});

export const saveSchema = z.looseObject({
  dwellers: dwellersBlockSchema.optional(),
  vault: vaultSchema.optional(),
  specialTheme: specialThemeSchema.optional(),
  MysteriousStranger: mysteriousStrangerSchema.optional(),
  unlockableMgr: unlockableMgrSchema.optional(),
  survivalW: survivalWSchema.optional(),
  dwellerSpawner: dwellerSpawnerSchema.optional(),
  ShopWindow: shopWindowSchema.optional(),
  // Cosmetic device string (SystemInfo.deviceName). Randomized on sandbox loads so the
  // bundled baseline is not traceable to one device across every user's exports.
  deviceName: z.string().optional(),
});

/** A single dweller, edit-surface typed; all other keys pass through. */
export type Dweller = z.infer<typeof dwellerSchema>;

/** A vault room, read-only surface for roster location lookup. */
export type Room = z.infer<typeof roomSchema>;

/** An equipped slot or stored inventory entry (Weapon/Outfit/Junk/Pet). */
export type Item = z.infer<typeof itemSchema>;

/** Pet instance data carried in an item's `extraData`. */
export type PetExtraData = z.infer<typeof petExtraDataSchema>;

/** The decoded save JSON. Edit-surface typing is layered on phase by phase. */
export type SaveData = z.infer<typeof saveSchema>;
