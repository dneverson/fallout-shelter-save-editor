import {
  MR_HANDY_CHARACTER_TYPE,
  VAULT_HELPER_CHARACTER_TYPES,
  type Actor,
  type Room,
  type SaveData,
} from '../model/saveSchema.ts';
import { adoptMrHandies, floorAdopterId } from './roomOps.ts';
import { displayFloor } from '../rooms/layout.ts';

// Mr. Handy robot instance ops + projection (the Mr. Handies tab and the Rooms side
// panel's assign flow). A Mr. Handy lives in `dwellers.actors[]` (characterType 2); the
// game only PLACES it on load from some room's `mrHandyList` entry, so "where it is" is
// derived from the referencing room. An unreferenced robot is a VALID state: it waits
// outside the vault (user-verified in-game - it sits at the door indefinitely until
// placed on a floor). Pure + structural-sharing, one applyEdit = one undo.

/** Default cosmetic skin id; season vaults introduce alternates the save stores verbatim. */
const DEFAULT_MR_HANDY_VARIANT = 'MrHandy';

/** Fallback full health when game data (roomCapacity.base.mrHandyHealth) is unavailable. */
export const DEFAULT_MR_HANDY_HEALTH = 500;

/** One owned Mr. Handy, flattened for the roster table. */
export interface MrHandyRow {
  serializeId: number;
  name: string;
  variant: string;
  health: number | null;
  dead: boolean;
  /** Floor row the robot is placed on (via the referencing room), or null = unassigned. */
  floor: number | null;
  /** Label of the room whose mrHandyList references it ("MedBay #1843"), or null. */
  roomLabel: string | null;
  roomId: number | null;
  /** Out collecting in the wasteland (`vault.wasteland.teams[].actors`); unplaced but
   *  NOT waiting at the door. */
  inWasteland: boolean;
}

function actorList(save: SaveData): Actor[] {
  const list = save.dwellers?.actors;
  return Array.isArray(list) ? list : [];
}

function roomList(save: SaveData): Room[] {
  const list = save.vault?.rooms;
  return Array.isArray(list) ? list : [];
}

const withActors = (save: SaveData, actors: Actor[]): SaveData => ({
  ...save,
  dwellers: { ...(save.dwellers ?? { dwellers: [] }), actors },
});

const withRooms = (save: SaveData, rooms: Room[]): SaveData => ({
  ...save,
  vault: { ...(save.vault ?? {}), rooms },
});

const isMrHandy = (a: Actor): boolean =>
  typeof a.characterType === 'number' &&
  VAULT_HELPER_CHARACTER_TYPES.has(a.characterType) &&
  typeof a.serializeId === 'number';

/** Every owned Mr. Handy with its derived placement. */
export function selectMrHandyRows(save: SaveData): MrHandyRow[] {
  const byActor = new Map<number, Room>();
  for (const r of roomList(save)) {
    for (const id of r.mrHandyList ?? []) {
      if (!byActor.has(id)) byActor.set(id, r);
    }
  }
  // A robot sent to collect in the wasteland gets its own team entry with its
  // serializeId in `actors` (dweller teams use `dwellers` instead).
  const inWasteland = new Set<number>();
  for (const team of save.vault?.wasteland?.teams ?? []) {
    for (const id of team.actors ?? []) inWasteland.add(id);
  }
  return actorList(save)
    .filter(isMrHandy)
    .map((a) => {
      const id = a.serializeId as number;
      const room = byActor.get(id) ?? null;
      return {
        serializeId: id,
        name: a.name ?? 'Mr. Handy',
        variant: a.MrHandyVariantID ?? DEFAULT_MR_HANDY_VARIANT,
        health: typeof a.health === 'number' ? a.health : null,
        dead: a.death === true,
        floor: typeof room?.row === 'number' ? room.row : null,
        roomLabel: room ? `${room.type} #${room.deserializeID}` : null,
        roomId: room?.deserializeID ?? null,
        inWasteland: inWasteland.has(id),
      };
    });
}

/** A floor a Mr. Handy can be assigned to (users pick FLOORS, never specific rooms). */
export interface HandyFloorOption {
  /** 0-based grid row (what the save stores). */
  row: number;
  /** 1-based label ("Floor 3") - what users see. */
  label: string;
  /** serializeId of the robot already on this floor, if any (one per floor, game rule). */
  takenBy?: number;
}

/**
 * Every floor a robot could be assigned to: rows holding at least one adoptable room,
 * with the floor's current robot (if any) so pickers can disable taken floors. Sorted
 * top-down. Shared by the Owned sheet, the Catalog assign dialog, and the Rooms rail.
 */
export function handyFloorOptions(save: SaveData): HandyFloorOption[] {
  const taken = new Map<number, number>();
  for (const r of selectMrHandyRows(save)) {
    if (r.floor !== null) taken.set(r.floor, r.serializeId);
  }
  const rows = [
    ...new Set(
      roomList(save)
        .map((r) => r.row)
        .filter((row): row is number => typeof row === 'number'),
    ),
  ].filter((row) => floorAdopterId(save, row) !== null);
  return rows
    .sort((a, b) => a - b)
    .map((row) => {
      const takenBy = taken.get(row);
      return {
        row,
        label: `Floor ${displayFloor(row)}`,
        ...(takenBy !== undefined ? { takenBy } : {}),
      };
    });
}

/** Empty per-resource ledger the game writes on a fresh robot's equipment storage. */
const EMPTY_RESOURCES: Record<string, number> = {
  Nuka: 0,
  Food: 0,
  Energy: 0,
  Water: 0,
  StimPack: 0,
  RadAway: 0,
  Lunchbox: 0,
  MrHandy: 0,
  PetCarrier: 0,
  CraftedOutfit: 0,
  CraftedWeapon: 0,
  NukaColaQuantum: 0,
  CraftedTheme: 0,
  DummyUltracite: 0,
  PokerChip: 0,
};

/** Next free character id: past every dweller id, actor id, AND the running counter. */
function nextActorId(save: SaveData): number {
  const dwellerMax = (save.dwellers?.dwellers ?? []).reduce(
    (m, d) => Math.max(m, d.serializeId ?? 0),
    0,
  );
  const actorMax = actorList(save).reduce((m, a) => Math.max(m, a.serializeId ?? 0), 0);
  const counter = typeof save.dwellers?.id === 'number' ? save.dwellers.id : 0;
  return Math.max(dwellerMax, actorMax, counter) + 1;
}

export interface NewMrHandy {
  name?: string;
  /** `MrHandyVariantID` skin/character id (handies.json `variantId`). */
  variant?: string;
  /** Save `characterType` for the variant (2 MrHandy/SnipSnip, 5 Victor, 6 Curie). */
  characterType?: number;
  /** Save `actorDataId` for the variant (null for the plain Mr. Handy). */
  actorDataId?: string | null;
  /** Room to attach the new robot to (its floor is where it appears); null = unassigned. */
  roomId?: number | null;
  /** Full health to spawn with (roomCapacity.base.mrHandyHealth). */
  health?: number;
}

/**
 * Mint a fresh Mr. Handy actor (field shape verified against a real game save) and
 * optionally attach it to a room so the game places it on that room's floor. Bumps the
 * `dwellers.id` counter so future dwellers/actors don't collide with the new id.
 */
export function createMrHandy(save: SaveData, spec: NewMrHandy = {}): SaveData {
  const id = nextActorId(save);
  const roomId = spec.roomId ?? null;
  const actor: Actor = {
    characterType: spec.characterType ?? MR_HANDY_CHARACTER_TYPE,
    actorDataId: spec.actorDataId ?? null,
    serializeId: id,
    name: spec.name?.trim() || 'Mr. Handy',
    canCollect: true,
    willGoToWasteland: false,
    equipment: {
      storage: { resources: { ...EMPTY_RESOURCES }, bonus: { ...EMPTY_RESOURCES } },
      inventory: { items: [] },
      dwellers: [],
      mrHandyList: [],
      questClues: [],
      collectedThemes: { themeList: [] },
    },
    health: spec.health ?? DEFAULT_MR_HANDY_HEALTH,
    death: false,
    savedRoom: roomId ?? -1,
    MrHandyVariantID: spec.variant?.trim() || DEFAULT_MR_HANDY_VARIANT,
  } as Actor;

  let next = withActors(save, [...actorList(save), actor]);
  next = {
    ...next,
    dwellers: { ...(next.dwellers ?? { dwellers: [] }), id },
  };
  if (roomId !== null) next = assignMrHandyToRoom(next, id, roomId);
  return next;
}

/**
 * Attach a Mr. Handy to `roomId`: strip its id from every room's `mrHandyList`, append it
 * to the target's, and point the actor's `savedRoom` there. The game's one-robot-per-FLOOR
 * rule is enforced by the caller (the UI disables floors that already have one).
 */
export function assignMrHandyToRoom(save: SaveData, actorId: number, roomId: number): SaveData {
  const rooms = roomList(save);
  const target = rooms.find((r) => r.deserializeID === roomId);
  if (!target) return save;
  const nextRooms = rooms.map((r) => {
    let room = r;
    if (room.deserializeID !== roomId && (room.mrHandyList ?? []).includes(actorId)) {
      room = { ...room, mrHandyList: (room.mrHandyList ?? []).filter((id) => id !== actorId) };
    }
    if (room.deserializeID === roomId) room = adoptMrHandies(room, [actorId]);
    return room;
  });
  let next = withRooms(save, nextRooms);
  next = updateActor(next, actorId, (a) =>
    a.savedRoom === roomId ? a : { ...a, savedRoom: roomId },
  );
  return next;
}

/**
 * Detach a Mr. Handy from every room ("send outside the vault"). In-game the robot then
 * waits at the vault door indefinitely until placed on a floor - a normal state.
 */
export function unassignMrHandy(save: SaveData, actorId: number): SaveData {
  const rooms = roomList(save);
  let changed = false;
  const nextRooms = rooms.map((r) => {
    if (!(r.mrHandyList ?? []).includes(actorId)) return r;
    changed = true;
    return { ...r, mrHandyList: (r.mrHandyList ?? []).filter((id) => id !== actorId) };
  });
  let next = changed ? withRooms(save, nextRooms) : save;
  next = updateActor(next, actorId, (a) => (a.savedRoom === -1 ? a : { ...a, savedRoom: -1 }));
  return next;
}

/** Delete the robot outright: remove the actor and every room reference. */
export function deleteMrHandy(save: SaveData, actorId: number): SaveData {
  const actors = actorList(save);
  const remaining = actors.filter((a) => !(isMrHandy(a) && a.serializeId === actorId));
  if (remaining.length === actors.length) return save;
  const stripped = unassignMrHandy(save, actorId);
  return withActors(stripped, remaining);
}

/** Delete several robots in one undoable step (the roster's multi-select delete). */
export function deleteMrHandies(save: SaveData, actorIds: number[]): SaveData {
  return actorIds.reduce((acc, id) => deleteMrHandy(acc, id), save);
}

function updateActor(save: SaveData, actorId: number, fn: (a: Actor) => Actor): SaveData {
  const actors = actorList(save);
  let changed = false;
  const next = actors.map((a) => {
    if (!isMrHandy(a) || a.serializeId !== actorId) return a;
    const updated = fn(a);
    if (updated !== a) changed = true;
    return updated;
  });
  return changed ? withActors(save, next) : save;
}

/**
 * Edit a robot's fields. A variant change must carry the variant's full save encoding
 * (characterType + actorDataId, from handies.json) so the game deserializes the right
 * prefab - `MrHandyVariantID` alone does not switch Victor/Curie.
 */
export function editMrHandy(
  save: SaveData,
  actorId: number,
  changes: {
    name?: string;
    variant?: string;
    characterType?: number;
    actorDataId?: string | null;
  },
): SaveData {
  return updateActor(save, actorId, (a) => {
    const next = { ...a };
    if (changes.name !== undefined) next.name = changes.name;
    if (changes.variant !== undefined) next.MrHandyVariantID = changes.variant;
    if (changes.characterType !== undefined) next.characterType = changes.characterType;
    if (changes.actorDataId !== undefined) next.actorDataId = changes.actorDataId;
    return next;
  });
}

/** Restore one robot to full health and clear its death flag. */
export function healMrHandy(save: SaveData, actorId: number, fullHealth: number): SaveData {
  return updateActor(save, actorId, (a) =>
    a.health === fullHealth && a.death !== true ? a : { ...a, health: fullHealth, death: false },
  );
}

/** Set a robot's health directly; any positive value also revives it. */
export function setMrHandyHealth(save: SaveData, actorId: number, health: number): SaveData {
  const hp = Math.max(0, health);
  return updateActor(save, actorId, (a) => {
    const death = hp <= 0 ? true : false;
    if (a.health === hp && (a.death === true) === death) return a;
    return { ...a, health: hp, death };
  });
}
