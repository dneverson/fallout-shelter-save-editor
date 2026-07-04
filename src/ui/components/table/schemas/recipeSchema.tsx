import type { RecipeRow } from '../../../../domain/items/recipeCatalog.ts';
import { iconColumn, inSelectedSet } from '../columnKit.tsx';
import type { TableSchema } from '../tableSchema.ts';

// Source-of-truth schema for the RECIPES catalog: icon · name · type
// (Weapon/Outfit/Theme) · collection status. Weapon/outfit recipes reuse the item sprite;
// theme recipes have no item sprite and show a neutral chip. The select column and the
// per-row Build/Apply actions are supplied by RecipesView (they need store callbacks).

/** A catalog row enriched with the current save's per-recipe state. */
export interface RecipeViewRow extends RecipeRow {
  /** Present in `survivalW.recipes`. */
  known: boolean;
  /** Themes only: a fully-crafted themeList entry exists. */
  built: boolean;
  /** Themes only: applied to its room type in `themeByRoomType`. */
  applied: boolean;
}

/** Coarse, filterable status label (also the sort key) for the status column. */
function recipeStatusLabel(row: RecipeViewRow): string {
  if (row.kind !== 'Theme') return row.known ? 'In collection' : 'Missing';
  if (row.applied) return 'Applied';
  if (row.built) return 'Built';
  if (row.known) return 'Known';
  return 'Missing';
}

/** A small on/off state pill (green when set, muted when not). */
const stateChip = (on: boolean, label: string) => (
  <span
    key={label}
    className={`rounded px-1.5 py-0.5 text-[11px] ${
      on ? 'bg-emerald-900/50 text-emerald-300' : 'bg-neutral-800 text-neutral-500'
    }`}
  >
    {label}
  </span>
);

function statusCell(row: RecipeViewRow) {
  if (row.kind === 'Theme') {
    return (
      <span className="flex flex-wrap items-center gap-1">
        {stateChip(row.known, 'Known')}
        {stateChip(row.built, 'Built')}
        {stateChip(row.applied, 'Applied')}
      </span>
    );
  }
  return row.known ? (
    <span className="text-emerald-300">In collection</span>
  ) : (
    <span className="text-neutral-500">Missing</span>
  );
}

export function recipeSchema(): TableSchema<RecipeViewRow> {
  return {
    name: 'recipe',
    hideable: [
      { id: 'name', label: 'Name' },
      { id: 'kind', label: 'Type' },
      { id: 'status', label: 'Status' },
    ],
    columns: [
      iconColumn<RecipeViewRow>(
        (r) =>
          r.kind === 'Weapon'
            ? { type: 'weapons', id: r.id }
            : r.kind === 'Outfit'
              ? { type: 'outfits', id: r.id }
              : null,
        <span
          aria-hidden="true"
          className="inline-block h-[22px] w-[22px] shrink-0 rounded-sm bg-neutral-800"
        />,
      ),
      {
        id: 'name',
        accessorFn: (r) => r.name,
        header: 'Name',
        cell: ({ getValue }) => {
          const name = getValue<string>();
          return <span title={name}>{name}</span>;
        },
        size: 240,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Name' },
      },
      {
        id: 'kind',
        accessorFn: (r) => r.kind,
        header: 'Type',
        size: 110,
        filterFn: inSelectedSet<RecipeViewRow>(),
        meta: { filterVariant: 'select', headerLabel: 'Type' },
      },
      {
        id: 'status',
        accessorFn: (r) => recipeStatusLabel(r),
        header: 'Status',
        cell: ({ row }) => statusCell(row.original),
        size: 200,
        filterFn: inSelectedSet<RecipeViewRow>(),
        meta: { filterVariant: 'select', headerLabel: 'Status' },
      },
    ],
  };
}
