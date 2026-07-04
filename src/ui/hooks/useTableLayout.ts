import { useMemo } from 'react';
import type { ColumnSizingState, SortingState, VisibilityState } from '@tanstack/react-table';
import { useUIStore, type TableLayout } from '../../state/uiStore.ts';

// Unified table system: binds one table location to its persisted layout slice in uiStore
// (keyed by a stable string), returning the controlled state + setters that <DataTable>
// expects. Every table in the app persists its sort + column visibility/order/sizing this
// way, so column choices survive reloads (a single generic slice instead of a bespoke one
// per table). Search, per-column filters, and row selection are intentionally NOT here -
// those remain session-only, owned by each view.

export interface TableLayoutBinding {
  sorting: SortingState;
  setSorting: (sorting: SortingState) => void;
  columnVisibility: VisibilityState;
  setColumnVisibility: (visibility: VisibilityState) => void;
  columnOrder: string[];
  setColumnOrder: (order: string[]) => void;
  columnSizing: ColumnSizingState;
  setColumnSizing: (sizing: ColumnSizingState) => void;
}

/**
 * Read/write the persisted layout for table `key`. `defaults` seeds the layout the FIRST
 * time this table is seen (e.g. a preset's default column visibility / a default sort);
 * once the user changes anything, their persisted choice wins. Pass a stable `defaults`
 * (memoize at the call site) so the seed doesn't churn between renders.
 */
export function useTableLayout(key: string, defaults?: Partial<TableLayout>): TableLayoutBinding {
  const layout = useUIStore((s) => s.tableLayouts[key]);
  const setTableLayout = useUIStore((s) => s.setTableLayout);

  return useMemo<TableLayoutBinding>(() => {
    const sorting = layout?.sorting ?? defaults?.sorting ?? [];
    const columnVisibility = layout?.columnVisibility ?? defaults?.columnVisibility ?? {};
    const columnOrder = layout?.columnOrder ?? defaults?.columnOrder ?? [];
    const columnSizing = layout?.columnSizing ?? defaults?.columnSizing ?? {};
    return {
      sorting,
      setSorting: (value) => setTableLayout(key, { sorting: value }),
      columnVisibility,
      setColumnVisibility: (value) => setTableLayout(key, { columnVisibility: value }),
      columnOrder,
      setColumnOrder: (value) => setTableLayout(key, { columnOrder: value }),
      columnSizing,
      setColumnSizing: (value) => setTableLayout(key, { columnSizing: value }),
    };
    // `defaults` is intentionally read only as a first-seen seed; callers pass a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, layout, setTableLayout]);
}
