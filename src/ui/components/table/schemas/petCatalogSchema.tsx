import type { Pet } from '../../../../domain/gamedata/schemas.ts';
import { iconColumn, inSelectedSet, nameCell, prettyBonus } from '../columnKit.tsx';
import type { TableSchema } from '../tableSchema.ts';

// Source-of-truth schema for the game-data PET CATALOG - the breed×rarity
// reference, distinct from owned pet INSTANCES (petInstanceSchema). This is the UNION of the
// two pet-catalog tables that had drifted apart (the Pets-section catalog and the loadout
// pet picker): a two-line special-name cell, the humanized ABILITY effect, AND the rolled
// magnitude range. Every location renders this one schema and picks a preset.

export function petCatalogSchema(): TableSchema<Pet> {
  return {
    name: 'petCatalog',
    hideable: [
      { id: 'name', label: 'Name' },
      { id: 'breed', label: 'Breed' },
      { id: 'type', label: 'Type' },
      { id: 'rarity', label: 'Rarity' },
      { id: 'ability', label: 'Ability' },
      { id: 'bonus', label: 'Bonus' },
    ],
    columns: [
      iconColumn<Pet>((p) => ({ type: 'pets', id: p.id })),
      {
        id: 'name',
        // Search/sort on the special name + breed together so iconic legendaries are findable
        // by either ("Mr. Pebbles" or "Persian"); the cell shows the special name primary.
        accessorFn: (p) =>
          p.baseName && p.baseName !== p.name ? `${p.baseName} ${p.name}` : p.name,
        header: 'Name',
        cell: ({ row }) => {
          const { name, baseName } = row.original;
          const special = baseName && baseName !== name ? baseName : null;
          return special ? (
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate" title={`${special} (${name})`}>
                {special}
              </span>
              <span className="truncate text-[11px] text-neutral-400" title={name}>
                {name}
              </span>
            </span>
          ) : (
            <span title={name}>{name}</span>
          );
        },
        size: 180,
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
        filterFn: inSelectedSet<Pet>(),
        meta: { filterVariant: 'select', headerLabel: 'Type' },
      },
      {
        id: 'rarity',
        accessorFn: (p) => p.rarity,
        header: 'Rarity',
        size: 110,
        filterFn: inSelectedSet<Pet>(),
        meta: { filterVariant: 'select', headerLabel: 'Rarity' },
      },
      {
        id: 'ability',
        accessorFn: (p) => prettyBonus(p.bonus),
        header: 'Ability',
        cell: ({ getValue }) => nameCell(getValue<string>()),
        size: 170,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Ability' },
      },
      {
        // The rolled-bonus magnitude range; sort by the strongest possible roll (max).
        id: 'bonus',
        accessorFn: (p) => p.bonusMax,
        header: 'Bonus',
        cell: ({ row }) =>
          row.original.bonusMin === row.original.bonusMax
            ? `${row.original.bonusMax}`
            : `${row.original.bonusMin}–${row.original.bonusMax}`,
        size: 110,
        filterFn: 'inNumberRange',
        meta: { filterVariant: 'range', headerLabel: 'Bonus' },
      },
    ],
  };
}
