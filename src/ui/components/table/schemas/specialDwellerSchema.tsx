import { StatBadge } from '../../dwellers/StatBadge.tsx';
import { ItemIcon } from '../../ItemIcon.tsx';
import type { TableSchema } from '../tableSchema.ts';

// Source-of-truth schema for the SPECIAL/legendary named-dweller catalog. A SEPARATE
// registry from the save dweller roster: it draws from game-data UniqueDweller entries, not
// projected save rows, so its columns (combined SPECIAL badges, baked-in outfit/weapon) are
// its own. The row projection lives in AddSpecialDwellerDialog (it needs gameData).

/** A projected unique-dweller catalog row. */
export interface SpecialRow {
  uniqueId: string;
  fullName: string;
  genderLabel: string;
  /** [S,P,E,C,I,A,L]. */
  stats: number[];
  outfitId: string;
  outfit: string;
  /** SPECIAL bonus summary, e.g. "+3 S +2 P" (empty if none/unknown). */
  outfitBonus: string;
  weaponId: string;
  weapon: string;
  /** Damage range "min–max" (empty if unknown). */
  weaponDamage: string;
}

const SPECIAL_LABELS = ['S', 'P', 'E', 'C', 'I', 'A', 'L'] as const;

export function specialDwellerSchema(): TableSchema<SpecialRow> {
  return {
    name: 'specialDweller',
    hideable: [
      { id: 'fullName', label: 'Name' },
      { id: 'genderLabel', label: 'Gender' },
      { id: 'special', label: 'SPECIAL' },
      { id: 'outfit', label: 'Outfit' },
      { id: 'weapon', label: 'Weapon' },
    ],
    columns: [
      { id: 'fullName', accessorKey: 'fullName', header: 'Name' },
      { id: 'genderLabel', accessorKey: 'genderLabel', header: 'Gender', size: 90 },
      {
        id: 'special',
        header: 'SPECIAL',
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ row }) => (
          <div className="flex gap-0.5">
            {row.original.stats.map((v, i) => (
              <span key={SPECIAL_LABELS[i]} title={`${SPECIAL_LABELS[i]} ${v}`}>
                <StatBadge value={v} />
              </span>
            ))}
          </div>
        ),
        size: 200,
      },
      {
        id: 'outfit',
        accessorKey: 'outfit',
        header: 'Outfit',
        cell: ({ row }) => {
          const { outfitId, outfit, outfitBonus } = row.original;
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <ItemIcon type="outfits" id={outfitId} />
              <span className="truncate" title={outfitBonus ? `${outfit} ${outfitBonus}` : outfit}>
                {outfit}
                {outfitBonus && <span className="text-neutral-400"> {outfitBonus}</span>}
              </span>
            </span>
          );
        },
      },
      {
        id: 'weapon',
        accessorKey: 'weapon',
        header: 'Weapon',
        cell: ({ row }) => {
          const { weaponId, weapon, weaponDamage } = row.original;
          const dmg = weaponDamage ? ` (${weaponDamage})` : '';
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <ItemIcon type="weapons" id={weaponId} />
              <span className="truncate" title={`${weapon}${dmg}`}>
                {weapon}
                <span className="text-neutral-400">{dmg}</span>
              </span>
            </span>
          );
        },
      },
    ],
  };
}
