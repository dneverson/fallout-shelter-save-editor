import { useMemo, type ReactElement } from 'react';
import type { Column } from '@tanstack/react-table';
import { Popover } from './Popover.tsx';

// Per-column filter control. The variant is declared on the
// column via `meta.filterVariant`: `text` (substring), `range` (numeric min/max,
// faceted bounds), or `select` (multi-select over the column's faceted unique
// values). Rendered behind a funnel button in the header so narrow columns (e.g.
// the SPECIAL stats) stay readable; the button highlights when a filter is active.

type RangeValue = [number | undefined, number | undefined];

function isActive(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some((v) => v !== undefined && v !== '');
  return value !== '';
}

/** Funnel glyph so the control reads as "filter" instead of the old cryptic ⏷. */
function FunnelIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M1.5 2.5h13a.5.5 0 0 1 .4.8L10 9.2V13a.5.5 0 0 1-.28.45l-2.5 1.2A.5.5 0 0 1 6.5 14V9.2L1.1 3.3a.5.5 0 0 1 .4-.8Z" />
    </svg>
  );
}

export function ColumnFilter<T>({ column }: { column: Column<T, unknown> }): ReactElement | null {
  const variant = column.columnDef.meta?.filterVariant;
  if (!variant) return null;

  const active = isActive(column.getFilterValue());
  const label = column.columnDef.meta?.headerLabel ?? column.id;
  const canSort = column.getCanSort();
  const sorted = column.getIsSorted();

  return (
    <Popover
      align="start"
      className="w-52"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={`Filter ${label}`}
          aria-pressed={active}
          title={active ? `Filtering ${label}` : `Filter ${label}`}
          className={`rounded p-0.5 ${
            active ? 'text-amber-400' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <FunnelIcon />
        </button>
      )}
    >
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
          Filter: <span className="text-neutral-200">{label}</span>
        </p>

        {canSort && (
          <div className="flex gap-1">
            {(
              [
                ['asc', 'Sort ↑', false],
                ['desc', 'Sort ↓', true],
              ] as const
            ).map(([key, text, desc]) => (
              <button
                key={key}
                type="button"
                onClick={() => column.toggleSorting(desc)}
                aria-pressed={sorted === key}
                className={`flex-1 rounded border px-2 py-1 text-xs ${
                  sorted === key
                    ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                    : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
                }`}
              >
                {text}
              </button>
            ))}
          </div>
        )}

        {variant === 'text' && <TextFilter column={column} />}
        {variant === 'range' && <RangeFilter column={column} />}
        {variant === 'select' && <SelectFilter column={column} />}

        <button
          type="button"
          disabled={!active}
          onClick={() => column.setFilterValue(undefined)}
          className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear filter
        </button>
      </div>
    </Popover>
  );
}

function TextFilter<T>({ column }: { column: Column<T, unknown> }): ReactElement {
  const value = (column.getFilterValue() as string | undefined) ?? '';
  return (
    <input
      type="text"
      autoFocus
      value={value}
      onChange={(e) => column.setFilterValue(e.target.value || undefined)}
      placeholder="Contains…"
      aria-label={`${column.id} contains`}
      className="w-40 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
    />
  );
}

function RangeFilter<T>({ column }: { column: Column<T, unknown> }): ReactElement {
  const [facetMin, facetMax] = column.getFacetedMinMaxValues() ?? [undefined, undefined];
  const value = (column.getFilterValue() as RangeValue | undefined) ?? [undefined, undefined];

  const update = (next: RangeValue): void => {
    column.setFilterValue(next[0] === undefined && next[1] === undefined ? undefined : next);
  };
  const parse = (raw: string): number | undefined => (raw === '' ? undefined : Number(raw));

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={value[0] ?? ''}
        onChange={(e) => update([parse(e.target.value), value[1]])}
        placeholder={facetMin === undefined ? 'min' : `≥ ${facetMin}`}
        aria-label={`${column.id} minimum`}
        className="w-16 rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-sm text-neutral-100"
      />
      <span className="text-neutral-400">–</span>
      <input
        type="number"
        value={value[1] ?? ''}
        onChange={(e) => update([value[0], parse(e.target.value)])}
        placeholder={facetMax === undefined ? 'max' : `≤ ${facetMax}`}
        aria-label={`${column.id} maximum`}
        className="w-16 rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-sm text-neutral-100"
      />
    </div>
  );
}

function SelectFilter<T>({ column }: { column: Column<T, unknown> }): ReactElement {
  const faceted = column.getFacetedUniqueValues();
  const options = useMemo(
    () =>
      Array.from(faceted.keys())
        .filter((k) => k !== '' && k != null)
        .map((k) => String(k))
        .sort(),
    [faceted],
  );
  const selected = (column.getFilterValue() as string[] | undefined) ?? [];

  const toggle = (option: string): void => {
    const next = selected.includes(option)
      ? selected.filter((s) => s !== option)
      : [...selected, option];
    column.setFilterValue(next.length === 0 ? undefined : next);
  };

  if (options.length === 0) {
    return <p className="px-1 text-xs text-neutral-400">No values</p>;
  }

  return (
    <ul className="max-h-56 w-44 overflow-auto">
      {options.map((option) => (
        <li key={option}>
          <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-neutral-200 hover:bg-neutral-800">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() => toggle(option)}
            />
            <span className="truncate">{option}</span>
            <span className="ml-auto text-xs text-neutral-400">{faceted.get(option) ?? ''}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
