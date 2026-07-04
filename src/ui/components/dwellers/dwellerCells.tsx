import { useEffect, useMemo, useRef, type ChangeEventHandler } from 'react';
import type { Row, Table } from '@tanstack/react-table';
import { selectDwellerById, type DwellerRow } from '../../../domain/selectors/dwellerSelectors.ts';
import { useSaveStore } from '../../../state/saveStore.ts';
import { useVisualAssets } from '../../hooks/useVisualAssets.ts';
import { useDwellerThumbnail } from '../../hooks/useDwellerThumbnail.ts';
import { toRenderableDweller } from '../../../render/dwellerAppearance.ts';

// Stateful cell components for the Dwellers roster, kept in their own module so the column
// factories (table/columnKit.tsx, table/schemas/dwellerSchema.tsx) - which export data, not
// components - stay Fast-Refresh clean.

/** A checkbox that can show the tri-state "some but not all selected" dash. */
export function IndeterminateCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !checked && !!indeterminate;
  }, [checked, indeterminate]);
  return (
    <input ref={ref} type="checkbox" aria-label={label} checked={checked} onChange={onChange} />
  );
}

// Per-table "anchor" row for shift-click range selection: the last row toggled with a
// plain click. Keyed by the (stable) table instance so each table tracks its own anchor;
// a WeakMap lets the entry be collected with the table. Lives at module scope because the
// per-row checkbox unmounts/remounts as rows virtualize - the anchor must outlive any one row.
const rangeAnchorByTable = new WeakMap<object, string>();

/**
 * Per-row selection checkbox with shift-click range select (works in every multi-select
 * table). A plain click toggles one row and sets it as the anchor; shift-clicking another
 * row selects/deselects every row between the anchor and the click - in the table's CURRENT
 * sorted/filtered order - to match the clicked row's new state. `onClick` (a MouseEvent,
 * which fires before `onChange`) is the only reliable place to read the shift modifier, so
 * it's stashed in a ref for `onChange` to consume. Keyboard toggling (no click) stays a
 * plain single toggle.
 */
export function RowSelectCheckbox<T>({
  row,
  table,
  label,
}: {
  row: Row<T>;
  table: Table<T>;
  label: string;
}) {
  const shiftRef = useRef(false);

  const onChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const checked = e.target.checked;
    const anchorId = rangeAnchorByTable.get(table);
    if (shiftRef.current && anchorId != null && anchorId !== row.id) {
      const rows = table.getRowModel().rows;
      const from = rows.findIndex((r) => r.id === anchorId);
      const to = rows.findIndex((r) => r.id === row.id);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        const updates: Record<string, boolean> = {};
        for (let i = lo; i <= hi; i++) {
          if (rows[i].getCanSelect()) updates[rows[i].id] = checked;
        }
        table.setRowSelection((old) => ({ ...old, ...updates }));
        rangeAnchorByTable.set(table, row.id);
        return;
      }
    }
    row.toggleSelected(checked);
    rangeAnchorByTable.set(table, row.id);
  };

  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={row.getIsSelected()}
      onChange={onChange}
      onClick={(e) => {
        shiftRef.current = e.shiftKey;
        e.stopPropagation();
      }}
    />
  );
}

/**
 * Roster avatar cell. Reads its own raw dweller from the store (so only the edited
 * row re-renders, not the whole table) and renders a cached mini-figure via the shared
 * offscreen renderer. Falls back to the grey placeholder while loading or on failure,
 * so the table never blocks. Decorative - the dweller's name lives in its own column.
 */
export function DwellerThumbnailCell({ serializeId }: { serializeId: number }) {
  const dweller = useSaveStore((s) =>
    s.save ? selectDwellerById(s.save, serializeId) : undefined,
  );
  const { assets } = useVisualAssets();
  // Memoize on the raw dweller ref (stable across renders thanks to structural sharing)
  // so the hook's appearance key only churns when this dweller actually changes.
  const renderable = useMemo(() => (dweller ? toRenderableDweller(dweller) : null), [dweller]);
  const url = useDwellerThumbnail(renderable, assets);

  return (
    <div className="h-7 w-7 overflow-hidden rounded bg-neutral-800" aria-hidden="true">
      {url && <img src={url} alt="" className="h-full w-full object-contain" />}
    </div>
  );
}

/** Health cell: shows hp / maxHp, or a Dead tag + inline Revive for the deceased. */
export function HealthCell({
  row,
  onRevive,
}: {
  row: Row<DwellerRow>;
  onRevive: (serializeId: number) => void;
}) {
  const { health, maxHealth, isDead, serializeId } = row.original;
  if (isDead) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-xs font-medium text-red-300">
          Dead
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRevive(serializeId);
          }}
          className="rounded border border-emerald-700 px-1.5 py-0.5 text-xs text-emerald-300 hover:bg-emerald-900/40"
        >
          Revive
        </button>
      </div>
    );
  }
  return (
    <span className="tabular-nums">
      {health ?? '–'}
      {maxHealth != null ? ` / ${maxHealth}` : ''}
    </span>
  );
}
