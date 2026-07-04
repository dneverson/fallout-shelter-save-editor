import type { Dweller, Room, SaveData } from '../model/saveSchema.ts';
import { ELEVATOR_TYPE, ENTRANCE_TYPE, FAKE_WASTELAND_TYPE } from '../rooms/layout.ts';
import { themeRecipeIdFor } from '../rooms/themes.ts';

// Pure, immutable ROOM edit operations on
// `vault.rooms[]`. Like the other ops modules, every op is `(save, …args) => SaveData`
// with no mutation: it returns a new save sharing every untouched room/dweller and
// top-level key by reference (structural sharing), so the store records one edit as one
// cheap undo snapshot via a single applyEdit.
//
// VALUE-bounded ops (setRoomLevel) clamp to game-legal ranges. STRUCTURAL ops
// (addRoom/removeRoom/moveRoom/mergeRoomWith) change the layout and are the product's
// highest save-corruption risk - they are gated by the pure layout VALIDATOR
// (src/domain/rooms/validator.ts) at the UI call site (the Rooms-Map UI only enables an
// action when the validator approves), mirroring the "guard at the call site"
// convention. These ops keep room/dweller cross-references consistent: a dweller's
// `savedRoom` equals its room's `deserializeID` (verified in the real save), and a room's
// `dwellers[]` holds dweller `serializeId`s.

/** Thrown when an op targets a `deserializeID` that no room has. */
export class RoomNotFoundError extends Error {
  constructor(public readonly deserializeID: number) {
    super(`No room with deserializeID ${deserializeID}.`);
    this.name = 'RoomNotFoundError';
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function roomList(save: SaveData): Room[] {
  const list = save.vault?.rooms;
  return Array.isArray(list) ? list : [];
}

function dwellerList(save: SaveData): Dweller[] {
  const list = save.dwellers?.dwellers;
  return Array.isArray(list) ? list : [];
}

/** Return a new save whose `vault.rooms` is `rooms`, sharing other vault/top-level keys. */
function withRooms(save: SaveData, rooms: Room[]): SaveData {
  const vault = save.vault ?? {};
  return { ...save, vault: { ...vault, rooms } };
}

/** Return a new save whose `dwellers.dwellers` is `dwellers`, sharing other keys. */
function withDwellers(save: SaveData, dwellers: Dweller[]): SaveData {
  const block = save.dwellers ?? { dwellers: [] };
  return { ...save, dwellers: { ...block, dwellers } };
}

/**
 * Replace one room (located by `deserializeID`) with `updater(room)`, sharing every other
 * room and top-level key by reference. Throws if the id is absent.
 */
function updateRoom(
  save: SaveData,
  deserializeID: number,
  updater: (room: Room) => Room,
): SaveData {
  const list = roomList(save);
  const idx = list.findIndex((r) => r.deserializeID === deserializeID);
  if (idx === -1) throw new RoomNotFoundError(deserializeID);
  const next = list.slice();
  next[idx] = updater(list[idx]);
  return withRooms(save, next);
}

// --- Value-bounded ops --------------------------------------------------------

/**
 * Set a room's level, clamped to `[1, maxLevel]` (the type's max from room metadata;
 * default 3). No-op if unchanged.
 */
export function setRoomLevel(
  save: SaveData,
  deserializeID: number,
  level: number,
  maxLevel = 3,
): SaveData {
  const target = clamp(Math.trunc(level), 1, Math.max(1, maxLevel));
  const room = roomList(save).find((r) => r.deserializeID === deserializeID);
  if (room && room.level === target) return save;
  return updateRoom(save, deserializeID, (r) => ({ ...r, level: target }));
}

/** Raise a room to its maximum level. */
export const maxRoomLevel = (save: SaveData, deserializeID: number, maxLevel: number): SaveData =>
  setRoomLevel(save, deserializeID, maxLevel, maxLevel);

/**
 * Repair a room to full health: `roomHealth.damageValue = 0` (0 = undamaged, per the game's
 * RoomHealth.IsZeroDamaged) and clear the `broken` flag. No-op if already healthy + unbroken.
 */
export function repairRoom(save: SaveData, deserializeID: number): SaveData {
  const room = roomList(save).find((r) => r.deserializeID === deserializeID);
  if (room && room.broken !== true && (room.roomHealth?.damageValue ?? 0) === 0) return save;
  return updateRoom(save, deserializeID, (r) => ({
    ...r,
    broken: false,
    roomHealth: { ...(r.roomHealth ?? {}), damageValue: 0 },
  }));
}

/**
 * Repair EVERY damaged room to full health in one edit (the Rooms-screen "Repair all"
 * action): each room with `broken === true` or a positive `roomHealth.damageValue` gets
 * `damageValue = 0` + `broken = false`. Healthy/unbroken rooms (and elevators, which never
 * take damage) are shared by reference. No-op (returns the same save) when nothing is damaged.
 */
export function repairAllRooms(save: SaveData): SaveData {
  const list = roomList(save);
  let changed = false;
  const next = list.map((r) => {
    const damaged = r.broken === true || (r.roomHealth?.damageValue ?? 0) > 0;
    if (!damaged) return r;
    changed = true;
    return { ...r, broken: false, roomHealth: { ...(r.roomHealth ?? {}), damageValue: 0 } };
  });
  if (!changed) return save;
  return withRooms(save, next);
}

/** Toggle a room's power. */
export const setRoomPower = (save: SaveData, deserializeID: number, powered: boolean): SaveData =>
  updateRoom(save, deserializeID, (r) => ({ ...r, power: powered }));

/** Set a room's assigned decoration id ("" clears it). */
export const setRoomDecoration = (
  save: SaveData,
  deserializeID: number,
  decoration: string,
): SaveData => updateRoom(save, deserializeID, (r) => ({ ...r, assignedDecoration: decoration }));

/**
 * Set the visual THEME for a whole room TYPE. The game stores themes per room type in
 * `save.specialTheme.themeByRoomType` ({ ERoomType: ESpecialTheme }) - NOT per room
 * instance - so this themes every room of `roomType`, mirroring the in-game theme picker.
 * `theme` is an ESpecialTheme enum name ("Institute", …) or "None". The caller guards
 * validity (isThemeValidFor) at the call site.
 *
 * For a unified experience it also adds the theme's RECIPE id to `survivalW.recipes` (so
 * the in-game Theme Workshop recognises an editor-applied theme), in the SAME edit so it's
 * one undo step. Recipes are never removed - clearing a theme (None) leaves the recipe
 * known, mirroring the game (a learnt recipe is permanent). No-op (same ref) when the
 * theme is unchanged AND its recipe is already present.
 */
export function setRoomTheme(save: SaveData, roomType: string, theme: string): SaveData {
  const special = save.specialTheme ?? {};
  const byType = special.themeByRoomType ?? {};
  const recipeId = themeRecipeIdFor(roomType, theme);
  const recipes = save.survivalW?.recipes ?? [];
  const recipeMissing = recipeId !== null && !recipes.includes(recipeId);
  if (byType[roomType] === theme && !recipeMissing) return save;

  let next: SaveData = {
    ...save,
    specialTheme: { ...special, themeByRoomType: { ...byType, [roomType]: theme } },
  };
  if (recipeMissing) {
    next = {
      ...next,
      survivalW: { ...(next.survivalW ?? {}), recipes: [...recipes, recipeId] },
    };
  }
  return next;
}

// --- Dweller assignment (keeps savedRoom ↔ dwellers[] consistent) -------------

/**
 * Assign a dweller to a room: remove it from whatever room currently lists it, add it to
 * the target room's `dwellers[]`, and set the dweller's `savedRoom` to the target room's
 * `deserializeID`. Capacity is enforced by the caller (room metadata `maxDwellers`).
 */
export function assignDweller(
  save: SaveData,
  roomDeserializeID: number,
  dwellerSerializeId: number,
): SaveData {
  const rooms = roomList(save);
  if (!rooms.some((r) => r.deserializeID === roomDeserializeID)) {
    throw new RoomNotFoundError(roomDeserializeID);
  }
  const nextRooms = rooms.map((r) => {
    const has = (r.dwellers ?? []).includes(dwellerSerializeId);
    if (r.deserializeID === roomDeserializeID) {
      return has ? r : { ...r, dwellers: [...(r.dwellers ?? []), dwellerSerializeId] };
    }
    return has
      ? { ...r, dwellers: (r.dwellers ?? []).filter((id) => id !== dwellerSerializeId) }
      : r;
  });
  return setDwellerSavedRoom(withRooms(save, nextRooms), dwellerSerializeId, roomDeserializeID);
}

/** Remove a dweller from its room: drop it from any `dwellers[]` and set `savedRoom = -1`. */
export function unassignDweller(save: SaveData, dwellerSerializeId: number): SaveData {
  const nextRooms = roomList(save).map((r) =>
    (r.dwellers ?? []).includes(dwellerSerializeId)
      ? { ...r, dwellers: (r.dwellers ?? []).filter((id) => id !== dwellerSerializeId) }
      : r,
  );
  return setDwellerSavedRoom(withRooms(save, nextRooms), dwellerSerializeId, -1);
}

/** Set one dweller's `savedRoom`, sharing every other dweller (internal helper). */
function setDwellerSavedRoom(save: SaveData, serializeId: number, savedRoom: number): SaveData {
  const list = dwellerList(save);
  const idx = list.findIndex((d) => d.serializeId === serializeId);
  if (idx === -1) return save; // dweller gone (e.g. mid-undo) - rooms already updated
  const next = list.slice();
  next[idx] = { ...list[idx], savedRoom };
  return withDwellers(save, next);
}

// --- Structural ops (validator-gated at the call site) ------------------------

/** The fields a freshly-built room carries, modelled on a real Vault1.sav room. */
export interface NewRoomSpec {
  type: string;
  /** ERoomClass name (== save `room.class`); from room metadata. */
  class: string;
  row: number;
  col: number;
  mergeLevel: number;
  /** Starting level (default 1). */
  level?: number;
}

/** Next free room `deserializeID` = max existing + 1 (rooms share a monotonic counter). */
export function nextRoomId(save: SaveData): number {
  const ids = roomList(save).map((r) => r.deserializeID);
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

/**
 * Build a new room, appended to `vault.rooms`. Returns the new save; the new room's
 * `deserializeID` is `nextRoomId(save)`. The layout VALIDATOR must approve the placement
 * at the call site (the Build palette only enables valid drops).
 */
export function addRoom(save: SaveData, spec: NewRoomSpec): SaveData {
  const room: Room = {
    type: spec.type,
    class: spec.class,
    mergeLevel: spec.mergeLevel,
    row: spec.row,
    col: spec.col,
    level: spec.level ?? 1,
    power: true,
    broken: false,
    roomHealth: { damageValue: 0, initialValue: 0 },
    mrHandyList: [],
    rushTask: -1,
    dwellers: [],
    deadDwellers: [],
    currentStateName: 'Idle',
    currentState: {},
    deserializeID: nextRoomId(save),
    assignedDecoration: '',
    roomVisibility: false,
    roomOutline: false,
    emergencyDone: false,
  } as Room;
  return withRooms(save, [...roomList(save), room]);
}

/**
 * The room best suited to adopt relocated Mr. Handies: prefer a non-elevator room on the
 * same floor, then the Entrance, then any non-FakeWasteland room. The game re-places a
 * Mr. Handy from whatever room's `mrHandyList` names it (Room.DeserializeDwellers), so any
 * real room keeps the robot alive; same-floor keeps it where the player left it.
 */
function mrHandyAdopter(rooms: readonly Room[], row: number | undefined): Room | undefined {
  const eligible = rooms.filter((r) => r.type !== FAKE_WASTELAND_TYPE);
  return (
    eligible.find((r) => r.row === row && r.type !== ELEVATOR_TYPE && r.type !== ENTRANCE_TYPE) ??
    eligible.find((r) => r.type === ENTRANCE_TYPE) ??
    eligible[0]
  );
}

/** Mr. Handy actor ids per floor, derived from each room's `mrHandyList` + its row. */
export function mrHandiesByFloor(save: SaveData): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const r of roomList(save)) {
    const row = r.row;
    if (typeof row !== 'number') continue;
    for (const id of r.mrHandyList ?? []) {
      const list = out.get(row) ?? [];
      list.push(id);
      out.set(row, list);
    }
  }
  return out;
}

/** The room on `row` best suited to hold a Mr. Handy: a regular room first, then the
 *  Entrance, then anything non-scenery (the game only needs SOME room's mrHandyList to
 *  reference the robot for it to work that floor). */
function adopterOnFloor(rooms: readonly Room[], row: number): Room | undefined {
  return (
    rooms.find(
      (r) =>
        r.row === row &&
        r.type !== FAKE_WASTELAND_TYPE &&
        r.type !== ELEVATOR_TYPE &&
        r.type !== ENTRANCE_TYPE,
    ) ??
    rooms.find(
      (r) => r.row === row && r.type !== FAKE_WASTELAND_TYPE && r.type !== ELEVATOR_TYPE,
    ) ??
    rooms.find((r) => r.row === row && r.type !== FAKE_WASTELAND_TYPE)
  );
}

/** deserializeID of the room that would hold a Mr. Handy placed on floor `row`, or null
 *  when the floor has no adoptable room (the floor-based assign flows resolve through
 *  this so users pick a FLOOR, never a specific room). */
export function floorAdopterId(save: SaveData, row: number): number | null {
  return adopterOnFloor(roomList(save), row)?.deserializeID ?? null;
}

/**
 * Move a Mr. Handy to `row`: strip its id from every room's `mrHandyList`, then attach it
 * to a room on that floor (non-elevator preferred; FakeWasteland never). The game rule of
 * ONE Mr. Handy per floor is enforced by the CALLER (the rail only offers empty floors).
 * No-op (same ref) when no room on `row` can adopt.
 */
export function moveMrHandyToFloor(save: SaveData, actorId: number, row: number): SaveData {
  const rooms = roomList(save);
  const adopter = adopterOnFloor(rooms, row);
  if (!adopter) return save;
  if ((adopter.mrHandyList ?? []).includes(actorId)) return save;

  const next = rooms.map((r) => {
    let room = r;
    if ((room.mrHandyList ?? []).includes(actorId)) {
      room = { ...room, mrHandyList: (room.mrHandyList ?? []).filter((id) => id !== actorId) };
    }
    if (room.deserializeID === adopter.deserializeID) room = adoptMrHandies(room, [actorId]);
    return room;
  });
  return withRooms(save, next);
}

/** Append `ids` to `room.mrHandyList`, skipping ids it already holds. */
export function adoptMrHandies(room: Room, ids: readonly number[]): Room {
  const have = room.mrHandyList ?? [];
  const added = ids.filter((id) => !have.includes(id));
  return added.length ? { ...room, mrHandyList: [...have, ...added] } : room;
}

/**
 * Remove a room, returning its assigned dwellers to the vault door (`savedRoom = -1`) and
 * relocating any attached Mr. Handies to a surviving room (same floor if possible, else the
 * Entrance); dropping their ids would make them vanish in-game on load.
 * Must be validator-approved (`canRemoveRoom`) at the call site so it never strands rooms.
 */
export function removeRoom(save: SaveData, deserializeID: number): SaveData {
  const list = roomList(save);
  const room = list.find((r) => r.deserializeID === deserializeID);
  if (!room) throw new RoomNotFoundError(deserializeID);

  let remaining = list.filter((r) => r.deserializeID !== deserializeID);
  const handies = room.mrHandyList ?? [];
  if (handies.length > 0) {
    const adopter = mrHandyAdopter(remaining, room.row);
    if (adopter) {
      remaining = remaining.map((r) => (r === adopter ? adoptMrHandies(r, handies) : r));
    }
  }
  let next = withRooms(save, remaining);
  for (const id of room.dwellers ?? []) next = setDwellerSavedRoom(next, id, -1);
  return next;
}

/** Point the given ACTORS' (Mr. Handies') `savedRoom` at -1 ("outside the vault"). */
function sendActorsOutside(save: SaveData, actorIds: readonly number[]): SaveData {
  const actors = save.dwellers?.actors;
  if (!Array.isArray(actors) || actorIds.length === 0) return save;
  const ids = new Set(actorIds);
  let changed = false;
  const next = actors.map((a) => {
    if (typeof a.serializeId !== 'number' || !ids.has(a.serializeId) || a.savedRoom === -1) {
      return a;
    }
    changed = true;
    return { ...a, savedRoom: -1 };
  });
  if (!changed) return save;
  return { ...save, dwellers: { ...(save.dwellers ?? { dwellers: [] }), actors: next } };
}

/** Mr. Handy ids held by OTHER rooms on floor `row` (not by room `deserializeID`). */
export function residentHandiesOnFloor(
  save: SaveData,
  deserializeID: number,
  row: number,
): number[] {
  return roomList(save)
    .filter((r) => r.deserializeID !== deserializeID && r.row === row)
    .flatMap((r) => r.mrHandyList ?? []);
}

/**
 * Move a room to (`row`, `col`). Must be validator-approved (`canMoveRoom`) at the call site.
 *
 * The room keeps its `deserializeID`, so its occupants come along untouched: each dweller's
 * `savedRoom` still points at this id and the room's `dwellers[]` is shared through - a move
 * never touches the dweller↔room cross-reference, so it cannot introduce the desync the
 * Diagnostics "occupant lists out of sync" check repairs. No-op (same ref) when unchanged.
 *
 * HARD game rule enforced here: ONE Mr. Handy per floor. When the moved room carries a
 * robot onto a floor where another room already holds one, the resident robot is evicted -
 * sent outside the vault (waits at the door) - because the move is the user's active
 * intent. `residentHandiesOnFloor` lets the UI name the evictee in its toast.
 */
export const moveRoom = (
  save: SaveData,
  deserializeID: number,
  row: number,
  col: number,
): SaveData => {
  const room = roomList(save).find((r) => r.deserializeID === deserializeID);
  if (room && room.row === row && room.col === col) return save;
  let next = updateRoom(save, deserializeID, (r) => ({ ...r, row, col }));
  if ((room?.mrHandyList ?? []).length > 0) {
    const evicted: number[] = [];
    const rooms = roomList(next).map((r) => {
      if (r.deserializeID === deserializeID || r.row !== row) return r;
      const list = r.mrHandyList ?? [];
      if (list.length === 0) return r;
      evicted.push(...list);
      return { ...r, mrHandyList: [] };
    });
    if (evicted.length > 0) {
      next = sendActorsOutside(withRooms(next, rooms), evicted);
    }
  }
  return next;
};

/**
 * Merge a room with an adjacent same-type, same-level neighbour (BaseConstructionMgr.MergeRoom):
 * the survivor (`deserializeID`) absorbs the neighbour's width + dwellers and takes the
 * leftmost column; the neighbour is removed. Must be validator-approved (`canMergeRoom`) -
 * pass the `neighbourId` it returns.
 */
export function mergeRoomWith(
  save: SaveData,
  deserializeID: number,
  neighbourId: number,
): SaveData {
  const list = roomList(save);
  const survivor = list.find((r) => r.deserializeID === deserializeID);
  const neighbour = list.find((r) => r.deserializeID === neighbourId);
  if (!survivor) throw new RoomNotFoundError(deserializeID);
  if (!neighbour) throw new RoomNotFoundError(neighbourId);

  const mergedDwellers = [...(survivor.dwellers ?? []), ...(neighbour.dwellers ?? [])];
  // The survivor also absorbs the neighbour's Mr. Handies; dropping the neighbour's
  // mrHandyList would make those robots vanish in-game on load.
  const merged: Room = adoptMrHandies(
    {
      ...survivor,
      col: Math.min(survivor.col ?? 0, neighbour.col ?? 0),
      mergeLevel: (survivor.mergeLevel ?? 1) + (neighbour.mergeLevel ?? 1),
      dwellers: mergedDwellers,
    },
    neighbour.mrHandyList ?? [],
  );

  let next = withRooms(
    save,
    list
      .filter((r) => r.deserializeID !== neighbourId)
      .map((r) => (r.deserializeID === deserializeID ? merged : r)),
  );
  // Re-point the absorbed neighbour's dwellers at the surviving room.
  for (const id of neighbour.dwellers ?? []) {
    next = setDwellerSavedRoom(next, id, deserializeID);
  }
  return next;
}
