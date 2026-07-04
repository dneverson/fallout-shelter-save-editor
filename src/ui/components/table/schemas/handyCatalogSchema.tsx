import type { Handy } from '../../../../domain/gamedata/schemas.ts';
import { iconColumn, inSelectedSet, nameCell } from '../columnKit.tsx';
import type { TableSchema } from '../tableSchema.ts';

// Source-of-truth schema for the game-data Mr. Handy CATALOG (the "Catalog" tab of
// the Mr. Handies screen) - the four vault-helper variants the game ships, distinct
// from owned robot INSTANCES (handyInstanceSchema). Mirrors petCatalogSchema.

const pct = (v: number): string => `${Math.round(v * 10000) / 100}%`;

export function handyCatalogSchema(): TableSchema<Handy> {
  return {
    name: 'handyCatalog',
    hideable: [
      { id: 'name', label: 'Name' },
      { id: 'variantId', label: 'Variant id' },
      { id: 'source', label: 'How to get' },
      { id: 'boxOdds', label: 'Box odds' },
    ],
    columns: [
      iconColumn<Handy>((h) => ({ type: 'handies', id: h.id })),
      {
        id: 'name',
        accessorFn: (h) => h.name,
        header: 'Name',
        cell: ({ getValue }) => nameCell(getValue<string>()),
        size: 150,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Name' },
      },
      {
        id: 'variantId',
        accessorFn: (h) => h.variantId,
        header: 'Variant id',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-neutral-400">{getValue<string>()}</span>
        ),
        size: 110,
        filterFn: inSelectedSet<Handy>(),
        meta: { filterVariant: 'select', headerLabel: 'Variant id' },
      },
      {
        id: 'source',
        accessorFn: (h) => h.source,
        header: 'How to get',
        cell: ({ getValue }) => nameCell(getValue<string>()),
        size: 260,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'How to get' },
      },
      {
        // The in-game "Mr. Handy box" pull chance; Victor/Curie are season-pass only (0%).
        id: 'boxOdds',
        accessorFn: (h) => h.mrHandyBoxOdds,
        header: 'Box odds',
        cell: ({ row }) =>
          row.original.mrHandyBoxOdds > 0 ? pct(row.original.mrHandyBoxOdds) : '–',
        size: 100,
        filterFn: 'inNumberRange',
        meta: { filterVariant: 'range', headerLabel: 'Box odds' },
      },
    ],
  };
}
