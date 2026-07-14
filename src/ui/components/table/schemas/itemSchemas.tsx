import type { ColumnDef } from '@tanstack/react-table';
import type {
  GameEnums,
  Junk,
  Outfit,
  Special,
  Weapon,
} from '../../../../domain/gamedata/schemas.ts';
import {
  SPECIAL_KEYS,
  formatAvgDamage,
  outfitSpecialTotal,
  weaponAvgDamage,
} from '../../../../domain/gamedata/itemStats.ts';
import { iconColumn, inSelectedSet, nameCell } from '../columnKit.tsx';
import type { TableSchema } from '../tableSchema.ts';

// Source-of-truth schemas for the game-data ITEM tables - weapons, outfits, junk.
// One full column set per type; every location (catalog views, equip picker, add
// dialog, character sheet, loadout panel) renders the same schema and picks a preset. The
// leading select/badge and trailing actions columns are supplied per location, not here.

/** A compact, sortable per-stat cell: the bonus when positive, a muted dot otherwise. */
function statCell(value: number) {
  return value > 0 ? (
    <span className="text-neutral-100">{value}</span>
  ) : (
    <span className="text-neutral-600">·</span>
  );
}

// The three craft-status labels, doubling as the select-filter options and the sort keys.
const CRAFT_OWNED = 'In collection';
const CRAFT_YES = 'Craftable';
const CRAFT_NONE = 'Not craftable';

/**
 * Wiring for the optional "Craftable" column on the standalone weapon/outfit catalogs.
 * `craftableIds` are the item ids that have a recipe (recipe id == item id); `knownIds` are
 * the recipe ids already in the loaded save's collection (null when no save is loaded, so
 * we can only say craftable / not). `onOpen` jumps to the Recipes tab focused on that recipe.
 */
export interface CraftableColumnOptions {
  craftableIds: ReadonlySet<string>;
  knownIds: ReadonlySet<string> | null;
  onOpen: (id: string) => void;
}

function craftStatus(id: string, c: CraftableColumnOptions): string {
  if (!c.craftableIds.has(id)) return CRAFT_NONE;
  if (c.knownIds?.has(id)) return CRAFT_OWNED;
  return CRAFT_YES;
}

/**
 * The tri-state "Craftable" column shown only on the standalone catalog views: a muted dot
 * for non-craftable items, otherwise a clickable link that opens the recipe in the Recipes
 * tab - emerald "In collection" when the save already owns the recipe, amber "Craftable"
 * when it doesn't, and neutral "Craftable" when no save is loaded (collection unknown).
 */
function craftableColumn<T extends { id: string }>(c: CraftableColumnOptions): ColumnDef<T> {
  return {
    id: 'craftable',
    accessorFn: (row) => craftStatus((row as { id: string }).id, c),
    header: 'Craftable',
    size: 130,
    cell: ({ row }) => {
      const id = (row.original as { id: string }).id;
      if (!c.craftableIds.has(id)) return <span className="text-neutral-600">·</span>;
      const owned = !!c.knownIds?.has(id);
      const tone = owned
        ? 'text-emerald-300 hover:text-emerald-200'
        : c.knownIds
          ? 'text-amber-300 hover:text-amber-200'
          : 'text-sky-300 hover:text-sky-200';
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            c.onOpen(id);
          }}
          title={
            owned
              ? 'Recipe is in your collection. Open in the Recipes tab.'
              : 'Craftable. Open the recipe in the Recipes tab.'
          }
          className={`underline decoration-dotted underline-offset-2 ${tone}`}
        >
          {owned ? 'In collection ✓' : 'Craftable'}
        </button>
      );
    },
    filterFn: inSelectedSet<T>(),
    meta: { filterVariant: 'select', headerLabel: 'Craftable' },
  };
}

/** Invert an enum (name → value) into value → name for label display. */
function enumLabels(enums: GameEnums | undefined, name: string): Map<number, string> {
  const map = new Map<number, string>();
  const e = enums?.[name];
  if (e) for (const [k, v] of Object.entries(e)) if (!map.has(v)) map.set(v, k);
  return map;
}

export function weaponSchema(
  enums?: GameEnums,
  craft?: CraftableColumnOptions,
): TableSchema<Weapon> {
  const types = enumLabels(enums, 'EWeaponType');
  return {
    name: 'weapon',
    hideable: [
      { id: 'name', label: 'Name' },
      { id: 'damage', label: 'Damage' },
      { id: 'avgDamage', label: 'Avg dmg' },
      { id: 'type', label: 'Type' },
      { id: 'rarity', label: 'Rarity' },
      ...(craft ? [{ id: 'craftable', label: 'Craftable' }] : []),
    ],
    columns: [
      iconColumn<Weapon>((w) => ({ type: 'weapons', id: w.id })),
      {
        id: 'name',
        accessorFn: (w) => w.name,
        header: 'Name',
        cell: ({ getValue }) => nameCell(getValue<string>()),
        size: 200,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Name' },
      },
      {
        id: 'damage',
        accessorFn: (w) => w.damageMax,
        header: 'Damage',
        cell: ({ row }) => `${row.original.damageMin}–${row.original.damageMax}`,
        size: 96,
      },
      {
        id: 'avgDamage',
        accessorFn: (w) => weaponAvgDamage(w),
        header: 'Avg dmg',
        cell: ({ getValue }) => formatAvgDamage(getValue<number>()),
        size: 90,
        filterFn: 'inNumberRange',
        meta: { filterVariant: 'range', headerLabel: 'Avg dmg' },
      },
      {
        id: 'type',
        accessorFn: (w) => types.get(w.type) ?? String(w.type),
        header: 'Type',
        size: 120,
        filterFn: inSelectedSet<Weapon>(),
        meta: { filterVariant: 'select', headerLabel: 'Type' },
      },
      {
        id: 'rarity',
        accessorFn: (w) => w.rarity,
        header: 'Rarity',
        size: 110,
        filterFn: inSelectedSet<Weapon>(),
        meta: { filterVariant: 'select', headerLabel: 'Rarity' },
      },
      ...(craft ? [craftableColumn<Weapon>(craft)] : []),
    ],
  };
}

export function junkSchema(): TableSchema<Junk> {
  return {
    name: 'junk',
    hideable: [
      { id: 'name', label: 'Name' },
      { id: 'value', label: 'Value' },
      { id: 'rarity', label: 'Rarity' },
    ],
    columns: [
      iconColumn<Junk>((j) => ({ type: 'junk', id: j.id })),
      {
        id: 'name',
        accessorFn: (j) => j.name,
        header: 'Name',
        cell: ({ getValue }) => nameCell(getValue<string>()),
        size: 240,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Name' },
      },
      {
        id: 'value',
        accessorFn: (j) => j.value,
        header: 'Value',
        size: 90,
        filterFn: 'inNumberRange',
        meta: { filterVariant: 'range', headerLabel: 'Value' },
      },
      {
        id: 'rarity',
        accessorFn: (j) => j.rarity,
        header: 'Rarity',
        size: 110,
        filterFn: inSelectedSet<Junk>(),
        meta: { filterVariant: 'select', headerLabel: 'Rarity' },
      },
    ],
  };
}

/** The 7 per-stat SPECIAL columns for outfit tables (each sortable + range-filterable). */
function outfitStatColumns(): ColumnDef<Outfit>[] {
  return SPECIAL_KEYS.map((k) => ({
    id: `special_${k}`,
    accessorFn: (o: Outfit) => o.special[k as keyof Special],
    header: k,
    cell: ({ getValue }) => statCell(getValue<number>()),
    size: 44,
    filterFn: 'inNumberRange',
    meta: { filterVariant: 'range', headerLabel: k },
  }));
}

export function outfitSchema(
  enums?: GameEnums,
  craft?: CraftableColumnOptions,
): TableSchema<Outfit> {
  const categories = enumLabels(enums, 'EOutfitCategory');
  return {
    name: 'outfit',
    hideable: [
      { id: 'name', label: 'Name' },
      { id: 'special', label: 'Σ SPECIAL' },
      ...SPECIAL_KEYS.map((k) => ({ id: `special_${k}`, label: k })),
      { id: 'type', label: 'Type' },
      { id: 'rarity', label: 'Rarity' },
      ...(craft ? [{ id: 'craftable', label: 'Craftable' }] : []),
    ],
    columns: [
      iconColumn<Outfit>((o) => ({ type: 'outfits', id: o.id })),
      {
        id: 'name',
        accessorFn: (o) => o.name,
        header: 'Name',
        cell: ({ getValue }) => nameCell(getValue<string>()),
        size: 200,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Name' },
      },
      {
        // Σ = sum of all SPECIAL bonuses, so users can sort by total outfit power;
        // per-stat columns below give "best +Agility outfit" sorting.
        id: 'special',
        accessorFn: (o) => outfitSpecialTotal(o.special),
        header: 'Σ',
        size: 64,
        filterFn: 'inNumberRange',
        meta: { filterVariant: 'range', headerLabel: 'Σ SPECIAL' },
      },
      ...outfitStatColumns(),
      {
        id: 'type',
        accessorFn: (o) => categories.get(o.category) ?? String(o.category),
        header: 'Type',
        size: 120,
        filterFn: inSelectedSet<Outfit>(),
        meta: { filterVariant: 'select', headerLabel: 'Type' },
      },
      {
        id: 'rarity',
        accessorFn: (o) => o.rarity,
        header: 'Rarity',
        size: 110,
        filterFn: inSelectedSet<Outfit>(),
        meta: { filterVariant: 'select', headerLabel: 'Rarity' },
      },
      ...(craft ? [craftableColumn<Outfit>(craft)] : []),
    ],
  };
}
