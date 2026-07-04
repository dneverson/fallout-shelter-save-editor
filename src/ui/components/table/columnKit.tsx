import type { ColumnDef, FilterFn, Table } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import type { ItemIconType } from '../../../domain/gamedata/visualSchemas.ts';
import { ItemIcon } from '../ItemIcon.tsx';
import { IndeterminateCheckbox, RowSelectCheckbox } from '../dwellers/dwellerCells.tsx';
import { TableActionButton } from './tableCells.tsx';

// Shared, type-agnostic column primitives for the unified table system. Every table's
// column registry (and every location that wraps one) composes from these instead of
// re-declaring a select checkbox, a leading sprite, a status badge, or an actions cell -
// the duplication that let the per-type tables drift apart. Pure factories: each returns a
// plain `ColumnDef`; the only stateful cells (the selection checkboxes) are imported
// components. Exports are all non-components, so this file stays Fast-Refresh clean.

/** Select filter: keep rows whose (stringified) cell value is in the chosen set. */
export function inSelectedSet<T>(): FilterFn<T> {
  return (row, columnId, filterValue) => {
    if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
    return (filterValue as string[]).includes(String(row.getValue(columnId)));
  };
}

/** Lightly humanize an EBonusEffect id for display (e.g. "DamageBoost" → "Damage Boost"). */
export const prettyBonus = (bonus: string): string => bonus.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

/** A truncating text cell with the full value shown on hover. */
export function nameCell(value: string): ReactNode {
  return <span title={value}>{value}</span>;
}

/**
 * Leading multi-select checkbox column (header = select-all, cells = per-row checkbox with
 * shift-click range select). Pinned + non-hideable. `getLabel` builds each row's aria-label.
 */
export function selectColumn<T>(getLabel: (row: T) => string): ColumnDef<T> {
  return {
    id: 'select',
    header: ({ table }: { table: Table<T> }) => (
      <IndeterminateCheckbox
        label="Select all"
        checked={table.getIsAllRowsSelected()}
        indeterminate={table.getIsSomeRowsSelected()}
        onChange={table.getToggleAllRowsSelectedHandler()}
      />
    ),
    cell: ({ row, table }) => (
      <RowSelectCheckbox row={row} table={table} label={`Select ${getLabel(row.original)}`} />
    ),
    size: 44,
    enableSorting: false,
    enableHiding: false,
    enableColumnFilter: false,
  };
}

/**
 * Leading item-sprite column. `resolve` maps a row to its atlas group + id (or null to show
 * `fallback`, e.g. a neutral chip for theme recipes that have no item sprite).
 */
export function iconColumn<T>(
  resolve: (row: T) => { type: ItemIconType; id: string } | null,
  fallback: ReactNode = null,
): ColumnDef<T> {
  return {
    id: 'icon',
    header: '',
    cell: ({ row }) => {
      const ref = resolve(row.original);
      return ref ? <ItemIcon type={ref.type} id={ref.id} /> : fallback;
    },
    size: 44,
    enableSorting: false,
    enableColumnFilter: false,
    // Icon-only cell: drop the default `truncate` so a sprite slightly wider than its padded
    // cell doesn't paint a stray ellipsis after it.
    meta: { cellClassName: '' },
  };
}

/**
 * A leading non-interactive status badge (e.g. "Equipped" / "Selected" / "Wearing"): a
 * small pill on rows matching `predicate`, blank otherwise. Pinned + non-hideable.
 */
export function badgeColumn<T>({
  id,
  label,
  predicate,
  tone = 'amber',
  size = 96,
}: {
  id: string;
  label: string;
  predicate: (row: T) => boolean;
  tone?: 'amber' | 'emerald';
  size?: number;
}): ColumnDef<T> {
  const toneClass =
    tone === 'emerald' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300';
  return {
    id,
    header: '',
    cell: ({ row }) =>
      predicate(row.original) ? (
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${toneClass}`}
        >
          {label}
        </span>
      ) : null,
    size,
    enableSorting: false,
    enableColumnFilter: false,
  };
}

/** A single per-row action descriptor consumed by {@link actionsColumn}. */
export interface RowAction<T> {
  /** Visible button text. */
  text: ReactNode;
  /** Accessible label, built per row (omit to fall back to the visible text). */
  ariaLabel?: (row: T) => string;
  tone?: 'emerald' | 'sky' | 'red' | 'neutral';
  onClick: (row: T) => void;
  /** Hide this action on a given row (e.g. junk has no "Equip…"). */
  hidden?: (row: T) => boolean;
  /** Disable this action on a given row (e.g. the storage-capacity guardrail). */
  disabled?: (row: T) => boolean;
  /** Hover tooltip, e.g. to explain a disabled action. */
  title?: (row: T) => string | undefined;
}

/**
 * Trailing actions column: a right-aligned row of {@link TableActionButton}s built from
 * `actions`. Replaces the bespoke Add/Equip…/Remove cells that each table hand-rolled.
 */
export function actionsColumn<T>(
  actions: ReadonlyArray<RowAction<T>>,
  { id = 'actions', size = 120 }: { id?: string; size?: number } = {},
): ColumnDef<T> {
  return {
    id,
    header: '',
    cell: ({ row }) => (
      <div className="flex justify-end gap-1.5">
        {actions
          .filter((a) => !a.hidden?.(row.original))
          .map((a, i) => (
            <TableActionButton
              key={i}
              {...(a.tone ? { tone: a.tone } : {})}
              {...(a.ariaLabel ? { label: a.ariaLabel(row.original) } : {})}
              {...(() => {
                const t = a.title?.(row.original);
                return t ? { title: t } : {};
              })()}
              disabled={a.disabled?.(row.original) ?? false}
              onClick={() => a.onClick(row.original)}
            >
              {a.text}
            </TableActionButton>
          ))}
      </div>
    ),
    size,
    enableSorting: false,
    enableColumnFilter: false,
  };
}
