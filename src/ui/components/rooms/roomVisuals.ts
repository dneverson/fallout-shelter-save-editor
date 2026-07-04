// Presentation helpers for the Rooms Map - pure, no JSX, so the grid +
// side panel can import freely without tripping react-refresh. Colour rooms by their
// ERoomClass so the map reads at a glance (no colour-only signalling: each block also
// shows its name + level).

/** Cell size in px for the floor grid (rooms are ~1:2, matching the game's aspect). */
export const CELL_W = 24;
export const CELL_H = 46;

/**
 * Map a client (viewport) point to a grid cell, given the grid container's bounding rect.
 * Shared by the grid's own pointer-drag and the palette drag-to-build so both snap the same
 * way. Returns row/col in cell units (may be out of range - callers clamp).
 */
export function cellFromClient(
  rect: DOMRect,
  clientX: number,
  clientY: number,
): { row: number; col: number } {
  return {
    row: Math.floor((clientY - rect.top) / CELL_H),
    col: Math.floor((clientX - rect.left) / CELL_W),
  };
}

/** Tailwind classes (bg + border + text) for a room block, keyed by ERoomClass. */
export function roomClassStyle(roomClass: string | undefined): string {
  switch (roomClass) {
    case 'Production':
      return 'bg-emerald-900/70 border-emerald-600 text-emerald-100';
    case 'Facility':
      return 'bg-sky-900/70 border-sky-600 text-sky-100';
    case 'Training':
      return 'bg-violet-900/70 border-violet-600 text-violet-100';
    case 'Crafting':
      return 'bg-amber-900/70 border-amber-600 text-amber-100';
    case 'Consumable':
      return 'bg-rose-900/70 border-rose-600 text-rose-100';
    case 'Quest':
      return 'bg-fuchsia-900/70 border-fuchsia-600 text-fuchsia-100';
    case 'Elevator':
    case 'Utility':
      return 'bg-neutral-800 border-neutral-600 text-neutral-300';
    default:
      return 'bg-stone-800 border-stone-600 text-stone-200';
  }
}
