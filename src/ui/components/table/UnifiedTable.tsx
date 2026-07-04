import { useMemo, useState, type ReactNode } from 'react';
import type {
  ColumnDef,
  ColumnFiltersState,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table';
import { DataTable } from '../DataTable.tsx';
import { ColumnsMenu } from '../ColumnsMenu.tsx';
import { useTableLayout } from '../../hooks/useTableLayout.ts';
import { hideableOrder, visibilityForPreset, type TableSchema } from './tableSchema.ts';

// Unified table system: the one wrapper every table location renders. It composes the
// shared column SCHEMA (the type's full data columns) with this location's leading
// (select/badge) and trailing (actions) columns, applies the location's PRESET as the
// default column visibility, and binds the whole thing to its persisted layout slice (sort
// + visibility + order + sizing) via useTableLayout - so every table gets the Columns
// button and remembers the user's choices. Search / per-column filters / row selection stay
// controlled by the caller (session-only). Locations with a bespoke toolbar pass `toolbar`
// and place the supplied Columns menu where they want it; otherwise a default toolbar
// (optional search on the left, Columns button on the right) is rendered.

export interface UnifiedTableProps<T> {
  schema: TableSchema<T>;
  /** Stable persistence key for THIS location's layout (e.g. 'dwellers', 'addItems.weapon'). */
  persistKey: string;
  data: T[];
  getRowId: (row: T) => string;
  /** Hideable column ids visible by default here; omit to show all of them. */
  preset?: readonly string[];
  /** Pinned location columns rendered before the schema columns (select / status badge). */
  leading?: ColumnDef<T>[];
  /** Pinned location columns rendered after the schema columns (row actions). */
  trailing?: ColumnDef<T>[];
  initialSorting?: SortingState;

  enableRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  onRowClick?: (row: T) => void;
  activeRowId?: string;

  enableGlobalFilter?: boolean;
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  searchLabel?: string;
  searchPlaceholder?: string;

  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;

  /** Custom toolbar; receives the ready-made Columns menu + search box to place itself. */
  toolbar?: (ctx: { columnsMenu: ReactNode; search: ReactNode }) => ReactNode;
  /** Extra controls placed to the LEFT of the Columns button in the default toolbar. */
  toolbarExtras?: ReactNode;
  emptyState?: ReactNode;
  virtualized?: boolean;
  className?: string;
}

export function UnifiedTable<T>({
  schema,
  persistKey,
  data,
  getRowId,
  preset,
  leading = [],
  trailing = [],
  initialSorting,
  enableRowSelection = false,
  rowSelection,
  onRowSelectionChange,
  onRowClick,
  activeRowId,
  enableGlobalFilter = false,
  globalFilter,
  onGlobalFilterChange,
  searchLabel = 'Search',
  searchPlaceholder = 'Search…',
  columnFilters,
  onColumnFiltersChange,
  toolbar,
  toolbarExtras,
  emptyState,
  virtualized = true,
  className,
}: UnifiedTableProps<T>) {
  const leadingIds = useMemo(() => leading.map((c) => c.id ?? ''), [leading]);
  const trailingIds = useMemo(() => trailing.map((c) => c.id ?? ''), [trailing]);

  // Global search falls back to internal state when the caller doesn't control it, so a
  // table can opt into search with just `enableGlobalFilter` (the picker dialogs do this).
  const [internalFilter, setInternalFilter] = useState('');
  const filterValue = globalFilter ?? internalFilter;
  const setFilterValue = onGlobalFilterChange ?? setInternalFilter;

  // Seed the persisted layout the first time this table is seen: the preset's default
  // visibility and the initial sort. Stored partially, so the seed survives later edits.
  const defaults = useMemo(
    () => ({
      columnVisibility: visibilityForPreset(schema, preset),
      ...(initialSorting ? { sorting: initialSorting } : {}),
    }),
    [schema, preset, initialSorting],
  );
  const layout = useTableLayout(persistKey, defaults);

  const columns = useMemo<ColumnDef<T>[]>(
    () => [...leading, ...schema.columns, ...trailing],
    [leading, schema, trailing],
  );

  // Full column order: leading (location-pinned) → schema columns → trailing. The schema's
  // NON-hideable columns (e.g. a leading sprite) keep their natural slots; only the hideable
  // columns are permuted, in the user's persisted order. Walking the schema's natural order
  // and filling each hideable slot from the saved order keeps interspersed pinned columns put.
  const tableColumnOrder = useMemo(() => {
    const naturalSchemaOrder = schema.columns.map((c) => c.id ?? '');
    const hideableSet = new Set(schema.hideable.map((c) => c.id));
    const savedHideable = layout.columnOrder.filter((id) => hideableSet.has(id));
    let next = 0;
    const schemaOrder = naturalSchemaOrder.map((id) =>
      hideableSet.has(id) ? (savedHideable[next++] ?? id) : id,
    );
    return [...leadingIds, ...schemaOrder, ...trailingIds];
  }, [schema, layout.columnOrder, leadingIds, trailingIds]);

  const columnsMenu = (
    <ColumnsMenu
      hideable={schema.hideable}
      fullOrder={hideableOrder(schema)}
      visibility={layout.columnVisibility}
      setVisibility={layout.setColumnVisibility}
      order={layout.columnOrder}
      setOrder={layout.setColumnOrder}
    />
  );

  const search = enableGlobalFilter ? (
    <input
      type="search"
      value={filterValue}
      onChange={(e) => setFilterValue(e.target.value)}
      placeholder={searchPlaceholder}
      aria-label={searchLabel}
      className="w-64 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder-neutral-500"
    />
  ) : null;

  const resolvedToolbar: ReactNode = toolbar ? (
    toolbar({ columnsMenu, search })
  ) : (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {search}
      {toolbarExtras}
      <div className="ml-auto">{columnsMenu}</div>
    </div>
  );

  return (
    <DataTable<T>
      virtualized={virtualized}
      data={data}
      columns={columns}
      getRowId={getRowId}
      toolbar={resolvedToolbar}
      sorting={layout.sorting}
      onSortingChange={layout.setSorting}
      columnVisibility={layout.columnVisibility}
      onColumnVisibilityChange={layout.setColumnVisibility}
      columnOrder={tableColumnOrder}
      onColumnOrderChange={layout.setColumnOrder}
      columnSizing={layout.columnSizing}
      onColumnSizingChange={layout.setColumnSizing}
      {...(className ? { className } : {})}
      {...(enableGlobalFilter
        ? {
            enableGlobalFilter: true,
            globalFilter: filterValue,
            onGlobalFilterChange: setFilterValue,
          }
        : {})}
      {...(columnFilters ? { columnFilters } : {})}
      {...(onColumnFiltersChange ? { onColumnFiltersChange } : {})}
      {...(enableRowSelection ? { enableRowSelection: true } : {})}
      {...(rowSelection ? { rowSelection } : {})}
      {...(onRowSelectionChange ? { onRowSelectionChange } : {})}
      {...(onRowClick ? { onRowClick } : {})}
      {...(activeRowId != null ? { activeRowId } : {})}
      {...(emptyState != null ? { emptyState } : {})}
    />
  );
}
