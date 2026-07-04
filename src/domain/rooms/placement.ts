import { ELEVATOR_TYPE, type Layout } from './layout.ts';
import { canBuildRoom, canMoveRoom } from './validator.ts';

// Pure helpers for the Build palette: a room type's natural footprint and the set of
// grid cells where it can legally be dropped (every cell the validator approves). Kept out
// of the view so it's node-testable and the grid stays a thin renderer.

/**
 * The mergeLevel a freshly-built room of `type` occupies. Most rooms are built as a single
 * small room (mergeLevel 1) and merged later; rooms that are inherently wider (Overseer = 6
 * cells, the crafting workshops = 9 cells) are built at their fixed footprint = `width / 3`.
 * Elevators are always 1 cell.
 */
export function baseMergeLevel(type: string, metaWidth: number | undefined): number {
  if (type === ELEVATOR_TYPE) return 1;
  if (!metaWidth || metaWidth < 3) return 1;
  return Math.max(1, Math.round(metaWidth / 3));
}

/** Every legal build origin ("row,col") for `type` at `mergeLevel` over the given layout. */
export function validBuildOrigins(layout: Layout, type: string, mergeLevel: number): Set<string> {
  const out = new Set<string>();
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      if (canBuildRoom(layout, { type, row, col, mergeLevel }).ok) out.add(`${row},${col}`);
    }
  }
  return out;
}

/**
 * Every legal drop origin ("row,col") for moving the room `id` to, per the layout
 * VALIDATOR (`canMoveRoom`) - the move analog of `validBuildOrigins`, used by the Rooms grid
 * to surface drag drop targets. The room's current origin is included (a same-spot drop is a
 * legal no-op). Returns an empty set if `id` isn't in the layout.
 */
export function validMoveTargets(layout: Layout, id: number): Set<string> {
  const out = new Set<string>();
  if (!layout.byId.has(id)) return out;
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      if (canMoveRoom(layout, id, row, col).ok) out.add(`${row},${col}`);
    }
  }
  return out;
}
