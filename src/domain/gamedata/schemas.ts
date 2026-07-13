import { z } from 'zod';

// Zod schemas for the committed public/gamedata/*.json (generated offline by
// scripts/build-gamedata). These validate the shipped artifact on load and are the
// single source of truth for the game-data types.

const raritySchema = z.enum(['None', 'Common', 'Normal', 'Rare', 'Legendary']);

const specialSchema = z.object({
  S: z.number(),
  P: z.number(),
  E: z.number(),
  C: z.number(),
  I: z.number(),
  A: z.number(),
  L: z.number(),
});

export const weaponSchema = z.object({
  id: z.string(),
  name: z.string(),
  damageMin: z.number(),
  damageMax: z.number(),
  type: z.number(),
  tier: z.number(),
  rarity: raritySchema,
  sprite: z.string(),
});

export const outfitSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.number(),
  special: specialSchema,
  hasHelmet: z.boolean(),
  rarity: raritySchema,
  sprite: z.string(),
  /** Gender the outfit is locked to (no mesh for the other gender), or null when unisex. */
  gender: z.enum(['male', 'female']).nullable().default(null),
});

export const junkSchema = z.object({
  id: z.string(),
  name: z.string(),
  rarity: raritySchema,
  /** Sell price (caps), joined from the prefab card list's m_sellPrice; 0 if none. */
  value: z.number(),
  sprite: z.string(),
});

// One pet item = a breed+rarity entry from PetsCustomizationData (130 total). The
// bonus EFFECT is locked per id; the rolled value lives in `[bonusMin, bonusMax]`
//. Extra catalog fields (codeId, sellPrice, odds, …) are
// captured for the Pets master-detail screen even though the equip editor ignores them.
export const petSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseName: z.string(),
  breed: z.string(),
  breedCode: z.number(),
  type: z.string(),
  typeCode: z.number(),
  rarity: raritySchema,
  rarityCode: z.number(),
  bonus: z.string(),
  bonusCode: z.number(),
  bonusMin: z.number(),
  bonusMax: z.number(),
  sprite: z.string(),
  headSprite: z.string(),
  poolName: z.string(),
  codeId: z.number(),
  sellPrice: z.number(),
  petCarrierOdds: z.number(),
  descriptionLocalization: z.string(),
  isHidden: z.boolean(),
  craftOnly: z.boolean(),
  lunchboxOnly: z.boolean(),
  sortIndex: z.number(),
});

// Vault-helper robot catalog (handies.json): the four Mr. Handy variants with their
// exact save encoding (characterType / actorDataId / MrHandyVariantID) and provenance.
export const handySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Written to the actor's `MrHandyVariantID` (VaultHelperVariant enum name). */
  variantId: z.string(),
  /** Written to the actor's `characterType` (2 = MrHandy/SnipSnip, 5 = Victor, 6 = Curie). */
  characterType: z.number(),
  /** Written to the actor's `actorDataId` (null for the plain Mr. Handy). */
  actorDataId: z.string().nullable(),
  sprite: z.string(),
  source: z.string(),
  starterPack: z.boolean(),
  mrHandyBoxOdds: z.number(),
  lotteryOdds: z.object({ normal: z.number(), rare: z.number(), legendary: z.number() }),
});

export const hairSchema = z.object({
  catalogId: z.string(),
  pieceName: z.string(),
  sortId: z.number(),
  name: z.string(),
  attribute: z.string(),
  gender: z.number(),
  price: z.number(),
});

export const enumsSchema = z.record(z.string(), z.record(z.string(), z.number()));

// Unlock-all catalogs for the vault quick actions.
export const unlockablesSchema = z.object({
  /** Every craftable item id → written to `survivalW.recipes`. */
  recipes: z.array(z.string()),
  /** Every room-unlock objective id → written to `unlockableMgr.claimed`. */
  roomUnlocks: z.array(z.string()),
});

// Per-room storage/production capacity catalog.
// Drives the "Max resources" legal caps + the storage-capacity meter. Caps are
// derived: base + Σ each room's contribution at its (mergeLevel, level).
const roomLevelCapacitySchema = z.object({
  maxDwellers: z.number(),
  /** Resource-cap contribution keyed by save resource key (Food/Water/Energy/…). */
  storage: z.record(z.string(), z.number()),
  /** Item-storage (weapon/outfit/junk count) contribution. */
  storageItems: z.number(),
});

export const roomCapacitySchema = z.object({
  base: z.object({
    resources: z.record(z.string(), z.number()),
    items: z.number(),
    maxPetCount: z.number(),
    /** Mr. Handy full health ("Max Everything"). */
    mrHandyHealth: z.number(),
  }),
  /** Per-dweller consumable caps (StimPack/RadAway scale with dweller count). */
  perDweller: z.record(z.string(), z.number()),
  /** roomType → mergeLevel → level → capacity contribution. */
  rooms: z.record(z.string(), z.record(z.string(), z.record(z.string(), roomLevelCapacitySchema))),
});

// Per-room-type metadata catalog. Drives the
// Rooms Map Build palette + the layout validator + the room edit ops. `width` = base footprint in col-units (3 per normal room; 1 for elevators;
// 6/9 for inherently-wide rooms); a non-elevator room occupies `3 × mergeLevel` col-units.
// `primaryStat` = the SPECIAL the room uses (drives location loadouts).
const roomMetadataEntrySchema = z.object({
  /** Localized in-game room name. */
  name: z.string(),
  /** ERoomClass name (== save `room.class`). */
  class: z.string(),
  /** ESpecialStat name the room trains/uses ("None" for facilities). */
  primaryStat: z.string(),
  /** Base footprint width in col-units (3 = one room, 1 = elevator). */
  width: z.number(),
  height: z.number(),
  maxMergeLevel: z.number(),
  maxLevel: z.number(),
  /** Build cost keyed by save resource key (Nuka/…); only nonzero entries. */
  buildCost: z.record(z.string(), z.number()),
  /** Instant-build (speed-up) cost; only nonzero entries. */
  instantBuildCost: z.record(z.string(), z.number()),
  /** Per-existing-room cost escalation factor (m_additionalPriceFactor). */
  priceFactor: z.number(),
  buildLocId: z.string(),
});

export const roomMetadataSchema = z.object({
  /** roomType (== save `room.type`) → metadata. */
  rooms: z.record(z.string(), roomMetadataEntrySchema),
});

// Per-room production/consumption catalog + global economy constants
//. Drives the Advisor resource-economy
// computation. `produced`/`reserve`/`consumption` are the
// raw RoomLevel GameResources at each (mergeLevel, level); the app applies staffing
// efficiency + happiness + the `globals` constants to derive per-minute flow rates.
const roomLevelProductionSchema = z.object({
  /** Resources this room produces per cycle at efficiency 1, keyed by save resource key. */
  produced: z.record(z.string(), z.number()),
  /** Storage reserve the room fills before idling (per resource). */
  reserve: z.record(z.string(), z.number()),
  /** Resources this room consumes while powered (Energy for most rooms). */
  consumption: z.record(z.string(), z.number()),
});

export const roomProductionSchema = z.object({
  /** Global economy constants reverse-engineered from the production/consumption code. */
  globals: z.object({
    /** Production task period (s); perSec = produced × eff / 60 / taskCycle. */
    taskCycle: z.number(),
    noRushResourcesMultiplier: z.number(),
    /** Food consumed per alive dweller per `dwellerConsumptionPeriod` seconds. */
    foodConsumptionPerDweller: z.number(),
    /** Water consumed per alive dweller per `dwellerConsumptionPeriod` seconds. */
    waterConsumptionPerDweller: z.number(),
    dwellerConsumptionPeriod: z.number(),
    /** Energy drained = Σ powered rooms' consumption per this period (s). */
    energyConsumptionPeriod: z.number(),
    /** Happiness→production bonus factor by tier (Room.GetWorkingEfficiency). */
    happinessFactorList: z.array(z.number()),
  }),
  /** roomType → mergeLevel → level → production/consumption values. */
  rooms: z.record(
    z.string(),
    z.record(z.string(), z.record(z.string(), roomLevelProductionSchema)),
  ),
});

// Unique/special-character catalog. Maps a
// dweller's `uniqueData` string (e.g. "L_Max") → its full UniqueDwellerData shape.
// Two consumers: the family viewer resolves/labels `ascendants` that
// are unique dwellers (their AscendancyID is a per-character negative id the save
// doesn't store inline); the "add special dweller" op replicates
// Dweller.SetUniqueCustomization from the customization fields below.
const uniqueDwellerSchema = z.object({
  /** m_serializedUniqueAscendancyId (negative); -1 = no special ascendancy. */
  ascendancyId: z.number(),
  name: z.string(),
  lastName: z.string(),
  /** Save gender: 1 = female, 2 = male (already inverted from EGender at build time). */
  gender: z.number(),
  /** Hair piece m_Name (== save `hair`), or null for none / random-body characters. */
  hair: z.string().nullable(),
  /** Face-mask piece m_Name (== save `faceMask`), or null for none. */
  faceMask: z.string().nullable(),
  /** Outfit game id (== save equipedOutfit.id); always present. */
  outfitId: z.string(),
  /** Weapon game id (== save equipedWeapon.id); '' → caller uses the vault default. */
  weaponId: z.string(),
  /** uint32 ARGB (0xAARRGGBB) skin/hair colors. */
  skinColor: z.number(),
  hairColor: z.number(),
  /** [S,P,E,C,I,A,L] base values (1..10). */
  stats: z.array(z.number()),
  isInfertile: z.boolean(),
  /** Game randomizes appearance at spawn → add-op uses neutral appearance defaults. */
  randomBody: z.boolean(),
  randomName: z.boolean(),
});

export const uniqueDwellersSchema = z.record(z.string(), uniqueDwellerSchema);

// Season Pass reward catalog (season-pass.json). The
// per-season free/premium reward layout with per-SAVE claim state stripped (built by
// scripts/build-gamedata/build-season-pass.mjs). Drives the Season tab's "Continue
// without a file" path: a fresh editable spd.dat working model is constructed purely
// from this catalog. Reward ids/codes are emitted verbatim - never regenerated.
const catalogRewardSchema = z.object({
  /** Unique reward id (int) - DO NOT regenerate. */
  id: z.number(),
  isPrestige: z.boolean(),
  /** lunchbox|caps|stimpack|outfit|weapon|pet|dweller|theme (or inert "[Type]"). */
  rewardType: z.string(),
  /** Quantity (caps/stimpack/lunchbox) or sub-type index. */
  dataValInt: z.number(),
  /** Concrete item code / sub-type (e.g. "LaserMusket", "regular"). */
  dataValString: z.string(),
  /** UI sprite hint. */
  icon: z.string(),
  /** Level gate for this reward. */
  levelRequired: z.number(),
});

const seasonCatalogEntrySchema = z.object({
  /** Season key (== spd.dat currentSeason / seasonsData key). */
  id: z.string(),
  /** Highest level gate across both tracks (the season's rank cap; 25 in shipped seasons). */
  maxRank: z.number(),
  /** Per-level token costs, indexed by CURRENT level (SeasonPassDataManager): the cost of
   *  level 1→2 is `tokenRequirements[1]`, and so on. [0,3,5,6,6,10,…] in every shipped
   *  season. Empty when unavailable (older catalog builds). */
  tokenRequirements: z.array(z.number()).default([]),
  /** Tokens granted by the in-game base (Premium) pass purchase (0 in every shipped season). */
  basePassTokens: z.number().default(0),
  /** Tokens granted by the in-game Premium Plus purchase (25 in every shipped season -
   *  levels a fresh pass straight to rank 5 against `tokenRequirements`). */
  premiumPassTokens: z.number().default(0),
  /** Scheduled season end date ("YYYY-MM-DD", from SeasonPassDataManager.prefab); the game
   *  compares it against local time + the spd.dat debugTimeOffset. Absent when unknown. */
  endDate: z.string().optional(),
  freeRewards: z.array(catalogRewardSchema),
  premiumRewards: z.array(catalogRewardSchema),
});

export const seasonPassCatalogSchema = z.object({
  /** Inert reward placeholder shared by every season's `ncqReward` (null if absent). */
  ncqReward: catalogRewardSchema.nullable(),
  seasons: z.array(seasonCatalogEntrySchema),
});

export const metaSchema = z.object({
  gameVersion: z.string(),
  unityVersion: z.string(),
  generatedAt: z.string(),
  counts: z.record(z.string(), z.number()),
});

export type Rarity = z.infer<typeof raritySchema>;
export type Special = z.infer<typeof specialSchema>;
export type Weapon = z.infer<typeof weaponSchema>;
export type Outfit = z.infer<typeof outfitSchema>;
export type Junk = z.infer<typeof junkSchema>;
export type Pet = z.infer<typeof petSchema>;
export type Handy = z.infer<typeof handySchema>;
export type Hair = z.infer<typeof hairSchema>;
export type GameEnums = z.infer<typeof enumsSchema>;
export type GameDataMeta = z.infer<typeof metaSchema>;
export type Unlockables = z.infer<typeof unlockablesSchema>;
export type RoomCapacity = z.infer<typeof roomCapacitySchema>;
export type RoomLevelCapacity = z.infer<typeof roomLevelCapacitySchema>;
export type RoomMetadata = z.infer<typeof roomMetadataSchema>;
export type RoomMetadataEntry = z.infer<typeof roomMetadataEntrySchema>;
export type RoomProduction = z.infer<typeof roomProductionSchema>;
export type RoomLevelProduction = z.infer<typeof roomLevelProductionSchema>;
export type UniqueDwellers = z.infer<typeof uniqueDwellersSchema>;
export type UniqueDweller = z.infer<typeof uniqueDwellerSchema>;
export type CatalogReward = z.infer<typeof catalogRewardSchema>;
export type SeasonCatalogEntry = z.infer<typeof seasonCatalogEntrySchema>;
export type SeasonPassCatalog = z.infer<typeof seasonPassCatalogSchema>;
