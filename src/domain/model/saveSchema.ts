import { z } from 'zod';
import { LosslessInt } from '../codec/losslessJson.ts';

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
  // Mid-eviction marker; such dwellers don't count against the population cap
  // (DwellerManager.GetDwellersNonEvictedCount skips them).
  IsEvictedWaitingForFollowers: z.boolean().optional(),
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

// The per-state sub-dict where a room's work-cycle task id lives (WorkBaseRoomWorking:
// production/crafting/radio all serialize `taskId` here). `remainingTime`/`estimatedTime`
// are the RADIO room's display pair (RadioStationRoom.Serialize) - crafting progress is
// the room-level `CompletedTime` instead. Unknown per-state keys ride through.
const roomStateSchema = z.looseObject({
  taskId: z.number().optional(),
  remainingTime: z.number().optional(),
  estimatedTime: z.number().optional(),
  breedingTaskId: z.number().optional(),
});

// A LivingQuarters relationship (DwellerPartnership): `m`/`f` = partner serializeIds,
// `s` = status (EDwellerDwellerPartnershipType, e.g. "RaisingBaby"), `t` = the single
// status-scoped task id (RaisingBaby -> the pregnancy/birth task). Names, child template
// and the rest ride through.
const partnerSchema = z.looseObject({
  m: z.number().optional(),
  f: z.number().optional(),
  s: z.string().optional(),
  t: z.number().optional(),
  // Father serializeId for the family tree; the game resets it to -1 when that dweller
  // is removed (DwellerPartnership.OnDwellerRemoved) - names ride through separately.
  fatherId: z.number().optional(),
  // Child template: during multi-births the FIRST-BORN's serializeId, copied by the
  // siblings. CreateChild dereferences it WITHOUT a null check, so a dangling id here
  // crashes the game at the next birth; -1 = "no template, roll a random child".
  templateID: z.number().optional(),
  // Babies delivered when the due timer fires (OnBabyBirthEvent): 0 = roll at birth
  // (breeding-pet ChildMultiplier decides twins/triplets, else 1); a stored nonzero
  // value SKIPS the roll and births exactly that many in a loop. 3 is the natural
  // maximum, so ops cap writes there.
  pendingChildren: z.number().optional(),
});

// A LivingQuarters child (DwellerChild): `taskID` is the one-shot grow-up task. The game
// DISCARDS children whose task is missing on load, so ops must never delete these entries
// or null the id - only the referenced task's endTime may change.
const childSchema = z.looseObject({
  taskID: z.number().optional(),
  dwellerID: z.number().optional(),
  notificationID: z.number().optional(),
});

// A training-room slot (TrainingSlot): `taskID` is the recurrent stat-training task
// (idle sentinels -2 / -32768).
const trainingSlotSchema = z.looseObject({
  dwellerID: z.number().optional(),
  taskID: z.number().optional(),
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
  currentState: roomStateSchema.optional(),
  dwellers: z.array(z.number()).optional(),
  // Dwellers that died while assigned here (Room.Serialize "deadDwellers"); resolved with
  // the same null-tolerant GetDwellerById lookup as the work roster on load.
  deadDwellers: z.array(z.number()).optional(),
  // Mr. Handy actor serializeIds attached to this room. On load the game only places a
  // Mr. Handy if SOME room's mrHandyList references it (Room.DeserializeDwellers), so
  // structural ops must never drop these ids or the robot disappears in-game.
  mrHandyList: z.array(z.number()).optional(),
  // --- Timer surface (timerOps) ---
  // Production rooms serialize their per-room output buffer here (ProductionRoom.Serialize).
  // A staffed production room with output but NO cycle task is full and waiting to be
  // collected in game - that's why not every reactor carries a timer.
  storage: z.looseObject({ resources: z.record(z.string(), z.number()).optional() }).optional(),
  // Crafting rooms: elapsed crafting seconds (game clamps to the recipe's required time
  // on load, so a huge value means "done") + the recipe being crafted.
  CompletedTime: z.number().optional(),
  CraftingItemId: z.string().optional(),
  // Rush-cost decay task id (Room.Serialize `rushTask`; -1 when none).
  rushTask: z.number().optional(),
  partners: z.array(partnerSchema).optional(),
  children: z.array(childSchema).optional(),
  slots: z.array(trainingSlotSchema).optional(),
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

// A wasteland exploration team (WastelandTeam). Travel is NOT task-based: the game
// diffs raw second counters against the task clock. `elapsedTimeAliveExploring` runs
// while exploring / travelling to a quest (arrival at CachedQuest.TimeToReachInSecond);
// `elapsedReturningTime` runs on the way home and completes at `returnTripDuration`.
// Members are split by kind: `dwellers` holds dweller serializeIds; `actors` holds
// robot serializeIds (a Mr. Handy sent to collect gets its own one-robot team).
const wastelandTeamSchema = z.looseObject({
  dwellers: z.array(z.number()).optional(),
  actors: z.array(z.number()).optional(),
  status: z.string().optional(),
  elapsedTimeAliveExploring: z.number().optional(),
  elapsedReturningTime: z.number().optional(),
  returnTripDuration: z.number().optional(),
  isDoingQuest: z.boolean().optional(),
  questName: z.string().optional(),
});

const wastelandSchema = z.looseObject({
  teams: z.array(wastelandTeamSchema).optional(),
});

const vaultSchema = z.looseObject({
  rooms: z.array(roomSchema).optional(),
  inventory: inventorySchema.optional(),
  storage: storageSchema.optional(),
  wasteland: wastelandSchema.optional(),
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

// One character waiting at the vault door (uninvited). The id key differs by kind:
// a human (radio arrival) is `charType: "Dweller"` + `dwellerId`; a robot is
// `charType: "MrHandy"` + `serializeId`. Both reference an existing entry in
// `dwellers.dwellers[]` / `dwellers.actors[]` (verified against a real save).
const waitingCharacterSchema = z.looseObject({
  charType: z.string().optional(),
  dwellerId: z.number().optional(),
  serializeId: z.number().optional(),
});

const dwellerSpawnerSchema = z.looseObject({
  dwellersWaiting: z.array(waitingCharacterSchema).optional(),
});

// In-game store state. `isStarterPackPurchased` is the only field we edit: setting it true
// HIDES the real-money Starter Pack offer in the shop (it does NOT grant the pack's contents).
// `hasStarterPackPopupShown` and any other keys ride through untouched.
const shopWindowSchema = z.looseObject({
  isStarterPackPurchased: z.boolean().optional(),
  hasStarterPackPopupShown: z.boolean().optional(),
});

// --- Time & task managers (timerOps edit surface) --------------------------------
// `timeMgr.timeSaveDate`/`timeGameBegin` are .NET DateTime ticks (~6.4e17) - ABOVE
// Number.MAX_SAFE_INTEGER, so they arrive from the codec boxed as LosslessInt. All
// tick arithmetic goes through taskLookup's BigInt helpers; never Number() these.
const int64Schema = z.union([z.number(), z.instanceof(LosslessInt)]);

const timeMgrSchema = z.looseObject({
  time: z.number().optional(), // elapsed vault seconds (the master task clock)
  gameTime: z.number().optional(),
  questTime: z.number().optional(),
  timeSaveDate: int64Schema.optional(),
  timeGameBegin: int64Schema.optional(),
});

// One scheduled timer (Task.Serialize). Times are elapsed vault seconds measured
// against `taskMgr.time`; a task whose endTime has passed fires during on-load catch-up.
const taskEntrySchema = z.looseObject({
  startTime: z.number().optional(),
  endTime: z.number().optional(),
  id: z.number().optional(),
  paused: z.boolean().optional(),
  rescheduleToOldest: z.boolean().optional(),
});

const taskMgrSchema = z.looseObject({
  id: z.number().optional(), // last-used task id (NewTask pre-increments)
  time: z.number().optional(), // mirrors timeMgr.time
  tasks: z.array(taskEntrySchema).optional(),
  pausedTasks: z.array(taskEntrySchema).optional(),
});

// DeathclawIncidentsMgr. `canDeathclawEmergencyOccurs` is a cooldown LATCH, not an off
// switch: when false the game loads `deathclawCooldownID` and, if that task is missing,
// RE-CREATES a ~30 min cooldown that re-enables attacks. A durable "off" therefore
// needs the flag false PLUS a far-future blocker task injected into taskMgr (timerOps).
const deathclawManagerSchema = z.looseObject({
  deathclawTotalExtraChance: z.number().optional(),
  canDeathclawEmergencyOccurs: z.boolean().optional(),
  deathclawCooldownID: z.number().optional(),
});

// BottleAndCappyMgr. `SerializeLocked: true` with NO `SerializeUnlockTask` key means the
// appearance cycle never starts on load - a clean, fully reversible "off".
const bottleAndCappySchema = z.looseObject({
  SerializeAccumulatedTriggerChance: z.number().optional(),
  SerializeLocked: z.boolean().optional(),
  SerializeUnlockTask: z.number().optional(),
});

// Daily login rewards (DayToDayRewardManager). `next` is a wall-clock Unix-milliseconds
// timestamp; any past value makes the reward claimable.
const dayToDayRewardSchema = z.looseObject({
  states: z
    .array(z.looseObject({ type: z.number().optional(), next: int64Schema.optional() }))
    .optional(),
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
  timeMgr: timeMgrSchema.optional(),
  taskMgr: taskMgrSchema.optional(),
  DeathclawManager: deathclawManagerSchema.optional(),
  BottleAndCappyMgrSerializeKey: bottleAndCappySchema.optional(),
  dayToDayRewardMgr: dayToDayRewardSchema.optional(),
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

/** One scheduled timer inside `taskMgr.tasks[]` / `taskMgr.pausedTasks[]`. */
export type TaskEntry = z.infer<typeof taskEntrySchema>;

/** A LivingQuarters relationship entry (`room.partners[]`). */
export type Partner = z.infer<typeof partnerSchema>;

/** A LivingQuarters child entry (`room.children[]`). */
export type Child = z.infer<typeof childSchema>;

/** A wasteland exploration team (`vault.wasteland.teams[]`). */
export type WastelandTeam = z.infer<typeof wastelandTeamSchema>;

/** The decoded save JSON. Edit-surface typing is layered on phase by phase. */
export type SaveData = z.infer<typeof saveSchema>;
