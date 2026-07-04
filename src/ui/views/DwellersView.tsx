import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useSaveStore } from '../../state/saveStore.ts';
import { useUIStore, type DwellerQuickFilters } from '../../state/uiStore.ts';
import { useSectionNavigate } from '../routing/useSectionNavigate.ts';
import { useGameData } from '../hooks/useGameData.ts';
import {
  selectDwellerById,
  selectDwellerRows,
  type DwellerRow,
} from '../../domain/selectors/dwellerSelectors.ts';
import { reviveAll } from '../../domain/ops/bulkOps.ts';
import {
  addSpecialDweller,
  createDwellerAtDoor,
  DEFAULT_OUTFIT_ID,
  DEFAULT_WEAPON_ID,
  setLevel,
  type NewDwellerOpts,
} from '../../domain/ops/dwellerOps.ts';
import { pushToast } from '../../state/toastStore.ts';
import { UnifiedTable } from '../components/table/UnifiedTable.tsx';
import { selectColumn } from '../components/table/columnKit.tsx';
import { dwellerSchema } from '../components/table/schemas/dwellerSchema.tsx';
import { ResizableSplit } from '../components/ResizableSplit.tsx';
import { BulkActionBar } from '../components/dwellers/BulkActionBar.tsx';
import { CharacterSheet } from '../components/dwellers/CharacterSheet.tsx';
import { AddDwellerDialog } from '../components/dwellers/AddDwellerDialog.tsx';
import { AddSpecialDwellerDialog } from '../components/dwellers/AddSpecialDwellerDialog.tsx';

// Dwellers roster screen. Projects the save into
// table rows (enriched with game data when available), then drives the reusable
// <DataTable> with view state from uiStore: persisted layout (sort/visibility/
// order) and session filters (search, per-column, quick chips). Slot/Dead quick
// chips are row predicates applied before the table; per-column + global filters run
// inside the table. Selecting a row opens the editable <CharacterSheet>.

function passesQuickFilters(row: DwellerRow, q: DwellerQuickFilters): boolean {
  // Fist/jumpsuit are the bare starter defaults - there is no empty slot in-game - so these
  // chips surface dwellers still on the default gear (the ones who need a real weapon/outfit).
  if (q.fistOnly && row.weapon?.id !== DEFAULT_WEAPON_ID) return false;
  if (q.vaultSuitOnly && row.outfit?.id !== DEFAULT_OUTFIT_ID) return false;
  if (q.emptyPet && row.pet) return false;
  if (q.deadOnly && !row.isDead) return false;
  return true;
}

const QUICK_CHIPS: ReadonlyArray<{ key: keyof DwellerQuickFilters; label: string }> = [
  { key: 'fistOnly', label: 'Fist only' },
  { key: 'vaultSuitOnly', label: 'Vault suit only' },
  { key: 'emptyPet', label: 'No pet' },
  { key: 'deadOnly', label: 'Dead only' },
];

export function DwellersView({ virtualized = true }: { virtualized?: boolean } = {}) {
  const save = useSaveStore((s) => s.save);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const { data: gameData, status: gameDataStatus } = useGameData();

  // Persisted column layout (sort/visibility/order/sizing) is owned by <UnifiedTable> via the
  // 'dwellers' key; session filters (search, per-column, quick chips, selection) stay here.
  const columnFilters = useUIStore((s) => s.dwellerColumnFilters);
  const setColumnFilters = useUIStore((s) => s.setDwellerColumnFilters);
  const globalFilter = useUIStore((s) => s.dwellerGlobalFilter);
  const setGlobalFilter = useUIStore((s) => s.setDwellerGlobalFilter);
  const quickFilters = useUIStore((s) => s.dwellerQuickFilters);
  const setQuickFilter = useUIStore((s) => s.setDwellerQuickFilter);
  const resetFilters = useUIStore((s) => s.resetDwellerFilters);
  // Selection lives in the URL (#/dwellers/:id) - deep-linkable + back-forward aware.
  const { detail } = useParams();
  const goTo = useSectionNavigate();
  const selectedDwellerId = detail != null && /^\d+$/.test(detail) ? Number(detail) : null;
  const panelWidth = useUIStore((s) => s.detailPanelWidth);
  const setPanelWidth = useUIStore((s) => s.setDetailPanelWidth);
  // Session-only in the store (not local state) so the bulk selection survives leaving the
  // Dwellers tab and coming back, instead of being dropped when the view unmounts.
  const rowSelection = useUIStore((s) => s.dwellerRowSelection);
  const setRowSelection = useUIStore((s) => s.setDwellerRowSelection);

  const [addOpen, setAddOpen] = useState(false);
  const [addSpecialOpen, setAddSpecialOpen] = useState(false);

  // Create a dweller, then open it in the sheet. The op appends it, so the new dweller
  // is the last in the (post-edit) list - read it back from the store to get its id.
  const handleCreate = useCallback(
    (opts: NewDwellerOpts) => {
      applyEdit((s) => createDwellerAtDoor(s, opts), 'Add dweller');
      const list = useSaveStore.getState().save?.dwellers?.dwellers ?? [];
      const created = list[list.length - 1];
      if (created) goTo('dwellers', created.serializeId);
    },
    [applyEdit, goTo],
  );

  // Add a named special dweller from the catalog, then open it in the sheet (read-back
  // for its id, like handleCreate). safety net: the extracted catalog ids are all
  // real game ids, but if one were ever unknown we substitute the default + warn rather
  // than write an id the game would silently swap for a default item.
  const handleAddSpecial = useCallback(
    (uniqueId: string) => {
      const entry = gameData?.uniqueDwellers[uniqueId];
      if (!entry) return;
      const fixes: string[] = [];
      let safe = entry;
      if (gameData && !gameData.outfitById.has(entry.outfitId)) {
        fixes.push(`outfit "${entry.outfitId}"`);
        safe = { ...safe, outfitId: DEFAULT_OUTFIT_ID };
      }
      if (gameData && entry.weaponId && !gameData.weaponById.has(entry.weaponId)) {
        fixes.push(`weapon "${entry.weaponId}"`);
        safe = { ...safe, weaponId: DEFAULT_WEAPON_ID };
      }
      // Special/legendary dwellers have no preset level in the game data (the level is
      // assigned at spawn time, not baked into UniqueDwellerData). Spawn them at a random
      // level 30..50 so they arrive battle-ready; editable afterward in the sheet.
      const level = 30 + Math.floor(Math.random() * 21);
      applyEdit(
        (s) => {
          const next = addSpecialDweller(s, uniqueId, safe);
          const added = next.dwellers?.dwellers ?? [];
          const newDweller = added[added.length - 1];
          return newDweller ? setLevel(next, newDweller.serializeId, level) : next;
        },
        `Add ${entry.name || uniqueId}`,
      );
      if (fixes.length) {
        pushToast(`Unknown ${fixes.join(' & ')} replaced with the default.`, 'info');
      }
      const list = useSaveStore.getState().save?.dwellers?.dwellers ?? [];
      const created = list[list.length - 1];
      if (created) goTo('dwellers', created.serializeId);
    },
    [applyEdit, gameData, goTo],
  );

  const onRevive = useCallback(
    (id: number) => applyEdit((s) => reviveAll(s, [id]), 'Revive dweller'),
    [applyEdit],
  );
  const schema = useMemo(() => dwellerSchema({ onRevive }), [onRevive]);
  const leading = useMemo(() => [selectColumn<DwellerRow>((d) => d.name)], []);

  const rows = useMemo(
    () => (save ? selectDwellerRows(save, gameData ?? undefined) : []),
    [save, gameData],
  );
  const visibleRows = useMemo(
    () => rows.filter((r) => passesQuickFilters(r, quickFilters)),
    [rows, quickFilters],
  );

  const selectedIds = useMemo(
    () =>
      Object.keys(rowSelection)
        .filter((id) => rowSelection[id])
        .map(Number),
    [rowSelection],
  );
  // The sheet edits the RAW dweller (colors/hair/faceMask aren't on the projected row).
  const selectedDweller =
    selectedDwellerId != null && save ? (selectDwellerById(save, selectedDwellerId) ?? null) : null;

  const clearSelection = (): void => setRowSelection({});

  const renderToolbar = ({ columnsMenu }: { columnsMenu: ReactNode }): ReactNode => (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search dwellers…"
          aria-label="Search dwellers"
          className="w-64 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder-neutral-500"
        />
        {QUICK_CHIPS.map(({ key, label }) => {
          const active = quickFilters[key];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => setQuickFilter(key, !active)}
              className={`rounded-full border px-3 py-1 text-xs ${
                active
                  ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                  : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={resetFilters}
          className="rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-100"
        >
          Reset filters
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="rounded border border-emerald-700 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40"
          >
            + Add dweller
          </button>
          <button
            type="button"
            onClick={() => setAddSpecialOpen(true)}
            disabled={!gameData}
            title={gameData ? undefined : 'Loading game data…'}
            className="rounded border border-amber-700 px-3 py-1 text-xs text-amber-300 hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Add special
          </button>
          {columnsMenu}
        </div>
      </div>
      {selectedIds.length > 0 && (
        <BulkActionBar selectedIds={selectedIds} onClear={clearSelection} />
      )}
    </div>
  );

  const tablePane = (
    <div className="flex min-w-0 flex-1 flex-col p-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">Dwellers</h2>
        <span className="text-sm text-neutral-400">
          {visibleRows.length === rows.length
            ? `${rows.length}`
            : `${visibleRows.length} / ${rows.length}`}{' '}
          shown
        </span>
        {gameDataStatus === 'loading' && (
          <span className="text-xs text-neutral-400">loading game data…</span>
        )}
        {gameDataStatus === 'error' && (
          <span className="text-xs text-amber-500">game data unavailable - showing raw ids</span>
        )}
      </div>

      <UnifiedTable<DwellerRow>
        className="mt-3 min-h-0 flex-1"
        virtualized={virtualized}
        schema={schema}
        persistKey="dwellers"
        leading={leading}
        data={visibleRows}
        getRowId={(r) => String(r.serializeId)}
        toolbar={renderToolbar}
        columnFilters={columnFilters}
        onColumnFiltersChange={setColumnFilters}
        enableGlobalFilter
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        onRowClick={(r) => goTo('dwellers', r.serializeId)}
        {...(selectedDwellerId != null ? { activeRowId: String(selectedDwellerId) } : {})}
        emptyState="No dwellers match the current filters."
      />
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      <ResizableSplit
        ariaLabel="Resize dweller detail panel"
        width={panelWidth}
        onWidthChange={setPanelWidth}
        left={tablePane}
        right={
          selectedDweller ? (
            <CharacterSheet dweller={selectedDweller} onClose={() => goTo('dwellers', null)} />
          ) : null
        }
      />

      {addOpen && (
        <AddDwellerDialog open onClose={() => setAddOpen(false)} onCreate={handleCreate} />
      )}

      {addSpecialOpen && gameData && (
        <AddSpecialDwellerDialog
          open
          onClose={() => setAddSpecialOpen(false)}
          catalog={gameData.uniqueDwellers}
          gameData={gameData}
          onAdd={handleAddSpecial}
          virtualized={virtualized}
        />
      )}
    </div>
  );
}
