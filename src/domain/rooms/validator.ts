import {
  ELEVATOR_TYPE,
  ENTRANCE_TYPE,
  FAKE_WASTELAND_TYPE,
  MAX_MERGE_LEVEL,
  allReachEntrance,
  findOverlap,
  occupancy,
  reachesEntrance,
  roomCellWidth,
  type CellBox,
  type Layout,
  type RoomNode,
} from './layout.ts';

// The vault-layout VALIDATOR. This is the
// product's highest save-corruption risk: an invalid room layout is an unrecoverable
// broken save, so every structural edit is checked HERE and BLOCKED with a plain reason
// rather than written. The rules mirror the game's own construction logic (Assembly-CSharp
// ConstructionGrid / ConstructionMgr.GenerateBuildZones / Room.CalculateRoomNeighbors /
// BaseConstructionMgr.CanReachEntrance / CanMergeRoom) and are tested against the real
// Vault1.sav layout.
//
// The game's placement rule is exactly: in-bounds on the fixed 26×25 grid, no overlap, no
// rock/ultracite cells, and flush adjacency to connected structure. Build zones only spawn
// left/right of rooms and 4-around elevators (ConstructionMgr.GenerateBuildZones), and the
// neighbour graph counts horizontal touching (any types) + vertical elevator to elevator,
// so requiring the candidate to reach the Entrance through that graph reproduces the game's
// build-zone offers exactly. There is NO global column-alignment rule: alignment emerges
// per contiguous run from flush adjacency, and floors may be offset from each other.

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const OK: ValidationResult = { ok: true };
const fail = (reason: string): ValidationResult => ({ ok: false, reason });

/** Sentinel id for a hypothetical room not yet in the save (won't collide with real ids). */
const CANDIDATE_ID = -1;

/** A proposed room placement (build or move target). */
export interface PlacementSpec {
  type: string;
  row: number;
  col: number;
  mergeLevel: number;
}

/** Reduce a placement spec to the geometry box the graph reasons about. */
function candidateBox(spec: PlacementSpec): CellBox {
  const isElevator = spec.type === ELEVATOR_TYPE;
  const width = roomCellWidth(spec.type, isElevator ? 1 : spec.mergeLevel);
  return {
    deserializeID: CANDIDATE_ID,
    type: spec.type,
    isElevator,
    row: spec.row,
    col: spec.col,
    colEnd: spec.col + width,
  };
}

/** Geometry checks shared by build + move (no connectivity). */
function checkPlacement(
  layout: Layout,
  box: CellBox,
  others: readonly CellBox[],
): ValidationResult {
  if (box.row < 0 || box.row >= layout.rows) {
    return fail(`Floor ${box.row} is outside the vault (0–${layout.rows - 1}).`);
  }
  if (box.col < 0 || box.colEnd > layout.cols) {
    return fail(`That position runs past the vault edge (columns 0–${layout.cols - 1}).`);
  }
  if (findOverlap([...others, box])) {
    return fail('That space is already occupied by another room.');
  }
  // A room cannot occupy an unexcavated rock or ultracite cell - the game requires clear
  // dirt before construction (ConstructionGrid.CanGetSpace). Without this, once elevators
  // reach the lower undug floors a room could be built/moved straight onto rock, corrupting
  // the layout. (The game lets an UltraciteMining room cover deposits; the editor stays
  // conservative and blocks all types.)
  for (let c = box.col; c < box.colEnd; c++) {
    if (layout.rocks.has(`${box.row},${c}`)) {
      return fail('That space contains rock. Excavate it first.');
    }
    if (layout.ultracite.has(`${box.row},${c}`)) {
      return fail('That space contains an ultracite deposit.');
    }
  }
  return OK;
}

/** Whether a brand-new room of `spec` can be built. */
export function canBuildRoom(layout: Layout, spec: PlacementSpec): ValidationResult {
  const merge = spec.type === ELEVATOR_TYPE ? 1 : spec.mergeLevel;
  if (merge < 1 || merge > MAX_MERGE_LEVEL) {
    return fail(`Merge level must be 1–${MAX_MERGE_LEVEL}.`);
  }
  const box = candidateBox(spec);
  const placement = checkPlacement(layout, box, layout.nodes);
  if (!placement.ok) return placement;

  // The new room must reach the Entrance through the resulting layout (no floaters).
  const all = [...layout.nodes, box];
  if (box.type !== ENTRANCE_TYPE && !reachesEntrance(all, box)) {
    return fail(
      'A new room must connect to an elevator or an existing room reaching the entrance.',
    );
  }
  return OK;
}

/** Whether `id` can be removed without stranding any remaining room from the entrance. */
export function canRemoveRoom(layout: Layout, id: number): ValidationResult {
  const node = layout.byId.get(id);
  if (!node) return fail('Room not found.');
  if (node.type === ENTRANCE_TYPE) return fail('The vault entrance cannot be removed.');
  if (node.type === FAKE_WASTELAND_TYPE) return fail('The wasteland tile cannot be removed.');

  const remaining = layout.nodes.filter((n) => n.deserializeID !== id);
  const cells = occupancy(remaining);
  const stranded = remaining.find((n) => !reachesEntrance(remaining, n, cells));
  if (stranded) {
    return fail('Removing this room would cut off other rooms from the entrance.');
  }
  return OK;
}

/** Whether `id` can be moved to (`row`,`col`) keeping the whole layout valid. */
export function canMoveRoom(
  layout: Layout,
  id: number,
  row: number,
  col: number,
): ValidationResult {
  const node = layout.byId.get(id);
  if (!node) return fail('Room not found.');
  if (node.type === FAKE_WASTELAND_TYPE) return fail('The wasteland tile cannot be moved.');

  const others = layout.nodes.filter((n) => n.deserializeID !== id);
  const box = candidateBox({ type: node.type, row, col, mergeLevel: node.mergeLevel });
  const placement = checkPlacement(layout, box, others);
  if (!placement.ok) return placement;

  // The moved room AND every other room must still reach the entrance afterwards. One
  // flood-fill from the Entrance (O(n)) rather than a per-room sweep (O(n²)) - this runs once
  // per candidate cell across the whole grid, so the quadratic version froze drag start.
  const all = [...others, box];
  if (!allReachEntrance(all)) {
    return fail('That move would cut a room off from the entrance.');
  }
  return OK;
}

/**
 * The rooms that would lose their path to the Entrance if `id` were lifted out of the layout
 * (its cells left empty). Powers the "why can't this move?" feedback: a room with NO legal
 * move target is usually load-bearing - a neighbour reaches the Entrance only through it, so
 * lifting it strands that neighbour wherever the dragged room lands. Returns their
 * deserializeIDs (empty when removing `id` strands nothing - then the block is geometric).
 */
export function strandedIfRemoved(layout: Layout, id: number): number[] {
  const node = layout.byId.get(id);
  if (!node) return [];
  const remaining = layout.nodes.filter((n) => n.deserializeID !== id);
  const cells = occupancy(remaining);
  return remaining
    .filter(
      (n) =>
        n.type !== ENTRANCE_TYPE &&
        n.type !== FAKE_WASTELAND_TYPE &&
        !reachesEntrance(remaining, n, cells),
    )
    .map((n) => n.deserializeID);
}

/**
 * Whether `id` can merge with a same-type neighbour (BaseConstructionMgr.CanMergeRoom):
 * a left/right room of the same type + same level, total merge ≤ 3. Returns the absorbable
 * neighbour id on success.
 */
export function canMergeRoom(
  layout: Layout,
  id: number,
): ValidationResult & { neighbourId?: number } {
  const node = layout.byId.get(id);
  if (!node) return fail('Room not found.');
  if (node.isElevator) return fail('Elevators cannot be merged.');
  if (node.mergeLevel >= MAX_MERGE_LEVEL) return fail('This room is already at maximum width.');

  const cells = occupancy(layout.nodes);
  const left = cells.get(`${node.row},${node.col - 1}`);
  const right = cells.get(`${node.row},${node.colEnd}`);
  for (const nb of [left, right]) {
    if (
      nb &&
      nb.deserializeID !== node.deserializeID &&
      nb.type === node.type &&
      nb.level === node.level &&
      node.mergeLevel + nb.mergeLevel <= MAX_MERGE_LEVEL
    ) {
      return { ok: true, neighbourId: nb.deserializeID };
    }
  }
  return fail('No matching same-level neighbour of the same type to merge with.');
}

/** Whether a room level is within the type's legal range (1..maxLevel from room metadata). */
export function canSetRoomLevel(maxLevel: number, level: number): ValidationResult {
  if (level < 1 || level > maxLevel) return fail(`Level must be 1–${maxLevel}.`);
  return OK;
}

/**
 * Full-layout integrity check: no overlaps, every room reaches the entrance, all in bounds.
 * Used as a safety net (and to assert real saves are self-consistent in tests).
 */
export function validateLayout(layout: Layout): ValidationResult {
  const overlap = findOverlap(layout.nodes);
  if (overlap) {
    return fail(
      `Rooms overlap at floor ${overlap.a.row} (#${overlap.a.deserializeID}/#${overlap.b.deserializeID}).`,
    );
  }
  const cells = occupancy(layout.nodes);
  for (const n of layout.nodes) {
    if (n.row < 0 || n.row >= layout.rows || n.col < 0 || n.colEnd > layout.cols) {
      return fail(`Room #${n.deserializeID} is out of bounds.`);
    }
    if (n.type !== ENTRANCE_TYPE && !reachesEntrance(layout.nodes, n, cells)) {
      return fail(`Room #${n.deserializeID} (${n.type}) cannot reach the entrance.`);
    }
  }
  return OK;
}

export type { RoomNode };
