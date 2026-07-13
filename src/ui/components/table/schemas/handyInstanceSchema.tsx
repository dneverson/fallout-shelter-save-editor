import type { MrHandyRow } from '../../../../domain/ops/mrHandyOps.ts';
import { displayFloor } from '../../../../domain/rooms/layout.ts';
import { iconColumn, inSelectedSet } from '../columnKit.tsx';
import type { TableSchema } from '../tableSchema.ts';

// Source-of-truth schema for the OWNED Mr. Handy roster - robot INSTANCES in
// dwellers.actors[], distinct from the four-variant catalog (handyCatalogSchema).
// Mirrors petInstanceSchema: pinned sprite, then toggleable columns.

/** MrHandyRow enriched with catalog lookups the pure selector can't do. */
export interface HandyTableRow extends MrHandyRow {
  /** Catalog id for the icon ('mrhandy' | 'snipsnip' | 'victor' | 'curie'), or null. */
  catalogId: string | null;
  /** Display name of the variant ("Mr. Handy", "Snip Snip", …), falls back to the raw id. */
  variantName: string;
}

const HIDEABLE_HANDY_COLUMNS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'variant', label: 'Variant' },
  { id: 'health', label: 'Health' },
  { id: 'status', label: 'Status' },
  { id: 'location', label: 'Location' },
];

export function handyInstanceSchema(fullHealth: number): TableSchema<HandyTableRow> {
  return {
    name: 'handyInstance',
    hideable: HIDEABLE_HANDY_COLUMNS,
    columns: [
      iconColumn<HandyTableRow>((h) => ({ type: 'handies', id: h.catalogId ?? 'mrhandy' })),
      {
        id: 'name',
        accessorFn: (h) => h.name,
        header: 'Name',
        cell: ({ getValue }) => {
          const name = getValue<string>();
          return <span title={name}>{name}</span>;
        },
        size: 160,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Name' },
      },
      {
        id: 'variant',
        accessorFn: (h) => h.variantName,
        header: 'Variant',
        size: 130,
        filterFn: inSelectedSet<HandyTableRow>(),
        meta: { filterVariant: 'select', headerLabel: 'Variant' },
      },
      {
        id: 'health',
        accessorFn: (h) => h.health ?? 0,
        header: 'Health',
        cell: ({ row }) => {
          const h = row.original;
          if (h.dead) return <span className="text-red-400">destroyed</span>;
          if (h.health === null) return '–';
          const hurt = h.health < fullHealth;
          return (
            <span className={`tabular-nums ${hurt ? 'text-amber-300' : 'text-neutral-300'}`}>
              {Math.round(h.health)} / {fullHealth}
            </span>
          );
        },
        size: 110,
        filterFn: 'inNumberRange',
        meta: { filterVariant: 'range', headerLabel: 'Health' },
      },
      {
        id: 'status',
        accessorFn: (h) =>
          h.dead
            ? 'Destroyed'
            : h.inWasteland
              ? 'In Wasteland'
              : h.floor === null
                ? 'At Door'
                : 'Placed',
        header: 'Status',
        size: 110,
        filterFn: inSelectedSet<HandyTableRow>(),
        meta: { filterVariant: 'select', headerLabel: 'Status' },
      },
      {
        id: 'location',
        accessorFn: (h) =>
          h.inWasteland
            ? 'Wasteland'
            : h.floor === null
              ? 'At the door'
              : `Floor ${displayFloor(h.floor)}`,
        header: 'Location',
        cell: ({ row }) => {
          const h = row.original;
          // Both unplaced states are NORMAL (collecting out in the wasteland, or waiting
          // at the door until placed), so they render neutrally - no warning glyph.
          if (h.inWasteland) {
            return <span title="Out collecting in the wasteland">Wasteland</span>;
          }
          return h.floor === null ? (
            <span title="Waits at the vault door until you place it on a floor">At the door</span>
          ) : (
            <span title={h.roomLabel ?? undefined}>Floor {displayFloor(h.floor)}</span>
          );
        },
        size: 200,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Location' },
      },
    ],
  };
}
