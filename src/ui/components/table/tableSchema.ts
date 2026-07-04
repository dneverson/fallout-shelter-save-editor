import type { ColumnDef, VisibilityState } from '@tanstack/react-table';

// Unified table system: a TableSchema is the single source of truth for one ROW TYPE's
// table - the FULL set of data columns plus the metadata the shared Columns menu needs.
// Every location that shows this type renders the same schema and merely picks a PRESET
// (which columns are visible by default); the rest stay one toggle away behind the Columns
// button. Location-specific leading (select/badge) and trailing (actions) columns are
// supplied by the location, not the schema.

export interface HideableColumn {
  id: string;
  label: string;
}

export interface TableSchema<T> {
  /** Stable name for the type (used to namespace persistence keys, e.g. 'dweller'). */
  name: string;
  /** The full set of DATA columns - the source of truth - in natural left-to-right order. */
  columns: ColumnDef<T>[];
  /** Columns the Columns menu can hide/reorder, in natural order (everything user-toggle-able). */
  hideable: ReadonlyArray<HideableColumn>;
}

/** Natural order of a schema's hideable column ids. */
export function hideableOrder<T>(schema: TableSchema<T>): string[] {
  return schema.hideable.map((c) => c.id);
}

/**
 * Build the default visibility for a preset: among the schema's hideable columns, show only
 * those whose id is in `presetIds`. `undefined` means "show all" (no overrides). Columns not
 * in `hideable` (location-supplied select/badge/actions) are always shown.
 */
export function visibilityForPreset<T>(
  schema: TableSchema<T>,
  presetIds?: readonly string[],
): VisibilityState {
  if (!presetIds) return {};
  const shown = new Set(presetIds);
  const visibility: VisibilityState = {};
  for (const col of schema.hideable) visibility[col.id] = shown.has(col.id);
  return visibility;
}
