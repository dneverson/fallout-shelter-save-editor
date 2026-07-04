import type { PetRow } from '../../../../domain/selectors/petSelectors.ts';
import { iconColumn, inSelectedSet, prettyBonus } from '../columnKit.tsx';
import type { TableSchema } from '../tableSchema.ts';

// Source-of-truth schema for the OWNED PET roster - pet INSTANCES (equipped
// on dwellers + loose in storage), distinct from the breed×rarity catalog (petCatalogSchema).
// Rendered by the Pets screen and the pet-attach "Owned" tab; the leading sprite is pinned
// and non-hideable, everything else is toggleable via the Columns button.

/** Hideable/reorderable columns (everything except the fixed sprite). */
const HIDEABLE_PET_COLUMNS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'breed', label: 'Breed' },
  { id: 'type', label: 'Type' },
  { id: 'rarity', label: 'Rarity' },
  { id: 'bonus', label: 'Bonus' },
  { id: 'value', label: 'Value' },
  { id: 'assignedTo', label: 'Assigned to' },
];

export function petInstanceSchema(): TableSchema<PetRow> {
  return {
    name: 'petInstance',
    hideable: HIDEABLE_PET_COLUMNS,
    columns: [
      iconColumn<PetRow>((p) => ({ type: 'pets', id: p.id })),
      {
        id: 'name',
        accessorFn: (p) => p.uniqueName || p.breed,
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
        id: 'breed',
        accessorFn: (p) => p.breed,
        header: 'Breed',
        size: 140,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Breed' },
      },
      {
        id: 'type',
        accessorFn: (p) => p.type,
        header: 'Type',
        size: 120,
        filterFn: inSelectedSet<PetRow>(),
        meta: { filterVariant: 'select', headerLabel: 'Type' },
      },
      {
        id: 'rarity',
        accessorFn: (p) => p.rarity,
        header: 'Rarity',
        size: 110,
        filterFn: inSelectedSet<PetRow>(),
        meta: { filterVariant: 'select', headerLabel: 'Rarity' },
      },
      {
        id: 'bonus',
        accessorFn: (p) => p.bonus,
        header: 'Bonus',
        cell: ({ row }) => prettyBonus(row.original.bonus),
        size: 180,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Bonus' },
      },
      {
        // Sort/filter on the rolled value; the cell also shows the legal max ("X / Y") so the
        // ceiling is obvious without opening each pet (mirrors the catalog's Bonus range).
        id: 'value',
        accessorFn: (p) => p.bonusValue,
        header: 'Value',
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.bonusValue}
            {row.original.bonusMax != null && (
              <span className="text-neutral-400"> / {row.original.bonusMax}</span>
            )}
          </span>
        ),
        size: 90,
        filterFn: 'inNumberRange',
        meta: { filterVariant: 'range', headerLabel: 'Value' },
      },
      {
        id: 'assignedTo',
        accessorFn: (p) => p.assignedTo,
        header: 'Assigned to',
        size: 170,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Assigned to' },
      },
    ],
  };
}
