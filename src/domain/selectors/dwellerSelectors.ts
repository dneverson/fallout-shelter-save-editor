import type { Dweller, Room, SaveData } from '../model/saveSchema.ts';
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
  /** Room `deserializeID`, or -1 for "at the vault door". */
  savedRoom: number;
  roomType: string | null;
  row: number | null;
  col: number | null;
  /** Human-facing label: "At Door", the room type, or "Room <id>" if unresolved. */
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

function resolveLocation(dweller: Dweller, roomById?: ReadonlyMap<number, Room>): DwellerLocation {
  const savedRoom = dweller.savedRoom ?? -1;
  if (savedRoom === -1) {
    return { savedRoom: -1, roomType: null, row: null, col: null, label: 'At Door' };
  }
  const room = roomById?.get(savedRoom);
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
    location: resolveLocation(dweller, ctx.roomById),
  };
}

/** Project every dweller into table rows, resolving rooms from the save once. */
export function selectDwellerRows(save: SaveData, gameData?: GameData): DwellerRow[] {
  const roomById = buildRoomIndex(save);
  const ctx: ProjectionContext = { roomById };
  if (gameData) ctx.gameData = gameData;
  return dwellersOf(save).map((d) => projectDwellerRow(d, ctx));
}

/** Find a dweller by `serializeId` (for the character-sheet detail panel). */
export function selectDwellerById(save: SaveData, serializeId: number): Dweller | undefined {
  return dwellersOf(save).find((d) => d.serializeId === serializeId);
}
