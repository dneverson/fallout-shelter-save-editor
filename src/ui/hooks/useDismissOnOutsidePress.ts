import { useEffect } from 'react';

// Shared dismissal for the Rooms screen's sticky modes (build, terrain paint, armed
// Mr. Handy): while a mode is active, a pointer-down anywhere the mode's own targets
// don't claim exits it - clicking blank grid space, another room, the side panel, or
// the nav all deselect, matching the room build/move behavior (UX-G). Each mode's
// toggle control handles its own second-click-deselects.

/**
 * While `active`, any document pointer-down whose target `isOwnTarget` does not claim
 * calls `dismiss`. Both callbacks must be referentially stable (useCallback) so the
 * listener isn't re-attached every render.
 */
export function useDismissOnOutsidePress(
  active: boolean,
  isOwnTarget: (target: HTMLElement) => boolean,
  dismiss: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target || isOwnTarget(target)) return;
      dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [active, isOwnTarget, dismiss]);
}
