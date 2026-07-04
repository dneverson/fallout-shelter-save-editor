// Shared Radix `Dialog.Content` shells so every modal uses ONE of two consistent sizes
// instead of ad-hoc per-dialog widths (which had drifted to eight different values).
// Compose with a per-dialog padding utility (`p-5` / `p-6`).
//
// The LARGE shell is viewport-relative (vw/vh) on purpose: content modals GROW with the
// window, so enlarging it reveals more table rows/columns rather than capping at a fixed
// box. Each large modal owns an internal `min-h-0 flex-1 overflow-auto` body, so the
// fixed height just sets how much of the table is visible before it scrolls.

// z-50: modals must paint above the mobile detail-panel overlay (z-40) and any view
// content; without an explicit z-index a fixed z-40 sibling would cover them.
const MODAL_CHROME =
  'fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-100 shadow-xl';

/** Tables, pickers, review lists - large + responsive, with internal scroll. */
export const MODAL_LARGE = `${MODAL_CHROME} h-[85vh] w-[85vw]`;

/** Rich info panels (credits, walkthroughs) - wider than SMALL, no internal table. */
export const MODAL_MEDIUM = `${MODAL_CHROME} max-h-[85vh] w-[min(92vw,46rem)]`;

/** Confirmations, short info, short forms - compact, sized to their content. */
export const MODAL_SMALL = `${MODAL_CHROME} max-h-[85vh] w-[min(90vw,32rem)]`;
