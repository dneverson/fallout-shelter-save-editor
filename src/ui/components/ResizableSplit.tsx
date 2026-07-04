import { useRef, useState, type CSSProperties, type ReactNode } from 'react';

// Reusable two-pane split with a draggable divider (UI/UX audit UX-B finding 1). A
// flexible left pane (the table / grid) and a fixed-but-resizable right pane (the
// detail sheet). Domain-agnostic: the Dwellers, Pets, and Rooms screens all reuse it,
// supplying their own panes, persisted width, and clamp bounds. The divider is keyboard
// operable (role="separator", arrow keys) so resizing isn't mouse-only.
//
// When `right` is null the split collapses to just the left pane filling the row - so a
// view can mount it unconditionally and the table reflows naturally when no row is
// selected, without duplicating the left markup.

const DEFAULT_KEY_STEP = 16;
/** Keep at least this much room for the left pane when dragging the divider. */
const MIN_LEFT_PX = 280;

export interface ResizableSplitProps {
  left: ReactNode;
  /** Right (detail) pane; when null the divider + sized pane are not rendered. */
  right: ReactNode;
  /** Controlled width of the right pane, in px. */
  width: number;
  onWidthChange: (width: number) => void;
  min?: number;
  max?: number;
  /** Accessible name for the divider handle. */
  ariaLabel: string;
}

export function ResizableSplit({
  left,
  right,
  width,
  onWidthChange,
  min = 280,
  max = 720,
  ariaLabel,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // Clamp a desired right-pane width to [min, max] and to leaving MIN_LEFT_PX for the
  // left pane within the current container width.
  const clamp = (desired: number): number => {
    const containerW = containerRef.current?.getBoundingClientRect().width ?? Infinity;
    const upper = Math.min(max, Math.max(min, containerW - MIN_LEFT_PX));
    return Math.round(Math.min(upper, Math.max(min, desired)));
  };

  const commit = (desired: number): void => {
    const next = clamp(desired);
    if (next !== width) onWidthChange(next);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    // Only the primary button initiates a drag.
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);

    const onMove = (ev: PointerEvent): void => {
      // Divider sits to the LEFT of the right pane: dragging left grows it.
      commit(startWidth - (ev.clientX - startX));
    };
    const onUp = (ev: PointerEvent): void => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      setDragging(false);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      commit(width + DEFAULT_KEY_STEP);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      commit(width - DEFAULT_KEY_STEP);
    } else if (e.key === 'Home') {
      e.preventDefault();
      commit(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      commit(max);
    }
  };

  if (!right) {
    return (
      <div ref={containerRef} className="flex h-full min-h-0 w-full">
        {left}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full min-h-0 w-full">
      {left}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={ariaLabel}
        aria-valuenow={Math.round(width)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className={`group relative hidden w-1 shrink-0 cursor-col-resize touch-none focus:outline-none md:block ${
          dragging ? 'bg-amber-500' : 'bg-neutral-800 hover:bg-amber-600/70'
        } focus-visible:bg-amber-500`}
      >
        {/* Wider invisible hit area so the 1px bar is easy to grab. */}
        <span aria-hidden="true" className="absolute inset-y-0 -left-1.5 -right-1.5" />
      </div>
      {/* Detail pane: a resizable side panel on md+ screens; a full-screen overlay on
          phones (the pane's own Close button dismisses it), so neither pane is crushed. */}
      <div
        className="fixed inset-0 z-40 flex min-h-0 overflow-y-auto bg-neutral-950 md:static md:z-auto md:w-[var(--split-w)] md:shrink-0 md:overflow-visible"
        style={{ '--split-w': `${width}px` } as CSSProperties}
      >
        {right}
      </div>
    </div>
  );
}
