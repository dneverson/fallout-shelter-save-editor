import {
  cloneElement,
  useCallback,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

// Accessible "what this does in-game" tooltips. `InfoTooltip` is a small focusable
// info icon; `HoverTooltip` makes a wrapped element (e.g. a delete button) the
// trigger itself. Both reveal help on hover AND keyboard focus, wired to the trigger
// via aria-describedby. Hand-rolled to match the project's existing custom Popover -
// no extra dependency. The bubble renders position:FIXED (viewport coordinates) so no
// scrolling/overflow ancestor (detail sheets, table panes) can clip it - it previously
// used absolute positioning and got cut off inside the dweller sheet.

// Gap kept between the bubble and the viewport edge when it has to be nudged inward.
const EDGE_MARGIN = 8;

// Shared bubble state: measured via a ref callback (runs at commit, before paint) so
// the bubble never paints off-screen - centered under the trigger, clamped to the
// viewport sides, and FLIPPED above the trigger when the bottom edge would clip it
// (bottom-of-screen triggers: the bulk bar's Remove, the sheet's Delete dweller).
function useTooltipBubble() {
  const [open, setOpen] = useState(false);
  // Fixed-position coordinates for the bubble; null until measured (first paint renders
  // the bubble invisibly off-screen so its size can be read).
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // The trigger element is held in STATE via a callback ref, not a useRef: the React
  // Compiler lint treats a hook return that carries a ref as unreadable during render.
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const id = useId();

  const measure = useCallback(
    (node: HTMLSpanElement | null) => {
      if (!node || !trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const left = Math.min(
        Math.max(rect.left + rect.width / 2 - width / 2, EDGE_MARGIN),
        vw - EDGE_MARGIN - width,
      );
      // Below the trigger; flip above when that would run past the bottom edge, then
      // clamp to the top edge - with the bubble's max-height capped at the viewport,
      // the text stays fully reachable (scrolls) instead of clipping.
      let top = rect.bottom + 4;
      if (top + height > vh - EDGE_MARGIN) top = rect.top - 4 - height;
      top = Math.max(top, EDGE_MARGIN);
      setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    },
    [trigger],
  );

  const show = (): void => setOpen(true);
  const hide = (): void => {
    setOpen(false);
    setPos(null);
  };

  return { open, pos, id, setTriggerRef: setTrigger, measure, show, hide };
}

function Bubble({
  pos,
  id,
  measure,
  text,
}: {
  pos: { top: number; left: number } | null;
  id: string;
  measure: (node: HTMLSpanElement | null) => void;
  text: ReactNode;
}) {
  return (
    <span
      ref={measure}
      id={id}
      role="tooltip"
      style={
        pos
          ? {
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              maxHeight: `calc(100vh - ${EDGE_MARGIN * 2}px)`,
            }
          : undefined
      }
      className={`z-50 w-56 overflow-y-auto rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs font-normal normal-case leading-relaxed tracking-normal text-neutral-200 shadow-lg ${
        pos ? '' : 'fixed left-0 top-0 invisible'
      }`}
    >
      {text}
    </span>
  );
}

export function InfoTooltip({
  text,
  label = 'What this does in-game',
}: {
  text: ReactNode;
  label?: string;
}) {
  const { open, pos, id, setTriggerRef, measure, show, hide } = useTooltipBubble();
  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={setTriggerRef}
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
      {open && <Bubble pos={pos} id={id} measure={measure} text={text} />}
    </span>
  );
}

/**
 * The same viewport-clamped bubble, but the wrapped element itself is the trigger
 * (replaces native `title` attributes, whose rendering of long help text the page
 * cannot control or keep on screen). The child gets aria-describedby while open, so
 * screen readers still announce the help. `className` styles the wrapper span - pass
 * `block` when the child is a full-width control.
 */
export function HoverTooltip({
  text,
  children,
  className = 'relative inline-flex',
}: {
  text: ReactNode;
  children: ReactElement<{ 'aria-describedby'?: string | undefined }>;
  className?: string;
}) {
  const { open, pos, id, setTriggerRef, measure, show, hide } = useTooltipBubble();
  return (
    <span
      ref={setTriggerRef}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {cloneElement(children, { 'aria-describedby': open ? id : undefined })}
      {open && <Bubble pos={pos} id={id} measure={measure} text={text} />}
    </span>
  );
}
