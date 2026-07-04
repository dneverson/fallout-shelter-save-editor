import type { Dweller, Room, SaveData } from '../model/saveSchema.ts';

// Pure, immutable repair operations for the broken-save diagnosis screen (explain
// why a save is malformed). Each repair targets one
// class of structural inconsistency the diagnostics module detects and returns a new save
// (structural sharing - untouched subtrees kept by reference), so a repair is one undoable
// edit like any other op. Repairs are conservative: they only correct the named anomaly,
// never touch unrelated data, and are safe to run on an already-clean save (no-op).

function dwellerList(save: SaveData): Dweller[] {
  const list = save.dwellers?.dwellers;
  return Array.isArray(list) ? list : [];
}

function roomList(save: SaveData): Room[] {
  const list = save.vault?.rooms;
  return Array.isArray(list) ? list : [];
}

const withDwellers = (save: SaveData, dwellers: Dweller[]): SaveData => ({
  ...save,
  dwellers: { ...(save.dwellers ?? { dwellers: [] }), dwellers },
});

const withRooms = (save: SaveData, rooms: Room[]): SaveData => ({
  ...save,
  vault: { ...(save.vault ?? {}), rooms },
});

/** Valid room ids (deserializeID) for membership checks. */
function roomIdSet(save: SaveData): Set<number> {
  return new Set(roomList(save).map((r) => r.deserializeID));
}

/**
 * Send dwellers whose `savedRoom` points at a non-existent room back to the vault door
 * (`savedRoom = -1`). An orphaned `savedRoom` leaves a dweller "assigned" to a room the
 * game can't find. Only out-of-range references are touched; -1 (at door) is left as-is.
 */
export function sendOrphanedDwellersToDoor(save: SaveData): SaveData {
  const ids = roomIdSet(save);
  let changed = false;
  const next = dwellerList(save).map((d) => {
    const room = d.savedRoom;
    if (typeof room === 'number' && room !== -1 && !ids.has(room)) {
      changed = true;
      return { ...d, savedRoom: -1 };
    }
    return d;
  });
  return changed ? withDwellers(save, next) : save;
}

/**
 * Remove IMPOSSIBLE entries from every room's `dwellers[]` worker roster: ids that match
 * no dweller in the save, and duplicate bookings (the same dweller on two rooms' rosters,
 * or twice on one). A double-booked dweller keeps the roster of the room their own
 * `savedRoom` points at when it is among them, otherwise the first room that lists them.
 * A roster listing a dweller who is currently elsewhere (savedRoom -1 or another room) is
 * NORMAL in genuine game saves - exploring/questing/idle dwellers keep their job slot -
 * so those entries are never touched.
 */
export function cleanRoomRosters(save: SaveData): SaveData {
  const rooms = roomList(save);
  if (rooms.length === 0) return save;
  const dwellerIds = new Set<number>();
  const savedRoomById = new Map<number, number>();
  for (const d of dwellerList(save)) {
    if (typeof d.serializeId !== 'number') continue;
    dwellerIds.add(d.serializeId);
    if (typeof d.savedRoom === 'number') savedRoomById.set(d.serializeId, d.savedRoom);
  }
  // Which room keeps each dweller: prefer the room the dweller is physically in
  // (savedRoom), falling back to the first roster that lists them.
  const keeper = new Map<number, number>();
  for (const r of rooms) {
    for (const id of r.dwellers ?? []) {
      if (!dwellerIds.has(id)) continue;
      if (!keeper.has(id) || savedRoomById.get(id) === r.deserializeID) {
        keeper.set(id, r.deserializeID);
      }
    }
  }
  let changed = false;
  const next = rooms.map((r) => {
    const have = r.dwellers ?? [];
    const seen = new Set<number>();
    const kept = have.filter((id) => {
      if (keeper.get(id) !== r.deserializeID || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (kept.length === have.length) return r;
    changed = true;
    return { ...r, dwellers: kept };
  });
  return changed ? withRooms(save, next) : save;
}

/** Set `LunchBoxesCount` to match `LunchBoxesByType.length` (the game expects them equal). */
export function fixLunchboxCount(save: SaveData): SaveData {
  const vault = save.vault;
  const byType = vault?.LunchBoxesByType;
  if (!vault || !Array.isArray(byType)) return save;
  if (vault.LunchBoxesCount === byType.length) return save;
  return { ...save, vault: { ...vault, LunchBoxesCount: byType.length } };
}

/** Clamp non-finite or negative resource amounts to 0 (a negative/NaN cap corrupts the UI). */
export function fixInvalidResources(save: SaveData): SaveData {
  const resources = save.vault?.storage?.resources;
  if (!resources) return save;
  let changed = false;
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(resources)) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
      next[key] = 0;
      changed = true;
    } else {
      next[key] = value;
    }
  }
  if (!changed) return save;
  return {
    ...save,
    vault: {
      ...save.vault,
      storage: { ...save.vault?.storage, resources: next },
    },
  };
}

/**
 * Give each dweller a unique `serializeId`: the first occurrence of an id keeps it; later
 * duplicates are reassigned to fresh ids above the current maximum, and the `dwellers.id`
 * running counter is bumped past them so future adds don't collide.
 */
export function dedupeSerializeIds(save: SaveData): SaveData {
  const list = dwellerList(save);
  const seen = new Set<number>();
  let maxId = list.reduce((m, d) => Math.max(m, d.serializeId ?? 0), 0);
  const counter = typeof save.dwellers?.id === 'number' ? save.dwellers.id : 0;
  maxId = Math.max(maxId, counter);
  let changed = false;
  const next = list.map((d) => {
    const id = d.serializeId;
    if (typeof id !== 'number' || seen.has(id)) {
      maxId += 1;
      changed = true;
      seen.add(maxId);
      return { ...d, serializeId: maxId };
    }
    seen.add(id);
    return d;
  });
  if (!changed) return save;
  return {
    ...save,
    dwellers: { ...(save.dwellers ?? { dwellers: [] }), dwellers: next, id: maxId },
  };
}

/**
 * Advance the `dwellers.id` running counter to at least the highest live `serializeId`.
 * If it lags, the next created dweller would reuse an in-use id (a duplicate).
 */
export function fixDwellerIdCounter(save: SaveData): SaveData {
  const block = save.dwellers;
  if (!block) return save;
  const maxId = dwellerList(save).reduce((m, d) => Math.max(m, d.serializeId ?? 0), 0);
  const counter = typeof block.id === 'number' ? block.id : 0;
  if (counter >= maxId) return save;
  return { ...save, dwellers: { ...block, id: maxId } };
}

// NOTE: there is deliberately NO "orphaned Mr. Handy" repair here. A robot referenced by
// no room's mrHandyList is a valid state, not a malformation - it waits outside the vault
// (user-verified in-game: it sits at the door indefinitely until placed on a floor).
