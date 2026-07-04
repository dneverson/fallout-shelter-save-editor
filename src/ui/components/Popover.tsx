import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Minimal click-away popover (no extra dependency). Radix Dialog is reserved for
// true modal flows; column-filter and column-visibility menus just need a small
// anchored panel that closes on outside-click or Escape.

interface PopoverProps {
  /** Renders the trigger; `open` reflects state, `toggle` opens/closes the panel. */
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  className?: string;
}

export function Popover({ trigger, children, align = 'start', className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Keep the panel inside its clipping container: the table that hosts column filters clips
  // its X axis (`overflow-x-clip`, to contain the sticky header), so a right-edge column's
  // panel would be cut off horizontally. Measure on open and shift it left by however much it
  // overflows the nearest X-clipping ancestor (falling back to the viewport). The Y axis is
  // intentionally left visible there, so the panel opens down freely past a short table body.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    panel.style.transform = '';
    let clipRight = document.documentElement.clientWidth;
    for (let el = panel.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX + style.overflow)) {
        clipRight = Math.min(clipRight, el.getBoundingClientRect().right);
        break;
      }
    }
    const overflow = panel.getBoundingClientRect().right - (clipRight - 4);
    if (overflow > 0) panel.style.transform = `translateX(${-overflow}px)`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          ref={panelRef}
          className={`absolute z-30 mt-1 min-w-44 rounded border border-neutral-700 bg-neutral-900 p-2 shadow-xl ${
            align === 'end' ? 'right-0' : 'left-0'
          } ${className ?? ''}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
