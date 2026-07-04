import type { Dweller, Room, SaveData } from '../model/saveSchema.ts';
import {
  cleanRoomRosters,
  dedupeSerializeIds,
  fixDwellerIdCounter,
  fixInvalidResources,
  fixLunchboxCount,
  sendOrphanedDwellersToDoor,
} from './repairOps.ts';

// Broken-save diagnosis. Beyond the load-time health check
// (healthCheck.ts), this inspects the save for structural inconsistencies that make a
// save malformed, EXPLAINS each one in plain language, and pairs it with a pure repair.
// Each diagnosis is independently fixable; "repair all" folds them in a safe order.
// Detection is read-only; repairs live in repairOps.ts.

export type DiagnosisKind =
  | 'orphanedSavedRoom'
  | 'roomAssignmentDesync'
  | 'lunchboxCountMismatch'
  | 'invalidResource'
  | 'duplicateSerializeId'
  | 'dwellerIdCounterBehind';

/** One plain-language breakdown line, optionally naming dwellers the UI can deep-link. */
export interface DiagnosisDetail {
  text: string;
  /** Dwellers referenced by this line, for deep links to their roster entry. */
  dwellers?: Array<{ id: number; name: string }>;
}

export interface Diagnosis {
  kind: DiagnosisKind;
  severity: 'error' | 'warning';
  /** Short headline. */
  title: string;
  /** Plain-language explanation of why this is malformed + what the fix does. */
  detail: string;
  /** Optional per-entity breakdown lines (e.g. each broken roster entry), surfaced under
   *  the detail so the user can see exactly what the editor disagrees on. */
  details?: DiagnosisDetail[];
  /** How many entities are affected (for the UI count badge). */
  count: number;
  /** Pure repair: `(save) => fixed save`. */
  repair: (save: SaveData) => SaveData;
}

function dwellerList(save: SaveData): Dweller[] {
  const list = save.dwellers?.dwellers;
  return Array.isArray(list) ? list : [];
}

function roomList(save: SaveData): Room[] {
  const list = save.vault?.rooms;
  return Array.isArray(list) ? list : [];
}

export function diagnose(save: SaveData): Diagnosis[] {
  const out: Diagnosis[] = [];
  const dwellers = dwellerList(save);
  const rooms = roomList(save);
  const roomIds = new Set(rooms.map((r) => r.deserializeID));

  // 1. Orphaned savedRoom → a dweller assigned to a room that no longer exists.
  const orphans = dwellers.filter(
    (d) => typeof d.savedRoom === 'number' && d.savedRoom !== -1 && !roomIds.has(d.savedRoom),
  );
  if (orphans.length > 0) {
    out.push({
      kind: 'orphanedSavedRoom',
      severity: 'error',
      title: 'Dwellers assigned to missing rooms',
      detail:
        `${orphans.length} dweller(s) have a savedRoom pointing at a room that does not ` +
        `exist. The game can't place them. Fix: send them back to the vault door (savedRoom = -1).`,
      count: orphans.length,
      repair: sendOrphanedDwellersToDoor,
    });
  }

  // 2. Broken room worker lists. A room's `dwellers[]` is its work ROSTER, while a
  // dweller's `savedRoom` is where they physically are right now; the two legitimately
  // disagree in saves straight from the game (dwellers exploring, on quests, idling, or
  // visiting other rooms stay on their room's roster with savedRoom = -1 or elsewhere) -
  // verified against genuine game saves - so a plain mismatch is deliberately NOT flagged.
  // What CAN'T be right: a roster entry pointing at a dweller that doesn't exist, or one
  // dweller sitting on two rooms' rosters at once.
  const dwellerById = new Map<number, Dweller>();
  for (const d of dwellers) {
    if (typeof d.serializeId === 'number' && !dwellerById.has(d.serializeId)) {
      dwellerById.set(d.serializeId, d);
    }
  }
  const displayName = (id: number): string => {
    const d = dwellerById.get(id);
    const name = d ? `${d.name ?? ''} ${d.lastName ?? ''}`.trim() : '';
    return name || `Dweller ${id}`;
  };
  const roomLabel = (r: Room): string => `${r.type ?? 'Room'} #${r.deserializeID}`;
  const rosterRoomsByDweller = new Map<number, Room[]>();
  const ghostLines: DiagnosisDetail[] = [];
  for (const r of rooms) {
    for (const id of r.dwellers ?? []) {
      if (!dwellerById.has(id)) {
        ghostLines.push({
          text: `${roomLabel(r)} has a worker entry for dweller id ${id}, but no dweller with that id exists in this save.`,
        });
        continue;
      }
      const arr = rosterRoomsByDweller.get(id) ?? [];
      arr.push(r);
      rosterRoomsByDweller.set(id, arr);
    }
  }
  const doubleLines: DiagnosisDetail[] = [];
  for (const [id, list] of rosterRoomsByDweller) {
    if (list.length <= 1) continue;
    const uniqueRooms = [...new Set(list)];
    const name = displayName(id);
    doubleLines.push({
      text:
        uniqueRooms.length === 1
          ? `${name} is listed twice in ${roomLabel(uniqueRooms[0]!)}.`
          : `${name} is on the worker list of ${uniqueRooms.map(roomLabel).join(' and ')}, but a dweller can only work in one room.`,
      dwellers: [{ id, name }],
    });
  }
  const rosterIssues = [...ghostLines, ...doubleLines];
  if (rosterIssues.length > 0) {
    out.push({
      kind: 'roomAssignmentDesync',
      severity: 'warning',
      title: 'Broken room worker lists',
      detail:
        `${rosterIssues.length} room worker entr${rosterIssues.length === 1 ? 'y is' : 'ies are'} ` +
        `impossible: they point at dwellers that do not exist, or book the same dweller into two ` +
        `rooms at once. (Dwellers who are simply away from their assigned room - exploring, on a ` +
        `quest, or idling - are normal and not flagged.) Fix: remove the impossible entries; a ` +
        `double-booked dweller keeps the room they are actually in.`,
      details: rosterIssues,
      count: rosterIssues.length,
      repair: cleanRoomRosters,
    });
  }

  // 3. LunchBox count mismatch.
  const byType = save.vault?.LunchBoxesByType;
  if (Array.isArray(byType) && save.vault?.LunchBoxesCount !== byType.length) {
    out.push({
      kind: 'lunchboxCountMismatch',
      severity: 'warning',
      title: 'Lunchbox count mismatch',
      detail:
        `LunchBoxesCount (${String(save.vault?.LunchBoxesCount)}) does not match the ` +
        `${byType.length} entries in LunchBoxesByType. Fix: set the count to the array length.`,
      count: 1,
      repair: fixLunchboxCount,
    });
  }

  // 4. Invalid (non-finite or negative) resource amounts.
  const resources = save.vault?.storage?.resources ?? {};
  const badResources = Object.entries(resources).filter(
    ([, v]) => typeof v === 'number' && (!Number.isFinite(v) || v < 0),
  );
  if (badResources.length > 0) {
    out.push({
      kind: 'invalidResource',
      severity: 'error',
      title: 'Invalid resource amounts',
      detail:
        `${badResources.length} resource(s) have a negative or non-finite value ` +
        `(${badResources.map(([k]) => k).join(', ')}). Fix: clamp them to 0.`,
      count: badResources.length,
      repair: fixInvalidResources,
    });
  }

  // 5. Duplicate serializeIds.
  const seen = new Set<number>();
  let dupes = 0;
  for (const d of dwellers) {
    const id = d.serializeId;
    if (typeof id !== 'number') continue;
    if (seen.has(id)) dupes++;
    else seen.add(id);
  }
  if (dupes > 0) {
    out.push({
      kind: 'duplicateSerializeId',
      severity: 'error',
      title: 'Duplicate dweller ids',
      detail:
        `${dupes} dweller(s) share a serializeId with another dweller. Duplicate ids confuse ` +
        `family/room links and saving. Fix: reassign the duplicates to fresh unique ids.`,
      count: dupes,
      repair: dedupeSerializeIds,
    });
  }

  // 6. dwellers.id counter behind the highest serializeId.
  const maxId = dwellers.reduce((m, d) => Math.max(m, d.serializeId ?? 0), 0);
  const counter = typeof save.dwellers?.id === 'number' ? save.dwellers.id : 0;
  if (dwellers.length > 0 && counter < maxId) {
    out.push({
      kind: 'dwellerIdCounterBehind',
      severity: 'warning',
      title: 'Dweller id counter is behind',
      detail:
        `The dwellers.id counter (${counter}) is below the highest dweller id (${maxId}), so the ` +
        `next added dweller would reuse an in-use id. Fix: advance the counter to ${maxId}.`,
      count: 1,
      repair: fixDwellerIdCounter,
    });
  }

  // NOTE: a Mr. Handy referenced by NO room's mrHandyList is deliberately NOT flagged.
  // It is a valid state, not a malformation: the robot simply waits outside the vault
  // (user-verified in-game - it sits at the door indefinitely until placed on a floor).

  return out;
}

/**
 * Apply every diagnosed repair in a safe order (orphans before the roster clean so reset
 * dwellers resolve first; dedupe before the counter fix so the counter ends past the new
 * ids). Re-diagnosing afterwards should return no fixable structural issues.
 */
export function repairAll(save: SaveData): SaveData {
  const order: DiagnosisKind[] = [
    'orphanedSavedRoom',
    'roomAssignmentDesync',
    'lunchboxCountMismatch',
    'invalidResource',
    'duplicateSerializeId',
    'dwellerIdCounterBehind',
  ];
  const found = new Map(diagnose(save).map((d) => [d.kind, d.repair] as const));
  return order.reduce((acc, kind) => {
    const repair = found.get(kind);
    return repair ? repair(acc) : acc;
  }, save);
}
