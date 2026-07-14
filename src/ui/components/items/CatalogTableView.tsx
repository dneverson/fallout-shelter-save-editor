import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { UnifiedTable } from '../table/UnifiedTable.tsx';
import { actionsColumn, selectColumn } from '../table/columnKit.tsx';
import { CountCell } from '../storage/storageCells.tsx';
import type { TableSchema } from '../table/tableSchema.ts';
import type { GameDataStatus } from '../../hooks/useGameData.ts';

/** A catalog id plus the per-row quantity to grant to storage. */
export interface CatalogAddItem {
  id: string;
  count: number;
}

// The per-row "quantity to add" cell owns its OWN display state and only reports the value
// up to a ref. That keeps the trailing column defs from being recreated on every step -
// which would churn the table's column model and stop a press-and-hold mid-repeat - while
// the count still survives a virtualized remount (it re-seeds from `initial`).
export function CatalogCountCell({
  initial,
  onChange,
}: {
  initial: number;
  onChange: (count: number) => void;
}) {
  const [count, setCount] = useState(initial);
  return (
    <CountCell
      min={1}
      value={count}
      onCommit={(c) => {
        setCount(c);
        onChange(c);
      }}
    />
  );
}

// Generic standalone item-catalog browser. Renders the
// type's source-of-truth <TableSchema> through the unified <UnifiedTable> as a read-only
// REFERENCE that also carries actions: multi-select rows → "Add to storage" (bulk), a
// per-row "Add" (single item, one click), and a per-row "Equip…" that the parent view
// wires to its slot-specific <EquipOnDwellersDialog> (single item → multiple dwellers).
// Junk omits `onEquip` (it can't be equipped) but still gets per-row Add. Search + row
// selection are session-only; the column layout (visibility/order/sort/size) persists per
// `persistKey` and is editable via the Columns button. jsdom has no layout, so tests pass
// `virtualized={false}`.

export interface CatalogTableViewProps<T> {
  title: string;
  /** Plural noun for the count label, e.g. "weapons". */
  unitNoun: string;
  data: T[];
  /** The type's full column schema (source of truth). */
  schema: TableSchema<T>;
  /** Persistence key for this catalog's column layout. */
  persistKey: string;
  /** Hideable column ids visible by default; omit to show all. */
  preset?: readonly string[];
  getRowId: (row: T) => string;
  /** Human label for an item row, used in checkbox + action aria-labels. Defaults to the id. */
  getRowLabel?: (row: T) => string;
  searchLabel: string;
  searchPlaceholder: string;
  gameDataStatus: GameDataStatus;
  /** Add the given catalog ids to vault storage, each with its chosen row count. */
  onAddToStorage: (items: CatalogAddItem[]) => void;
  /** Bulk-add button label; defaults to "Add to storage" (robots are added to the vault). */
  bulkAddLabel?: string;
  /** Disable every add-to-storage button (the storage-capacity guardrail). */
  addDisabled?: boolean;
  /** Tooltip explaining WHY adds are disabled (shown on the disabled buttons). */
  addDisabledReason?: string;
  /** Banner rendered above the table (e.g. the storage-capacity notice). */
  notice?: ReactNode;
  /** Equip a single catalog id onto dwellers (omitted for junk). */
  onEquip?: (id: string) => void;
  equipLabel?: string;
  /** Row id to scroll into view + briefly flash (arrival cue from a cross-tab jump). */
  focusRowId?: string | null;
  virtualized?: boolean;
}

export function CatalogTableView<T>({
  title,
  unitNoun,
  data,
  schema,
  persistKey,
  preset,
  getRowId,
  getRowLabel,
  searchLabel,
  searchPlaceholder,
  gameDataStatus,
  onAddToStorage,
  bulkAddLabel = 'Add to storage',
  addDisabled = false,
  addDisabledReason,
  notice = null,
  onEquip,
  equipLabel = 'Equip…',
  focusRowId,
  virtualized = true,
}: CatalogTableViewProps<T>) {
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Per-row "quantity to add" (session-only, keyed by row id; default 1). This is NOT a
  // stored count - it's how many of that catalog item the next Add grants, and it persists
  // between adds so repeated clicks keep granting the same batch. Held in a ref (not state)
  // so bumping a row's count never rebuilds the column defs (see CatalogCountCell).
  const countsRef = useRef<Record<string, number>>({});

  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection],
  );

  const labelFor = getRowLabel ?? getRowId;
  const countFor = (id: string): number => countsRef.current[id] ?? 1;

  // Pinned select (leading) + per-row count editor and actions (trailing), composed around
  // the schema. The count column mirrors storage's [−][input][+] (min 1 - adding 0 is
  // meaningless) and feeds both the per-row Add and the bulk add. The single-item "Add" lets
  // one click add without the check-then-reach-toolbar dance; "Equip…" shows only when
  // equipping is allowed (mirrors EquipPickerDialog's prepended badge).
  const leading = useMemo<ColumnDef<T>[]>(() => [selectColumn<T>(labelFor)], [labelFor]);
  const trailing = useMemo<ColumnDef<T>[]>(
    () => [
      {
        id: 'addCount',
        header: 'Count',
        cell: ({ row }) => {
          const id = getRowId(row.original);
          return (
            <CatalogCountCell
              initial={countsRef.current[id] ?? 1}
              onChange={(c) => {
                countsRef.current[id] = c;
              }}
            />
          );
        },
        size: 130,
        enableSorting: false,
        enableColumnFilter: false,
      },
      actionsColumn<T>(
        [
          {
            text: 'Add',
            tone: 'emerald',
            ariaLabel: (row) => `Add ${labelFor(row)} to storage`,
            disabled: () => addDisabled,
            title: () => (addDisabled ? addDisabledReason : undefined),
            onClick: (row) => {
              const id = getRowId(row);
              onAddToStorage([{ id, count: countsRef.current[id] ?? 1 }]);
            },
          },
          ...(onEquip
            ? ([
                {
                  text: equipLabel,
                  tone: 'sky' as const,
                  onClick: (row: T) => onEquip(getRowId(row)),
                },
              ] as const)
            : []),
        ],
        { size: onEquip ? 150 : 80 },
      ),
    ],
    [labelFor, getRowId, onAddToStorage, addDisabled, addDisabledReason, onEquip, equipLabel],
  );

  const clearSelection = (): void => setRowSelection({});

  const toolbar = ({ columnsMenu, search }: { columnsMenu: ReactNode; search: ReactNode }) => (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {search}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={addDisabled}
            {...(addDisabled && addDisabledReason ? { title: addDisabledReason } : {})}
            onClick={() => {
              onAddToStorage(selectedIds.map((id) => ({ id, count: countFor(id) })));
              clearSelection();
            }}
            className="rounded border border-emerald-700 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {bulkAddLabel} ({selectedIds.length})
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-100"
          >
            Clear
          </button>
        </div>
      )}
      <div className="ml-auto">{columnsMenu}</div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-sm text-neutral-400">
          {data.length} {unitNoun}
        </span>
        {gameDataStatus === 'loading' && (
          <span className="text-xs text-neutral-400">loading game data…</span>
        )}
        {gameDataStatus === 'error' && (
          <span className="text-xs text-amber-500">game data unavailable</span>
        )}
      </div>

      {notice && <div className="mt-3">{notice}</div>}

      <UnifiedTable<T>
        className="mt-3 min-h-0 flex-1"
        virtualized={virtualized}
        schema={schema}
        persistKey={persistKey}
        {...(preset ? { preset } : {})}
        data={data}
        leading={leading}
        trailing={trailing}
        getRowId={getRowId}
        {...(focusRowId != null ? { focusRowId } : {})}
        initialSorting={[{ id: 'name', desc: false }]}
        enableGlobalFilter
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        searchLabel={searchLabel}
        searchPlaceholder={searchPlaceholder}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        toolbar={toolbar}
        emptyState={`No ${unitNoun} match the search.`}
      />
    </div>
  );
}
