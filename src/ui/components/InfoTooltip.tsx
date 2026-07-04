import { useCallback, useId, useRef, useState, type ReactNode } from 'react';

// Accessible "what this does in-game" tooltip. A small focusable info
// icon that reveals help on hover AND keyboard focus, wired to the trigger via
// aria-describedby. Hand-rolled to match the project's existing custom Popover -
// no extra dependency. The bubble renders position:FIXED (viewport coordinates) so no
// scrolling/overflow ancestor (detail sheets, table panes) can clip it - it previously
// used absolute positioning and got cut off inside the dweller sheet.

// Gap kept between the bubble and the viewport edge when it has to be nudged inward.
const EDGE_MARGIN = 8;

export function InfoTooltip({
  text,
  label = 'What this does in-game',
}: {
  text: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  // Fixed-position coordinates for the bubble; null until measured (first paint renders
  // the bubble invisibly off-screen so its width can be read).
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  // Measured via a ref callback (runs at commit, before paint) so the bubble never paints
  // off-screen: center it under the trigger, then clamp to the viewport edges.
  const measure = useCallback((node: HTMLSpanElement | null) => {
    const btn = buttonRef.current;
    if (!node || !btn) return;
    const rect = btn.getBoundingClientRect();
    const width = node.offsetWidth;
    const vw = document.documentElement.clientWidth;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - width / 2, EDGE_MARGIN),
      vw - EDGE_MARGIN - width,
    );
    const top = rect.bottom + 4;
    setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
  }, []);

  const show = (): void => setOpen(true);
  const hide = (): void => {
    setOpen(false);
    setPos(null);
  };

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-neutral-600 text-[9px] font-semibold leading-none text-neutral-400 hover:border-neutral-400 hover:text-neutral-200 focus:border-amber-500 focus:text-amber-300 focus:outline-none"
      >
        i
      </button>
      {open && (
        <span
          ref={measure}
          id={id}
          role="tooltip"
          style={pos ? { position: 'fixed', top: pos.top, left: pos.left } : undefined}
          className={`z-50 w-56 rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs font-normal normal-case leading-relaxed tracking-normal text-neutral-200 shadow-lg ${
            pos ? '' : 'fixed left-0 top-0 invisible'
          }`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
