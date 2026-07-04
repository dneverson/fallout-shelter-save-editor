import type { ColumnDef, Row } from '@tanstack/react-table';
import type { DwellerRow, SpecialValues } from '../../../../domain/selectors/dwellerSelectors.ts';
import type { Special } from '../../../../domain/gamedata/schemas.ts';
import { weaponAvgDamage } from '../../../../domain/gamedata/itemStats.ts';
import { StatBadge } from '../../dwellers/StatBadge.tsx';
import { DwellerThumbnailCell, HealthCell } from '../../dwellers/dwellerCells.tsx';
import { ItemIcon } from '../../ItemIcon.tsx';
import { inSelectedSet } from '../columnKit.tsx';
import type { TableSchema } from '../tableSchema.ts';

// Source-of-truth schema for the DWELLER roster. The full data column set;
// every dweller table (the roster, the equip-on-dwellers chooser, the pet-assign picker)
// renders this schema and picks a preset. The leading select checkbox + any picker-specific
// columns (a "current slot" column) are supplied per location. `onRevive` is optional: the
// roster wires the inline Revive button into the Health cell; pickers omit it (plain hp).

export interface DwellerSchemaHandlers {
  onRevive?: (serializeId: number) => void;
}

const SPECIAL_KEYS = ['S', 'P', 'E', 'C', 'I', 'A', 'L'] as const;

/** Hideable/reorderable columns (everything except picker-supplied select/current). */
const HIDEABLE_DWELLER_COLUMNS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'thumbnail', label: 'Thumbnail' },
  { id: 'name', label: 'Name' },
  { id: 'weapon', label: 'Weapon' },
  { id: 'outfit', label: 'Outfit' },
  { id: 'pet', label: 'Pet' },
  { id: 'level', label: 'Level' },
  { id: 's', label: 'Strength' },
  { id: 'p', label: 'Perception' },
  { id: 'e', label: 'Endurance' },
  { id: 'c', label: 'Charisma' },
  { id: 'i', label: 'Intelligence' },
  { id: 'a', label: 'Agility' },
  { id: 'l', label: 'Luck' },
  { id: 'happiness', label: 'Happiness' },
  { id: 'health', label: 'Health' },
  { id: 'rarity', label: 'Rarity' },
  { id: 'gender', label: 'Gender' },
  { id: 'pregnant', label: 'Pregnant' },
  { id: 'babyReady', label: 'Baby ready' },
  { id: 'assignment', label: 'Assignment' },
];

const GENDER_LABEL: Record<number, string> = { 1: 'Female', 2: 'Male' };

/** Roster weapon avg damage for sorting; missing/unknown sorts lowest. */
function rowWeaponAvg(row: Row<DwellerRow>): number {
  const w = row.original.weapon;
  if (!w || w.damageMin == null || w.damageMax == null) return -1;
  return weaponAvgDamage({ damageMin: w.damageMin, damageMax: w.damageMax });
}

function summarizeOutfitSpecial(special: Special | null): string {
  if (!special) return '';
  return SPECIAL_KEYS.filter((k) => special[k] > 0)
    .map((k) => `+${special[k]} ${k}`)
    .join(' ');
}

export function dwellerSchema({ onRevive }: DwellerSchemaHandlers = {}): TableSchema<DwellerRow> {
  const statColumn = (
    id: (typeof SPECIAL_KEYS)[number],
    header: string,
  ): ColumnDef<DwellerRow> => ({
    id: id.toLowerCase(),
    accessorFn: (d) => d.special[id as keyof SpecialValues],
    header,
    cell: ({ getValue }) => <StatBadge value={getValue<number>()} />,
    size: 44,
    filterFn: 'inNumberRange',
    meta: { filterVariant: 'range' },
  });

  // Yes/No flag column: the accessor yields the literal "Yes"/"No" so the select filter
  // facets cleanly (like Gender), while the cell shows "Yes" or a muted dash.
  const boolColumn = (
    id: string,
    get: (d: DwellerRow) => boolean,
    header: string,
  ): ColumnDef<DwellerRow> => ({
    id,
    accessorFn: (d) => (get(d) ? 'Yes' : 'No'),
    header,
    cell: ({ getValue }) =>
      getValue<string>() === 'Yes' ? (
        <span className="text-amber-300">Yes</span>
      ) : (
        <span className="text-neutral-400">–</span>
      ),
    size: 96,
    filterFn: inSelectedSet<DwellerRow>(),
    meta: { filterVariant: 'select', headerLabel: header },
  });

  return {
    name: 'dweller',
    hideable: HIDEABLE_DWELLER_COLUMNS,
    columns: [
      {
        id: 'thumbnail',
        header: '',
        cell: ({ row }) => <DwellerThumbnailCell serializeId={row.original.serializeId} />,
        size: 56,
        enableSorting: false,
        enableColumnFilter: false,
      },
      {
        id: 'name',
        accessorFn: (d) => (d.lastName ? `${d.name} ${d.lastName}` : d.name),
        header: 'Name',
        // Full name on hover (finding 4): the column truncates in compact/narrow layouts.
        cell: ({ getValue }) => {
          const name = getValue<string>();
          return <span title={name}>{name}</span>;
        },
        size: 160,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Name' },
      },
      {
        id: 'weapon',
        accessorFn: (d) => d.weapon?.name ?? '',
        header: 'Weapon',
        // Display + text-filter by name, but SORT by avg damage so the column ranks weapons
        // by strength (shared weaponAvgDamage).
        sortingFn: (a, b) => rowWeaponAvg(a) - rowWeaponAvg(b),
        cell: ({ row }) => {
          const w = row.original.weapon;
          if (!w) return <span className="text-neutral-400">–</span>;
          const dmg =
            w.damageMin != null && w.damageMax != null ? ` (${w.damageMin}–${w.damageMax})` : '';
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <ItemIcon type="weapons" id={w.id} />
              <span className="truncate" title={`${w.name}${dmg}`}>
                {w.name}
                <span className="text-neutral-400">{dmg}</span>
              </span>
            </span>
          );
        },
        size: 168,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Weapon' },
      },
      {
        id: 'outfit',
        accessorFn: (d) => d.outfit?.name ?? '',
        header: 'Outfit',
        cell: ({ row }) => {
          const o = row.original.outfit;
          if (!o) return <span className="text-neutral-400">–</span>;
          const bonus = summarizeOutfitSpecial(o.special);
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <ItemIcon type="outfits" id={o.id} />
              <span className="truncate" title={bonus ? `${o.name} ${bonus}` : o.name}>
                {o.name}
                {bonus && <span className="text-neutral-400"> {bonus}</span>}
              </span>
            </span>
          );
        },
        size: 176,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Outfit' },
      },
      {
        id: 'pet',
        accessorFn: (d) => d.pet?.breed ?? '',
        header: 'Pet',
        cell: ({ row }) => {
          const p = row.original.pet;
          if (!p) return <span className="text-neutral-400">–</span>;
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <ItemIcon type="pets" id={p.id} />
              <span
                className="truncate"
                title={
                  p.bonus ? `${p.uniqueName ?? p.breed} · ${p.bonus}` : (p.uniqueName ?? p.breed)
                }
              >
                {p.uniqueName ?? p.breed}
                {p.bonus && <span className="text-neutral-400"> · {p.bonus}</span>}
              </span>
            </span>
          );
        },
        size: 150,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Pet' },
      },
      {
        id: 'level',
        accessorFn: (d) => d.level,
        header: 'Level',
        cell: ({ getValue }) => getValue<number | null>() ?? '–',
        size: 72,
        filterFn: 'inNumberRange',
        meta: { filterVariant: 'range', headerLabel: 'Level' },
      },
      statColumn('S', 'S'),
      statColumn('P', 'P'),
      statColumn('E', 'E'),
      statColumn('C', 'C'),
      statColumn('I', 'I'),
      statColumn('A', 'A'),
      statColumn('L', 'L'),
      {
        id: 'happiness',
        accessorFn: (d) => d.happiness,
        header: 'Happy',
        cell: ({ getValue }) => getValue<number | null>() ?? '–',
        size: 90,
        filterFn: 'inNumberRange',
        meta: { filterVariant: 'range', headerLabel: 'Happiness' },
      },
      {
        id: 'health',
        accessorFn: (d) => d.health,
        header: 'Health',
        cell: ({ row }) =>
          onRevive ? (
            <HealthCell row={row} onRevive={onRevive} />
          ) : (
            <span className="tabular-nums">
              {row.original.health ?? '–'}
              {row.original.maxHealth != null ? ` / ${row.original.maxHealth}` : ''}
            </span>
          ),
        size: 132,
        filterFn: 'inNumberRange',
        meta: { filterVariant: 'range', headerLabel: 'Health' },
      },
      {
        id: 'rarity',
        accessorFn: (d) => d.rarity ?? '',
        header: 'Rarity',
        cell: ({ getValue }) => getValue<string>() || '–',
        size: 104,
        filterFn: inSelectedSet<DwellerRow>(),
        meta: { filterVariant: 'select', headerLabel: 'Rarity' },
      },
      {
        id: 'gender',
        accessorFn: (d) => (d.gender != null ? (GENDER_LABEL[d.gender] ?? String(d.gender)) : '–'),
        header: 'Gender',
        size: 90,
        filterFn: inSelectedSet<DwellerRow>(),
        meta: { filterVariant: 'select', headerLabel: 'Gender' },
      },
      boolColumn('pregnant', (d) => d.pregnant, 'Pregnant'),
      boolColumn('babyReady', (d) => d.babyReady, 'Baby ready'),
      {
        id: 'assignment',
        accessorFn: (d) => d.location.label,
        header: 'Assignment',
        size: 140,
        filterFn: inSelectedSet<DwellerRow>(),
        meta: { filterVariant: 'select', headerLabel: 'Assignment' },
      },
    ],
  };
}
