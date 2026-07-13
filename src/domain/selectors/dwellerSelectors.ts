import type { Dweller, Room, SaveData, WastelandTeam } from '../model/saveSchema.ts';
import type { GameData } from '../gamedata/gameData.ts';
import type { Special } from '../gamedata/schemas.ts';

// Row-projection selectors. Pure functions that flatten a
// Dweller into the table-ready `DwellerRow` the roster renders and sorts.
// Game-data is optional: when supplied, weapon/outfit cells are enriched with real
// name + stats; otherwise they fall back to the raw save id. Room location is
// resolved by joining `dweller.savedRoom` to the room's `deserializeID`.
//
// These are pure derivations - memoization happens at the component layer in (d).

/** Current SPECIAL values, S..L, read from `stats.stats[1..7].value` (0 if absent). */
export interface SpecialValues {
  S: number;
  P: number;
  E: number;
  C: number;
  I: number;
  A: number;
  L: number;
}

export interface DwellerWeaponRef {
  id: string;
  name: string;
  damageMin: number | null;
  damageMax: number | null;
}

export interface DwellerOutfitRef {
  id: string;
  name: string;
  /** SPECIAL bonus granted by the outfit (from game data), or null if unknown. */
  special: Special | null;
}

export type PetRarity = 'common' | 'rare' | 'legendary';

export interface DwellerPetRef {
  id: string;
  breed: string;
  rarity: PetRarity | null;
  uniqueName: string | null;
  bonus: string | null;
  bonusValue: number | null;
}

export interface DwellerLocation {
  /** Room `deserializeID`, or -1 for "not assigned to any room". Stale for explorers:
   *  the game keeps the pre-departure room id while a dweller is in the wasteland. */
  savedRoom: number;
  roomType: string | null;
  row: number | null;
  col: number | null;
  /** Human-facing label: a wasteland state ("Exploring" / "Returning" / "On Quest"),
   *  "At Door" (uninvited, referenced by `dwellerSpawner.dwellersWaiting`),
   *  "Coffee Break" (in the vault, no job), the room type, or "Room <id>" if unresolved. */
  label: string;
}

export interface DwellerRow {
  serializeId: number;
  name: string;
  lastName: string;
  gender: number | null;
  level: number | null;
  rarity: string | null;
  special: SpecialValues;
  happiness: number | null;
  health: number | null;
  maxHealth: number | null;
  radiation: number | null;
  isDead: boolean;
  pregnant: boolean;
  babyReady: boolean;
  weapon: DwellerWeaponRef | null;
  outfit: DwellerOutfitRef | null;
  pet: DwellerPetRef | null;
  location: DwellerLocation;
}

export interface ProjectionContext {
  gameData?: GameData;
  /** Room index keyed by `deserializeID` (built by `buildRoomIndex`). */
  roomById?: ReadonlyMap<number, Room>;
  /** Dweller serializeId → wasteland label (built by `buildWastelandIndex`). Membership
   *  overrides `savedRoom`, which stays stale while a dweller is out exploring. */
  wastelandById?: ReadonlyMap<number, string>;
  /** Ids of dwellers waiting at the door (built by `buildWaitingDwellerIds`). */
  waitingIds?: ReadonlySet<number>;
}

const SPECIAL_KEYS = ['S', 'P', 'E', 'C', 'I', 'A', 'L'] as const;

const dwellersOf = (save: SaveData): Dweller[] =>
  Array.isArray(save.dwellers?.dwellers) ? save.dwellers.dwellers : [];

/** SPECIAL as named values; index 0 in `stats.stats` is a placeholder, 1..7 = S..L. */
export function readSpecial(dweller: Dweller): SpecialValues {
  const stats = dweller.stats?.stats ?? [];
  const out = {} as SpecialValues;
  SPECIAL_KEYS.forEach((key, i) => {
    out[key] = stats[i + 1]?.value ?? 0;
  });
  return out;
}

const PET_RARITY_BY_SUFFIX: Record<string, PetRarity> = { c: 'common', r: 'rare', l: 'legendary' };

function projectWeapon(dweller: Dweller, gameData?: GameData): DwellerWeaponRef | null {
  const id = dweller.equipedWeapon?.id;
  if (!id) return null;
  const data = gameData?.weaponById.get(id);
  return {
    id,
    name: data?.name ?? id,
    damageMin: data?.damageMin ?? null,
    damageMax: data?.damageMax ?? null,
  };
}

function projectOutfit(dweller: Dweller, gameData?: GameData): DwellerOutfitRef | null {
  const id = dweller.equipedOutfit?.id;
  if (!id) return null;
  const data = gameData?.outfitById.get(id);
  return { id, name: data?.name ?? id, special: data?.special ?? null };
}

function projectPet(dweller: Dweller): DwellerPetRef | null {
  const pet = dweller.equippedPet;
  if (!pet?.id) return null;
  const suffix = /_(c|r|l)$/.exec(pet.id);
  const extra = (pet as { extraData?: Record<string, unknown> }).extraData;
  return {
    id: pet.id,
    breed: suffix ? pet.id.slice(0, suffix.index) : pet.id,
    rarity: suffix ? PET_RARITY_BY_SUFFIX[suffix[1]] : null,
    uniqueName: typeof extra?.uniqueName === 'string' ? extra.uniqueName : null,
    bonus: typeof extra?.bonus === 'string' ? extra.bonus : null,
    bonusValue: typeof extra?.bonusValue === 'number' ? extra.bonusValue : null,
  };
}

function resolveLocation(dweller: Dweller, ctx: ProjectionContext): DwellerLocation {
  const savedRoom = dweller.savedRoom ?? -1;
  const wasteland = ctx.wastelandById?.get(dweller.serializeId);
  if (wasteland !== undefined) {
    return { savedRoom, roomType: null, row: null, col: null, label: wasteland };
  }
  if (savedRoom === -1) {
    const label = ctx.waitingIds?.has(dweller.serializeId) ? 'At Door' : 'Coffee Break';
    return { savedRoom: -1, roomType: null, row: null, col: null, label };
  }
  const room = ctx.roomById?.get(savedRoom);
  if (!room) {
    return { savedRoom, roomType: null, row: null, col: null, label: `Room ${savedRoom}` };
  }
  return {
    savedRoom,
    roomType: room.type,
    row: room.row ?? null,
    col: room.col ?? null,
    label: room.type,
  };
}

/** Index a save's rooms by `deserializeID` for O(1) location lookup. */
export function buildRoomIndex(save: SaveData): Map<number, Room> {
  const index = new Map<number, Room>();
  for (const room of save.vault?.rooms ?? []) index.set(room.deserializeID, room);
  return index;
}

// Known `team.status` values: 'Exploring', 'GoingToQuest'; the returning leg is
// detected by its elapsed counter so an unrecognized status string still labels sanely.
function wastelandTeamLabel(team: WastelandTeam): string {
  if (team.isDoingQuest === true || team.status === 'GoingToQuest') return 'On Quest';
  if ((team.elapsedReturningTime ?? 0) > 0 || team.status?.startsWith('Returning')) {
    return 'Returning';
  }
  return 'Exploring';
}

/** Dweller serializeId → wasteland label, from `vault.wasteland.teams[].dwellers`. */
export function buildWastelandIndex(save: SaveData): Map<number, string> {
  const index = new Map<number, string>();
  for (const team of save.vault?.wasteland?.teams ?? []) {
    const label = wastelandTeamLabel(team);
    for (const id of team.dwellers ?? []) index.set(id, label);
  }
  return index;
}

/**
 * Ids of dwellers waiting at the vault door (`dwellerSpawner.dwellersWaiting`). Humans
 * key their id as `dwellerId`; `serializeId` entries are robots (`charType: "MrHandy"`)
 * whose ids share the dweller id space, so only `dwellerId` may be read here.
 */
export function buildWaitingDwellerIds(save: SaveData): Set<number> {
  const ids = new Set<number>();
  for (const entry of save.dwellerSpawner?.dwellersWaiting ?? []) {
    if (typeof entry?.dwellerId === 'number') ids.add(entry.dwellerId);
  }
  return ids;
}

/** Project one dweller into a table row. Pass game data + a room index to enrich. */
export function projectDwellerRow(dweller: Dweller, ctx: ProjectionContext = {}): DwellerRow {
  const healthValue = dweller.health?.healthValue;
  return {
    serializeId: dweller.serializeId,
    name: dweller.name ?? '',
    lastName: dweller.lastName ?? '',
    gender: dweller.gender ?? null,
    level: dweller.experience?.currentLevel ?? null,
    rarity: dweller.rarity ?? null,
    special: readSpecial(dweller),
    happiness: dweller.happiness?.happinessValue ?? null,
    health: healthValue ?? null,
    maxHealth: dweller.health?.maxHealth ?? null,
    radiation: dweller.health?.radiationValue ?? null,
    isDead: typeof healthValue === 'number' && healthValue <= 0,
    pregnant: dweller.pregnant ?? false,
    babyReady: dweller.babyReady ?? false,
    weapon: projectWeapon(dweller, ctx.gameData),
    outfit: projectOutfit(dweller, ctx.gameData),
    pet: projectPet(dweller),
    location: resolveLocation(dweller, ctx),
  };
}

/** Project every dweller into table rows, resolving rooms from the save once. */
export function selectDwellerRows(save: SaveData, gameData?: GameData): DwellerRow[] {
  const ctx: ProjectionContext = {
    roomById: buildRoomIndex(save),
    wastelandById: buildWastelandIndex(save),
    waitingIds: buildWaitingDwellerIds(save),
  };
  if (gameData) ctx.gameData = gameData;
  return dwellersOf(save).map((d) => projectDwellerRow(d, ctx));
}

/** Find a dweller by `serializeId` (for the character-sheet detail panel). */
export function selectDwellerById(save: SaveData, serializeId: number): Dweller | undefined {
  return dwellersOf(save).find((d) => d.serializeId === serializeId);
}
