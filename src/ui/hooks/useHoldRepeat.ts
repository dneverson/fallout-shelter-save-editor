import { useCallback, useEffect, useRef } from 'react';

// Press-and-hold auto-repeat for stepper buttons ([-]/[+] counters). A single tap fires
// once; holding the button waits an initial delay then repeats at a steady interval - the
// OS key-repeat feel, so bumping a count by 50 no longer means 50 clicks. Every counter in
// the app (NumberField, storage CountCell) shares this one hook.
//
// Design notes:
//  - Repeat is driven by pointer events (mouse/touch/pen). The single-step `onClick` is
//    KEPT so keyboard activation (Enter/Space, which fires click but no pointer events)
//    still works; a mouse-hold's trailing click is suppressed so it doesn't add one extra.
//  - The action lives in a ref refreshed every render, so each repeat tick reads the LATEST
//    committed value rather than the value captured when the hold began - without this the
//    counter sticks after the first step (stale-closure bug).

interface HoldRepeatOptions {
  /** Milliseconds to hold before auto-repeat begins (default 400). */
  initialDelay?: number;
  /** Milliseconds between repeats once started (default 60). */
  interval?: number;
  /** When true the control does nothing (matches the button's disabled state). */
  disabled?: boolean;
}

export interface HoldRepeatHandlers {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onClick: () => void;
}

/** Returns button handlers that run `action` once on tap and repeatedly while held. */
export function useHoldRepeat(
  action: () => void,
  options: HoldRepeatOptions = {},
): HoldRepeatHandlers {
  const { initialDelay = 400, interval = 60, disabled = false } = options;

  // Keep the latest action in a ref (synced after each commit) so a repeat tick reads the
  // freshly committed value, not the value captured when the hold began.
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  });

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // True once a hold has auto-repeated, so the trailing mouse `click` is swallowed.
  const repeatedRef = useRef(false);

  const stop = useCallback((): void => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback((): void => {
    if (disabled) return;
    repeatedRef.current = false; // reset per press so a prior hold can't leak suppression
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        repeatedRef.current = true;
        actionRef.current();
      }, interval);
    }, initialDelay);
  }, [disabled, initialDelay, interval]);

  // Clear any pending timers if the button unmounts mid-hold.
  useEffect(() => stop, [stop]);

  const onClick = useCallback((): void => {
    if (repeatedRef.current) {
      repeatedRef.current = false; // this click is the tail of a hold - already counted
      return;
    }
    if (!disabled) actionRef.current();
  }, [disabled]);

  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick,
  };
}
