import {
  COLLECTION_CATEGORY_LABELS,
  type CollectionRow,
} from '../../../../domain/items/collectionCatalog.ts';
import type { CollectionStatus } from '../../../../domain/ops/collectionOps.ts';
import { iconColumn, inSelectedSet, nameCell } from '../columnKit.tsx';
import type { TableSchema } from '../tableSchema.ts';

// Source-of-truth schema for the SURVIVAL GUIDE catalog: icon · name · category
// (Weapon/Outfit/Dweller/Pet/Pet Breed/Junk) · rarity · guide status. Weapon/outfit/
// pet/junk rows reuse the item sprite; legendary dwellers have no item sprite and show
// a neutral chip (same fallback as theme recipes). The select column and the per-row
// Collect/Mark seen/Remove actions are supplied by SurvivalGuideView (store callbacks).

/** A catalog row enriched with the current save's guide state. */
export interface CollectionViewRow extends CollectionRow {
  /** 'missing' (not collected), 'new' (collected, NEW badge), 'seen' (collected). */
  status: CollectionStatus;
}

/** Filterable status label (also the sort key) for the status column. */
const STATUS_LABELS: Record<CollectionStatus, string> = {
  missing: 'Missing',
  new: 'Collected (new)',
  seen: 'Collected',
};

function statusCell(status: CollectionStatus) {
  if (status === 'missing') return <span className="text-neutral-500">Missing</span>;
  return (
    <span className="flex items-center gap-1.5 text-emerald-300">
      Collected
      {status === 'new' && (
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
          New
        </span>
      )}
    </span>
  );
}

export function collectionSchema(): TableSchema<CollectionViewRow> {
  return {
    name: 'collection',
    hideable: [
      { id: 'name', label: 'Name' },
      { id: 'category', label: 'Category' },
      { id: 'rarity', label: 'Rarity' },
      { id: 'status', label: 'Status' },
    ],
    columns: [
      iconColumn<CollectionViewRow>(
        (r) => r.icon,
        <span
          aria-hidden="true"
          className="inline-block h-[22px] w-[22px] shrink-0 rounded-sm bg-neutral-800"
        />,
      ),
      {
        id: 'name',
        accessorFn: (r) => r.name,
        header: 'Name',
        cell: ({ getValue }) => nameCell(getValue<string>()),
        size: 240,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Name' },
      },
      {
        id: 'category',
        accessorFn: (r) => COLLECTION_CATEGORY_LABELS[r.category],
        header: 'Category',
        size: 110,
        filterFn: inSelectedSet<CollectionViewRow>(),
        meta: { filterVariant: 'select', headerLabel: 'Category' },
      },
      {
        id: 'rarity',
        accessorFn: (r) => r.rarity ?? '–',
        header: 'Rarity',
        size: 110,
        filterFn: inSelectedSet<CollectionViewRow>(),
        meta: { filterVariant: 'select', headerLabel: 'Rarity' },
      },
      {
        id: 'status',
        accessorFn: (r) => STATUS_LABELS[r.status],
        header: 'Status',
        cell: ({ row }) => statusCell(row.original.status),
        size: 150,
        filterFn: inSelectedSet<CollectionViewRow>(),
        meta: { filterVariant: 'select', headerLabel: 'Status' },
      },
    ],
  };
}
