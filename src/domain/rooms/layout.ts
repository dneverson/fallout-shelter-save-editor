import type { Room, SaveData } from '../model/saveSchema.ts';

// Pure vault-layout model. The geometry +
// connectivity rules here are reverse-engineered from the game's own decompiled source
// (Assembly-CSharp: Vault, ConstructionGrid, Room, BaseConstructionMgr) and validated
// against the real Vault1.sav layout (tests/fixtures/vault1-layout.json):
//
//  - The vault is a grid of CELLS. A small room is `GridCellCountInSmallRoom = 3` cells
//    wide; a merged room is `3 × mergeLevel` cells; an Elevator is 1 cell.
//  - A room occupies `[col, col + width)` cells on its `row` (floor 0 = top).
//  - Connectivity (Room.UpdateNeighbours): two rooms are HORIZONTAL neighbours when one's
//    right cell touches the other's left cell (any types). Two rooms are VERTICAL neighbours
//    ONLY when BOTH are Elevators stacked in the same column on adjacent floors.
//  - A layout is valid iff every room can reach the Entrance through that neighbour graph
//    (BaseConstructionMgr.CanReachEntrance), no two rooms overlap, and all rooms are in
//    grid bounds. The grid is a FIXED 26 × 25 (VaultLogic.prefab: m_CellsPerRow = 26,
//    m_NumberOfRows = 25); it never grows or shrinks with the vault's contents.

/** Cells per un-merged room (`GridCellCountInSmallRoom`). */
export const CELLS_PER_ROOM = 3;
/** Maximum vault depth in floors (`Vault.m_MaxRooms` / VaultLogic.prefab m_NumberOfRows). */
const MAX_FLOORS = 25;
/** Fixed grid width in cells (VaultLogic.prefab m_CellsPerRow). */
const GRID_COLS = 26;
/** Maximum horizontal merge (a room spans at most 3 small rooms). */
export const MAX_MERGE_LEVEL = 3;

export const ELEVATOR_TYPE = 'Elevator';
export const ENTRANCE_TYPE = 'Entrance';
/**
 * The non-buildable scenery tile the game auto-places at the vault's top-left, left of the
 * Entrance (confirmed in the real Vault1.sav: row 0, col 0, locked at level/mergeLevel 1,
 * never staffed, and absent from the room catalog). It is not a real room: it cannot be
 * moved, levelled, staffed, merged, or removed - the editor must treat it as fully locked.
 */
export const FAKE_WASTELAND_TYPE = 'FakeWasteland';

/**
 * Human floor number for a 0-based grid row. Every user-facing floor reference (labels,
 * aria text, toasts) shows floors starting at 1 - the top/surface row is "floor 1" - so
 * non-programmers aren't confronted with a "floor 0". Save data stays 0-based.
 */
export function displayFloor(row: number): number {
  return row + 1;
}

/** Footprint width in cells: an Elevator is 1 cell; any other room is `3 × mergeLevel`. */
export function roomCellWidth(type: string, mergeLevel: number): number {
  if (type === ELEVATOR_TYPE) return 1;
  return CELLS_PER_ROOM * Math.max(1, mergeLevel);
}

/**
 * The minimal geometry the connectivity/overlap graph reasons about. A real placed room
 * (`RoomNode`) and a hypothetical candidate placement both satisfy this, so the validator
 * can test proposed edits without constructing a full save room object.
 */
export interface CellBox {
  deserializeID: number;
  type: string;
  isElevator: boolean;
  row: number;
  /** Leftmost cell column. */
  col: number;
  /** Exclusive right cell column (`col + width`). */
  colEnd: number;
}

/** A placed room reduced to the geometry the layout reasons about. */
export interface RoomNode extends CellBox {
  /** The live save room object (so ops can mutate by reference identity). */
  room: Room;
  /** Footprint width in cells. */
  width: number;
  mergeLevel: number;
  level: number;
}

export interface Layout {
  nodes: RoomNode[];
  byId: Map<number, RoomNode>;
  /** "row,col" of every unexcavated rock cell. */
  rocks: ReadonlySet<string>;
  /** "row,col" of every ultracite-deposit cell (season vaults; blocks builds like rock). */
  ultracite: ReadonlySet<string>;
  /** Grid width (exclusive col bound), always GRID_COLS. */
  cols: number;
  /** Grid depth (exclusive row bound), always MAX_FLOORS. */
  rows: number;
}

const cellKey = (row: number, col: number): string => `${row},${col}`;

/** True when a room object carries the numeric geometry the layout needs. */
function hasGeometry(room: Room): room is Room & { row: number; col: number } {
  return typeof room.row === 'number' && typeof room.col === 'number';
}

/** Project one save room into a geometry node (callers guarantee it has row/col). */
export function toNode(room: Room & { row: number; col: number }): RoomNode {
  const mergeLevel = typeof room.mergeLevel === 'number' ? room.mergeLevel : 1;
  const level = typeof room.level === 'number' ? room.level : 1;
  const width = roomCellWidth(room.type, mergeLevel);
  return {
    room,
    deserializeID: room.deserializeID,
    type: room.type,
    isElevator: room.type === ELEVATOR_TYPE,
    row: room.row,
    col: room.col,
    width,
    colEnd: room.col + width,
    mergeLevel,
    level,
  };
}

/** Build the layout model from the working save's vault. Pure - no mutation. */
export function buildLayout(save: SaveData): Layout {
  const rooms = save.vault?.rooms ?? [];
  const nodes: RoomNode[] = [];
  for (const room of rooms) {
    if (hasGeometry(room)) nodes.push(toNode(room));
  }

  const cellSetOf = (list: readonly unknown[] | undefined): Set<string> => {
    const out = new Set<string>();
    for (const cell of list ?? []) {
      const r = (cell as { r?: number }).r;
      const c = (cell as { c?: number }).c;
      if (typeof r === 'number' && typeof c === 'number') out.add(cellKey(r, c));
    }
    return out;
  };

  return {
    nodes,
    byId: new Map(nodes.map((n) => [n.deserializeID, n])),
    rocks: cellSetOf(save.vault?.rocks),
    ultracite: cellSetOf(save.vault?.ultracite),
    // The playground is the game's FIXED grid (VaultLogic.prefab: 26 × 25). Deriving either
    // dimension from the vault's contents was wrong both ways: depth collapsed when rocks were
    // excavated, and width collapsed below 26 for young vaults / after "Remove all rocks",
    // silently killing right-edge builds. The validator still gates which cells are actually
    // buildable (a room must reach the Entrance), so the full grid stays corruption-safe:
    // unreachable cells simply yield no build/move targets.
    cols: GRID_COLS,
    rows: MAX_FLOORS,
  };
}

/** Map every occupied cell → the node occupying it (last write wins on overlap). */
export function occupancy<T extends CellBox>(nodes: readonly T[]): Map<string, T> {
  const cells = new Map<string, T>();
  for (const n of nodes) {
    for (let c = n.col; c < n.colEnd; c++) cells.set(cellKey(n.row, c), n);
  }
  return cells;
}

/** The neighbours of `node` per the game's rules (horizontal any-type; vertical elevator-only). */
function neighbours<T extends CellBox>(node: T, cells: Map<string, T>): T[] {
  const out: T[] = [];
  const left = cells.get(cellKey(node.row, node.col - 1));
  if (left && left !== node) out.push(left);
  const right = cells.get(cellKey(node.row, node.colEnd));
  if (right && right !== node) out.push(right);
  if (node.isElevator) {
    for (let c = node.col; c < node.colEnd; c++) {
      const up = cells.get(cellKey(node.row - 1, c));
      if (up?.isElevator) out.push(up);
      const down = cells.get(cellKey(node.row + 1, c));
      if (down?.isElevator) out.push(down);
    }
  }
  return out;
}

/**
 * Whether `start` can reach an Entrance room through the neighbour graph
 * (BaseConstructionMgr.CanReachEntrance). `cells` may be prebuilt to amortise repeated calls.
 */
export function reachesEntrance<T extends CellBox>(
  nodes: readonly T[],
  start: T,
  cells: Map<string, T> = occupancy(nodes),
): boolean {
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node.deserializeID)) continue;
    seen.add(node.deserializeID);
    if (node.type === ENTRANCE_TYPE) return true;
    for (const nb of neighbours(node, cells)) stack.push(nb);
  }
  return false;
}

/**
 * Whether EVERY non-Entrance node connects to an Entrance, computed in one flood-fill from
 * the Entrance room(s) rather than a per-node `reachesEntrance` sweep. The neighbour graph is
 * undirected (horizontal + elevator links are symmetric), so "all rooms reach the Entrance"
 * ⟺ "the Entrance reaches all rooms" - O(n) instead of O(n²). This is the hot path behind the
 * drag/move target sweep (`validMoveTargets` runs the validator over every grid cell).
 */
export function allReachEntrance<T extends CellBox>(
  nodes: readonly T[],
  cells: Map<string, T> = occupancy(nodes),
): boolean {
  const seen = new Set<number>();
  const stack = nodes.filter((n) => n.type === ENTRANCE_TYPE);
  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node.deserializeID)) continue;
    seen.add(node.deserializeID);
    for (const nb of neighbours(node, cells)) stack.push(nb);
  }
  return nodes.every((n) => n.type === ENTRANCE_TYPE || seen.has(n.deserializeID));
}

/** A pair of overlapping nodes, if any two share a cell. */
export function findOverlap<T extends CellBox>(nodes: readonly T[]): { a: T; b: T } | null {
  const cells = new Map<string, T>();
  for (const n of nodes) {
    for (let c = n.col; c < n.colEnd; c++) {
      const key = cellKey(n.row, c);
      const prev = cells.get(key);
      if (prev) return { a: prev, b: n };
      cells.set(key, n);
    }
  }
  return null;
}
