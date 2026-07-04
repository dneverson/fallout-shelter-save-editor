import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFacetedMinMaxValues,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnSizingState,
  type FilterFnOption,
  type OnChangeFn,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ColumnFilter } from './ColumnFilter.tsx';

// Reusable headless data table: TanStack Table core for
// sort + global search + per-column filters, TanStack Virtual for row
// virtualization. Domain agnostic - the dwellers roster, item browsers, and equip
// pickers all build on it by supplying column defs. Rendered with ARIA grid roles
// instead of a <table> so virtual rows can be absolutely positioned while staying
// keyboard/SR navigable. Sorting, column filters, column visibility, and
// column order are controllable so a view can persist them via uiStore.

// Column-level filter UI metadata, consumed by the header's <ColumnFilter>.
declare module '@tanstack/react-table' {
  // The augmentation must mirror TanStack's ColumnMeta<TData, TValue> signature;
  // both type params are required by the declaration even though unused here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Which per-column filter control the header renders. */
    filterVariant?: 'text' | 'range' | 'select';
    /** Human label for the column menu (when the header cell isn't plain text). */
    headerLabel?: string;
    /**
     * Overrides the default `truncate` on this column's body cells. Icon-only columns set
     * `''` so a sprite that's slightly wider than its padded cell doesn't make the cell's
     * `text-overflow: ellipsis` paint a stray "…" after the icon.
     */
    cellClassName?: string;
  }
}

export interface DataTableProps<T> {
  data: T[];
  /** Use plain `ColumnDef<T>` literals (TValue defaults to `unknown`). */
  columns: ColumnDef<T>[];
  getRowId?: (row: T, index: number) => string;
  enableSorting?: boolean;
  /** Controlled sort state; falls back to internal state when omitted. */
  sorting?: SortingState;
  onSortingChange?: (value: SortingState) => void;
  initialSorting?: SortingState;
  enableGlobalFilter?: boolean;
  /** Controlled global search value; falls back to internal state when omitted. */
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  globalFilterFn?: FilterFnOption<T>;
  /** Controlled per-column filters; falls back to internal state when omitted. */
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (value: ColumnFiltersState) => void;
  /** Controlled column visibility; falls back to internal state when omitted. */
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (value: VisibilityState) => void;
  /** Controlled column order; falls back to internal state when omitted. */
  columnOrder?: string[];
  onColumnOrderChange?: (value: string[]) => void;
  /** Controlled column widths (drag-to-resize); falls back to internal state when omitted. */
  columnSizing?: ColumnSizingState;
  onColumnSizingChange?: (value: ColumnSizingState) => void;
  enableRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  onRowClick?: (row: T) => void;
  /**
   * Row id (matches `getRowId`) of the row whose detail is currently open in a
   * master-detail screen. That row gets a distinct "active" highlight - separate from
   * the checkbox bulk-`rowSelection` concept - so it's obvious which row the side panel
   * belongs to.
   */
  activeRowId?: string;
  virtualized?: boolean;
  estimateRowHeight?: number;
  overscan?: number;
  /** Rendered above the table (custom search box, facet filters, bulk bar). */
  toolbar?: ReactNode;
  /** Rendered in place of the body when there are no rows. */
  emptyState?: ReactNode;
  className?: string;
}

/** A piece of state that is controlled when a value is supplied, else internal. */
function useControllable<S>(
  controlled: S | undefined,
  onControlledChange: ((value: S) => void) | undefined,
  initial: S,
): [S, OnChangeFn<S>] {
  const [internal, setInternal] = useState<S>(initial);
  const value = controlled ?? internal;
  const onChange: OnChangeFn<S> = (updater) => {
    const next = typeof updater === 'function' ? (updater as (old: S) => S)(value) : updater;
    setInternal(next);
    onControlledChange?.(next);
  };
  return [value, onChange];
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  enableSorting = true,
  sorting: controlledSorting,
  onSortingChange: controlledOnSortingChange,
  initialSorting,
  enableGlobalFilter = false,
  globalFilter: controlledGlobalFilter,
  onGlobalFilterChange: controlledOnGlobalFilterChange,
  globalFilterFn = 'includesString',
  columnFilters: controlledColumnFilters,
  onColumnFiltersChange: controlledOnColumnFiltersChange,
  columnVisibility: controlledColumnVisibility,
  onColumnVisibilityChange: controlledOnColumnVisibilityChange,
  columnOrder: controlledColumnOrder,
  onColumnOrderChange: controlledOnColumnOrderChange,
  columnSizing: controlledColumnSizing,
  onColumnSizingChange: controlledOnColumnSizingChange,
  enableRowSelection = false,
  rowSelection: controlledRowSelection,
  onRowSelectionChange: controlledOnRowSelectionChange,
  onRowClick,
  activeRowId,
  virtualized = true,
  estimateRowHeight,
  overscan = 8,
  toolbar,
  emptyState,
  className,
}: DataTableProps<T>) {
  // Tables are uniformly compact: tight cell padding + row height for dense rosters.
  const cellPadding = 'px-2 py-1';
  const rowHeight = estimateRowHeight ?? 36;
  const [sorting, onSortingChange] = useControllable<SortingState>(
    controlledSorting,
    controlledOnSortingChange,
    initialSorting ?? [],
  );
  const [globalFilter, onGlobalFilterChange] = useControllable<string>(
    controlledGlobalFilter,
    controlledOnGlobalFilterChange,
    '',
  );
  const [columnFilters, onColumnFiltersChange] = useControllable<ColumnFiltersState>(
    controlledColumnFilters,
    controlledOnColumnFiltersChange,
    [],
  );
  const [columnVisibility, onColumnVisibilityChange] = useControllable<VisibilityState>(
    controlledColumnVisibility,
    controlledOnColumnVisibilityChange,
    {},
  );
  const [columnOrder, onColumnOrderChange] = useControllable<string[]>(
    controlledColumnOrder,
    controlledOnColumnOrderChange,
    [],
  );
  const [columnSizing, onColumnSizingChange] = useControllable<ColumnSizingState>(
    controlledColumnSizing,
    controlledOnColumnSizingChange,
    {},
  );
  const [rowSelection, onRowSelectionChange] = useControllable<RowSelectionState>(
    controlledRowSelection,
    controlledOnRowSelectionChange,
    {},
  );

  // TanStack Table's useReactTable returns non-memoizable functions by design; the
  // React Compiler lint rule flags this library as incompatible, which is expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<T>({
    data,
    columns,
    state: {
      sorting,
      globalFilter,
      columnFilters,
      columnVisibility,
      columnOrder,
      columnSizing,
      rowSelection,
    },
    onSortingChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    onColumnVisibilityChange,
    onColumnOrderChange,
    onColumnSizingChange,
    onRowSelectionChange,
    enableSorting,
    enableRowSelection,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    globalFilterFn,
    ...(getRowId ? { getRowId } : {}),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFacetedMinMaxValues: getFacetedMinMaxValues(),
  });

  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  // The header is a sibling ABOVE the (vertically) scrolling body so it stays put on
  // vertical scroll, but that also leaves it behind on HORIZONTAL scroll. Keep it in
  // sync by translating the inner header row by the body's scrollLeft - written
  // imperatively in the scroll handler so it doesn't trigger a React render per frame
  // (the virtualizer is already re-rendering the body on scroll).
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const syncHeaderScroll = (scrollLeft: number): void => {
    if (headerScrollRef.current) {
      headerScrollRef.current.style.transform = `translateX(${-scrollLeft}px)`;
    }
  };
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
    enabled: virtualized,
  });

  const gridTemplateColumns = table
    .getVisibleLeafColumns()
    .map((col) => `${col.getSize()}px`)
    .join(' ');
  // Total width of all columns. Rows are sized to this (with a 100% floor) so the row
  // background + active/focus highlight span every column even when the table is wider
  // than its viewport and scrolled horizontally - without it the highlight stopped at
  // the visible edge instead of running the full width of the table.
  const totalColumnsWidth = table.getTotalSize();

  const renderCells = (row: Row<T>): ReactNode =>
    row.getVisibleCells().map((cell) => {
      const cellClass = cell.column.columnDef.meta?.cellClassName ?? 'truncate';
      return (
        <div
          role="cell"
          key={cell.id}
          className={`${cellClass} ${cellPadding} text-sm text-neutral-200`}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </div>
      );
    });

  // Rows that open a detail are interactive: clickable AND keyboard-navigable.
  // The grid uses a roving tabindex - exactly one row is in the tab order at a time and
  // the arrow keys move focus between rows (the standard ARIA grid pattern), so the
  // table is one Tab stop rather than hundreds.
  const interactive = !!onRowClick;
  const activateRow = (row: Row<T>): void => onRowClick?.(row.original);

  const [focusedIndex, setFocusedIndex] = useState(-1);
  // Tab enters on the focused row if there is one, else the open-detail row, else the top.
  const activeIndex = activeRowId != null ? rows.findIndex((r) => r.id === activeRowId) : -1;
  const rovingIndex = focusedIndex >= 0 ? focusedIndex : activeIndex >= 0 ? activeIndex : 0;

  // Focusing a virtualized row that isn't mounted yet can't happen synchronously, so the
  // move records a pending target + scrolls it into view; this effect (which runs after
  // every render) focuses the row once the virtualizer has rendered it, then clears it.
  const pendingFocusRef = useRef<number | null>(null);
  const focusRow = (index: number): void => {
    const el = scrollRef.current?.querySelector(`[role="row"][data-index="${index}"]`);
    if (el instanceof HTMLElement) {
      el.focus();
      pendingFocusRef.current = null;
    }
  };
  useEffect(() => {
    if (pendingFocusRef.current != null) focusRow(pendingFocusRef.current);
  });

  const moveFocus = (target: number): void => {
    if (rows.length === 0) return;
    const clamped = Math.max(0, Math.min(rows.length - 1, target));
    setFocusedIndex(clamped);
    pendingFocusRef.current = clamped;
    if (virtualized) virtualizer.scrollToIndex(clamped, { align: 'auto' });
    focusRow(clamped); // immediate when already rendered; the effect covers the scroll case
  };

  const handleRowKeyDown =
    (row: Row<T>, index: number) =>
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      switch (event.key) {
        case 'Enter':
        case ' ':
          event.preventDefault();
          activateRow(row);
          break;
        case 'ArrowDown':
          event.preventDefault();
          moveFocus(index + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveFocus(index - 1);
          break;
        case 'Home':
          event.preventDefault();
          moveFocus(0);
          break;
        case 'End':
          event.preventDefault();
          moveFocus(rows.length - 1);
          break;
        default:
          break;
      }
    };

  // The active (open-detail) row gets a distinct highlight + ring, kept visually separate
  // from the checkbox bulk-selection. The ring is inset so it never shifts the grid layout.
  const rowStateClass = (isActive: boolean): string =>
    `border-t border-neutral-800 hover:bg-neutral-800/50${
      interactive
        ? ' cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400'
        : ''
    }${isActive ? ' bg-amber-500/10 ring-1 ring-inset ring-amber-500/40' : ''}`;

  // Shared row markup so the virtualized + non-virtualized branches can't drift on the
  // interactive/active/focus behaviour. `positioned` rows are absolutely placed by the
  // virtualizer; `measureRef`/`dataIndex` wire its dynamic measurement.
  const renderRow = (
    row: Row<T>,
    index: number,
    opts: {
      style: CSSProperties;
      positioned?: boolean;
      measureRef?: (node: Element | null) => void;
    },
  ): ReactNode => {
    const isActive = activeRowId != null && row.id === activeRowId;
    return (
      <div
        role="row"
        key={row.id}
        ref={opts.measureRef}
        data-index={index}
        tabIndex={interactive ? (index === rovingIndex ? 0 : -1) : undefined}
        aria-selected={interactive ? isActive : undefined}
        onClick={interactive ? () => activateRow(row) : undefined}
        onKeyDown={interactive ? handleRowKeyDown(row, index) : undefined}
        onFocus={interactive ? () => setFocusedIndex(index) : undefined}
        className={`${opts.positioned ? 'absolute left-0 ' : ''}grid ${rowStateClass(isActive)}`}
        style={{ ...opts.style, width: totalColumnsWidth, minWidth: '100%' }}
      >
        {renderCells(row)}
      </div>
    );
  };

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ''}`}>
      {toolbar ??
        (enableGlobalFilter && (
          <input
            type="search"
            value={globalFilter}
            onChange={(e) => onGlobalFilterChange(e.target.value)}
            placeholder="Search…"
            aria-label="Search"
            className="mb-2 w-64 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder-neutral-500"
          />
        ))}

      <div
        role="table"
        aria-rowcount={rows.length}
        // `isolate` scopes the sticky header's `z-20` to THIS table's stacking context, so
        // the header (and its open filter popover) paint above this table's body but can't
        // punch through a portaled modal - without isolation the z-20 lived in the root
        // stacking context and the roster header bled over the equip-picker dialog.
        // Clip horizontally only (`overflow-x-clip`) to contain the sticky header's sideways
        // overflow, while leaving the vertical axis VISIBLE so a header filter/columns popover
        // can open down past a short body - `overflow-hidden` here was clipping those menus on
        // tables with only a few rows, making their Clear/manage controls unreachable.
        className="isolate flex min-h-0 flex-col overflow-x-clip overflow-y-visible rounded border border-neutral-800"
      >
        {/* Static full-width strip holds the header background steady; the inner rowgroup
            is translated to track the body's horizontal scroll. `shrink-0` keeps the
            header from collapsing in height-constrained tables (dialogs, bulk sub-tables),
            and NO `overflow` here so the per-column filter popovers (absolute, not
            portaled) can still open down over the body - the outer role="table" clips the
            header's horizontal overflow for us. */}
        <div className="relative z-20 shrink-0 bg-neutral-900/80">
          <div role="rowgroup" ref={headerScrollRef} className="will-change-transform">
            {table.getHeaderGroups().map((headerGroup) => (
              <div role="row" key={headerGroup.id} className="grid" style={{ gridTemplateColumns }}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const content = header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext());
                  const showFilter =
                    !header.isPlaceholder &&
                    !!header.column.columnDef.meta?.filterVariant &&
                    header.column.getCanFilter();
                  return (
                    <div
                      role="columnheader"
                      key={header.id}
                      aria-sort={
                        sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                      }
                      className={`relative flex items-center gap-1 ${cellPadding} text-left text-xs font-medium uppercase tracking-wide text-neutral-400`}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="flex items-center gap-1 hover:text-neutral-100"
                        >
                          {content}
                          <span aria-hidden="true" className="text-neutral-400">
                            {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}
                          </span>
                        </button>
                      ) : (
                        content
                      )}
                      {showFilter && <ColumnFilter column={header.column} />}
                      {header.column.getCanResize() && (
                        // Drag-to-resize handle on the column's right edge. Pointer drag uses
                        // TanStack's resize handler (live, columnResizeMode 'onChange');
                        // ←/→ nudge it from the keyboard; double-click resets to default.
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${header.column.columnDef.meta?.headerLabel ?? header.column.id} column`}
                          tabIndex={0}
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={() => header.column.resetSize()}
                          onKeyDown={(e) => {
                            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                            e.preventDefault();
                            const delta = e.key === 'ArrowLeft' ? -16 : 16;
                            const min = header.column.columnDef.minSize ?? 20;
                            const next = Math.max(min, header.getSize() + delta);
                            table.setColumnSizing((old) => ({ ...old, [header.column.id]: next }));
                          }}
                          className={`absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none focus:outline-none focus-visible:bg-amber-400 ${
                            header.column.getIsResizing()
                              ? 'bg-amber-400'
                              : 'bg-transparent hover:bg-neutral-600'
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="p-6 text-sm text-neutral-400">{emptyState ?? 'No rows.'}</div>
        ) : (
          <div
            ref={scrollRef}
            role="rowgroup"
            className="min-h-0 flex-1 overflow-auto"
            onScroll={(e) => syncHeaderScroll(e.currentTarget.scrollLeft)}
          >
            {virtualized ? (
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  return renderRow(row, virtualRow.index, {
                    positioned: true,
                    measureRef: virtualizer.measureElement,
                    style: {
                      gridTemplateColumns,
                      transform: `translateY(${virtualRow.start}px)`,
                    },
                  });
                })}
              </div>
            ) : (
              rows.map((row, index) => renderRow(row, index, { style: { gridTemplateColumns } }))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
