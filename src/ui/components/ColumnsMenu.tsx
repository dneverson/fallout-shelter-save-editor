import type { VisibilityState } from '@tanstack/react-table';
import { Popover } from './Popover.tsx';

// Column visibility + reorder menu for a roster table (reorderable/hideable).
// Prop-driven so both the Dwellers and Pets tables reuse it,
// each binding its own persisted uiStore slice. Reorder uses up/down buttons rather
// than drag-and-drop - full control without the drag complexity; any `pinned` columns
// (e.g. the select checkbox / sprite) stay fixed at the front of the order.

interface ColumnsMenuProps {
  /** Hideable/reorderable columns, in their natural order. */
  hideable: ReadonlyArray<{ id: string; label: string }>;
  /** The table's full natural column order (pinned columns first). */
  fullOrder: readonly string[];
  /** Columns pinned at the front of the order, never hidden/moved (default none). */
  pinned?: readonly string[];
  visibility: VisibilityState;
  setVisibility: (visibility: VisibilityState) => void;
  order: string[];
  setOrder: (order: string[]) => void;
}

export function ColumnsMenu({
  hideable,
  fullOrder,
  pinned = [],
  visibility,
  setVisibility,
  order,
  setOrder,
}: ColumnsMenuProps) {
  const labelById = new Map(hideable.map((c) => [c.id, c.label]));
  const baseOrder = order.length > 0 ? order : fullOrder;
  const ordered = baseOrder.filter((id) => labelById.has(id));

  const isShown = (id: string): boolean => visibility[id] !== false;
  const toggle = (id: string): void => setVisibility({ ...visibility, [id]: !isShown(id) });

  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder([...pinned, ...next]);
  };

  return (
    <Popover
      align="end"
      trigger={({ toggle: open }) => (
        <button
          type="button"
          onClick={open}
          className="rounded border border-neutral-700 px-2 py-1 text-sm text-neutral-300 hover:bg-neutral-800"
        >
          Columns
        </button>
      )}
    >
      <ul className="max-h-80 w-56 overflow-auto">
        {ordered.map((id, index) => (
          <li key={id} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-neutral-800">
            <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-neutral-200">
              <input type="checkbox" checked={isShown(id)} onChange={() => toggle(id)} />
              <span className="truncate">{labelById.get(id)}</span>
            </label>
            <button
              type="button"
              aria-label={`Move ${labelById.get(id)} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
              className="px-1 text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-30"
            >
              ▲
            </button>
            <button
              type="button"
              aria-label={`Move ${labelById.get(id)} down`}
              disabled={index === ordered.length - 1}
              onClick={() => move(index, 1)}
              className="px-1 text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-30"
            >
              ▼
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
