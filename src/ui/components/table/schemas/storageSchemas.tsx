import type { ItemIconType } from '../../../../domain/gamedata/visualSchemas.ts';
import type { StackableType } from '../../../../domain/ops/storageOps.ts';
import { CountCell } from '../../storage/storageCells.tsx';
import { iconColumn, prettyBonus } from '../columnKit.tsx';
import type { TableSchema } from '../tableSchema.ts';

// Source-of-truth schemas for the STORAGE editor tables. Weapons/outfits/junk
// are fungible - grouped by id with an editable count (storageGroupSchema); pets are unique
// instances (storedPetSchema). The destructive Remove action is a trailing column supplied
// by the view (it needs the store op), composed via the unified table's `trailing`.

/** A grouped weapon/outfit/junk storage row (fungible, edited by count). */
export interface StorageGroupRow {
  id: string;
  name: string;
  rarity: string;
  count: number;
}

/** A single stored pet instance (unique), projected for the pets segment. */
export interface StoragePetRow {
  /** Index into `vault.inventory.items` (the remove op target). */
  index: number;
  id: string;
  name: string;
  breed: string;
  rarity: string;
  bonus: string;
  value: number;
}

/** Map a stackable storage type to its item-icon atlas group. */
const ICON_TYPE: Record<StackableType, ItemIconType> = {
  Weapon: 'weapons',
  Outfit: 'outfits',
  Junk: 'junk',
};

export function storageGroupSchema({
  type,
  onSetCount,
}: {
  type: StackableType;
  onSetCount: (id: string, count: number) => void;
}): TableSchema<StorageGroupRow> {
  const iconType = ICON_TYPE[type];
  return {
    name: 'storageGroup',
    hideable: [
      { id: 'name', label: 'Name' },
      { id: 'rarity', label: 'Rarity' },
      { id: 'count', label: 'Count' },
    ],
    columns: [
      iconColumn<StorageGroupRow>((r) => ({ type: iconType, id: r.id })),
      { id: 'name', accessorFn: (r) => r.name, header: 'Name', size: 240 },
      { id: 'rarity', accessorFn: (r) => r.rarity, header: 'Rarity', size: 120 },
      {
        id: 'count',
        accessorFn: (r) => r.count,
        header: 'Count',
        cell: ({ row }) => (
          <CountCell
            value={row.original.count}
            onCommit={(count) => onSetCount(row.original.id, count)}
          />
        ),
        size: 130,
        enableColumnFilter: false,
      },
    ],
  };
}

export function storedPetSchema(): TableSchema<StoragePetRow> {
  return {
    name: 'storedPet',
    hideable: [
      { id: 'name', label: 'Name' },
      { id: 'breed', label: 'Breed' },
      { id: 'rarity', label: 'Rarity' },
      { id: 'bonus', label: 'Bonus' },
    ],
    columns: [
      iconColumn<StoragePetRow>((p) => ({ type: 'pets', id: p.id })),
      { id: 'name', accessorFn: (p) => p.name, header: 'Name', size: 160 },
      { id: 'breed', accessorFn: (p) => p.breed, header: 'Breed', size: 140 },
      { id: 'rarity', accessorFn: (p) => p.rarity, header: 'Rarity', size: 110 },
      {
        id: 'bonus',
        accessorFn: (p) => p.bonus,
        header: 'Bonus',
        cell: ({ row }) => `${prettyBonus(row.original.bonus)} (${row.original.value})`,
        size: 220,
      },
    ],
  };
}
