import { useMemo, useState, type ReactNode } from 'react';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { useSaveStore } from '../../state/saveStore.ts';
import { useGameData } from '../hooks/useGameData.ts';
import { pushToast } from '../../state/toastStore.ts';
import { UnifiedTable } from '../components/table/UnifiedTable.tsx';
import { selectColumn } from '../components/table/columnKit.tsx';
import { buildRecipeRows } from '../../domain/items/recipeCatalog.ts';
import { recipeSchema, type RecipeViewRow } from '../components/table/schemas/recipeSchema.tsx';
import {
  addRecipes,
  applyThemeRecipe,
  buildTheme,
  isThemeApplied,
  isThemeBuilt,
  recipeKnown,
  removeRecipes,
  unapplyThemeRecipe,
  unbuildTheme,
} from '../../domain/ops/recipeOps.ts';

// Standalone Recipes catalog section: a browsable,
// searchable, type/status-filterable reference over every craftable recipe in game data,
// joined to real weapon/outfit names + icons (recipeCatalog). Selecting rows adds/removes
// them from the known-recipe collection (`survivalW.recipes`); theme rows additionally
// expose the get → build → apply lifecycle via per-row Build/Apply actions. Built on the
// generic <DataTable> directly (rather than ItemCatalogSection, whose add-to-storage/equip
// actions don't apply to recipes). jsdom has no layout, so tests pass `virtualized={false}`.
export function RecipesView({ virtualized = true }: { virtualized?: boolean } = {}) {
  const save = useSaveStore((s) => s.save);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const { data: gameData, status: gameDataStatus } = useGameData();

  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const rows = useMemo<RecipeViewRow[]>(() => {
    const catalog = buildRecipeRows(gameData ?? undefined);
    return catalog.map((r) => {
      const built = save && r.kind === 'Theme' ? isThemeBuilt(save, r.id) : false;
      const applied = save && r.kind === 'Theme' ? isThemeApplied(save, r.id) : false;
      // Built/applied logically imply the recipe is known (the game stores these as
      // independent fields that can disagree), so fold them into the displayed `known`.
      const known = (save ? recipeKnown(save, r.id) : false) || built || applied;
      return { ...r, known, built, applied };
    });
  }, [gameData, save]);

  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection],
  );
  const clearSelection = (): void => setRowSelection({});

  const onAddToCollection = (ids: string[]): void => {
    if (ids.length === 0) return;
    applyEdit((s) => addRecipes(s, ids), `Add ${ids.length} to recipes`);
    pushToast(`Added ${ids.length} to recipe collection.`);
    clearSelection();
  };

  const onRemoveFromCollection = (ids: string[]): void => {
    if (ids.length === 0) return;
    applyEdit((s) => removeRecipes(s, ids), `Remove ${ids.length} from recipes`);
    pushToast(`Removed ${ids.length} from recipe collection.`);
    clearSelection();
  };

  const onToggleCollection = (row: RecipeViewRow): void => {
    if (row.known) {
      // Remove cascades for theme recipes (also un-applies + un-builds).
      applyEdit((s) => removeRecipes(s, [row.id]), `Remove ${row.name} from recipes`);
      pushToast(`Removed ${row.name} from recipe collection.`);
    } else {
      applyEdit((s) => addRecipes(s, [row.id]), `Add ${row.name} to recipes`);
      pushToast(`Added ${row.name} to recipe collection.`);
    }
  };

  const onToggleBuild = (row: RecipeViewRow): void => {
    applyEdit(
      (s) => (row.built ? unbuildTheme(s, row.id) : buildTheme(s, row.id)),
      `${row.built ? 'Unbuild' : 'Build'} ${row.name}`,
    );
  };

  const onToggleApply = (row: RecipeViewRow): void => {
    applyEdit(
      (s) => (row.applied ? unapplyThemeRecipe(s, row.id) : applyThemeRecipe(s, row.id)),
      `${row.applied ? 'Unapply' : 'Apply'} ${row.name}`,
    );
  };

  // Header bulk actions (no selection needed): unlock the whole catalog, and build every
  // theme. Each is ONE applyEdit = one undo step, disabled when there is nothing to do.
  const unknownIds = useMemo(() => rows.filter((r) => !r.known).map((r) => r.id), [rows]);
  const unbuiltThemeIds = useMemo(
    () => rows.filter((r) => r.kind === 'Theme' && !r.built).map((r) => r.id),
    [rows],
  );
  const unlockAll = (): void => {
    applyEdit((s) => addRecipes(s, unknownIds), 'Unlock all recipes');
    pushToast(`Unlocked ${unknownIds.length} recipe${unknownIds.length === 1 ? '' : 's'}.`);
  };
  const buildAllThemes = (): void => {
    // buildTheme also ensures the recipe is known, so this covers locked themes too.
    applyEdit(
      (s) => unbuiltThemeIds.reduce((acc, id) => buildTheme(acc, id), s),
      'Build all themes',
    );
    pushToast(`Built ${unbuiltThemeIds.length} theme${unbuiltThemeIds.length === 1 ? '' : 's'}.`);
  };

  const schema = useMemo(() => recipeSchema(), []);
  const leading = useMemo(() => [selectColumn<RecipeViewRow>((r) => r.name)], []);

  // A theme-aware Build/Apply actions column (location-specific: conditional buttons +
  // disabled-while-no-save) appended after the schema's data columns.
  const trailing = useMemo<ColumnDef<RecipeViewRow>[]>(() => {
    const actionsColumn: ColumnDef<RecipeViewRow> = {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const r = row.original;
        return (
          <span className="flex gap-1">
            <button
              type="button"
              disabled={!save}
              title={r.known ? 'Remove from collection' : 'Add to collection'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollection(r);
              }}
              className={`rounded border px-2 py-0.5 text-xs disabled:opacity-40 ${
                r.known
                  ? 'border-red-800 text-red-300 hover:bg-red-900/40'
                  : 'border-emerald-700 text-emerald-300 hover:bg-emerald-900/40'
              }`}
            >
              {r.known ? 'Remove' : 'Add'}
            </button>
            {r.kind === 'Theme' && (
              <>
                <button
                  type="button"
                  disabled={!save}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleBuild(r);
                  }}
                  className="rounded border border-sky-700 px-2 py-0.5 text-xs text-sky-300 hover:bg-sky-900/40 disabled:opacity-40"
                >
                  {r.built ? 'Unbuild' : 'Build'}
                </button>
                <button
                  type="button"
                  disabled={!save}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleApply(r);
                  }}
                  className="rounded border border-amber-700 px-2 py-0.5 text-xs text-amber-300 hover:bg-amber-900/40 disabled:opacity-40"
                >
                  {r.applied ? 'Unapply' : 'Apply'}
                </button>
              </>
            )}
          </span>
        );
      },
      size: 250,
      enableSorting: false,
      enableColumnFilter: false,
    };
    return [actionsColumn];
    // onToggleBuild/onToggleApply close over the current `save`; rebuild when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save]);

  const renderToolbar = ({ columnsMenu }: { columnsMenu: ReactNode }): ReactNode => (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={globalFilter}
        onChange={(e) => setGlobalFilter(e.target.value)}
        placeholder="Search recipes…"
        aria-label="Search recipes"
        className="w-64 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder-neutral-500"
      />
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onAddToCollection(selectedIds)}
            className="rounded border border-emerald-700 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40"
          >
            Add to collection ({selectedIds.length})
          </button>
          <button
            type="button"
            onClick={() => onRemoveFromCollection(selectedIds)}
            className="rounded border border-red-800 px-3 py-1 text-xs text-red-300 hover:bg-red-900/40"
          >
            Remove from collection ({selectedIds.length})
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-100"
          >
            Clear
          </button>
        </div>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!save || unknownIds.length === 0}
          onClick={unlockAll}
          title={
            unknownIds.length === 0
              ? 'Every recipe is already in the collection'
              : `Add all ${unknownIds.length} missing recipes to the collection`
          }
          className="rounded border border-emerald-700 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Unlock all{unknownIds.length > 0 ? ` (${unknownIds.length})` : ''}
        </button>
        <button
          type="button"
          disabled={!save || unbuiltThemeIds.length === 0}
          onClick={buildAllThemes}
          title={
            unbuiltThemeIds.length === 0
              ? 'Every theme is already built'
              : `Mark all ${unbuiltThemeIds.length} unbuilt themes as fully crafted`
          }
          className="rounded border border-sky-700 px-3 py-1 text-xs text-sky-300 hover:bg-sky-900/40 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Build all themes{unbuiltThemeIds.length > 0 ? ` (${unbuiltThemeIds.length})` : ''}
        </button>
        {columnsMenu}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">Recipes</h2>
        <span className="text-sm text-neutral-400">{rows.length} recipes</span>
        {gameDataStatus === 'loading' && (
          <span className="text-xs text-neutral-400">loading game data…</span>
        )}
        {gameDataStatus === 'error' && (
          <span className="text-xs text-amber-500">game data unavailable</span>
        )}
      </div>

      <UnifiedTable<RecipeViewRow>
        className="mt-3 min-h-0 flex-1"
        virtualized={virtualized}
        schema={schema}
        persistKey="recipes"
        leading={leading}
        trailing={trailing}
        data={rows}
        getRowId={(r) => r.id}
        toolbar={renderToolbar}
        initialSorting={[{ id: 'name', desc: false }]}
        enableGlobalFilter
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        emptyState="No recipes match the search."
      />
    </div>
  );
}
