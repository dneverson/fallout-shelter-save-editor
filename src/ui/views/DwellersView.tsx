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
import { computePopulationCap } from '../../domain/selectors/vaultSelectors.ts';
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

  // Add the selected named special dwellers from the catalog in ONE undo step, then open
  // the last one in the sheet (read-back for its id, like handleCreate). Safety net: the
  // extracted catalog ids are all real game ids, but if one were ever unknown we
  // substitute the default + warn rather than write an id the game would silently swap
  // for a default item.
  const handleAddSpecial = useCallback(
    (uniqueIds: string[]) => {
      if (!gameData) return;
      const fixes: string[] = [];
      // Per-dweller prep OUTSIDE the op: gear substitutions + spawn level. Special/
      // legendary dwellers have no preset level in the game data (it's assigned at spawn
      // time, not baked into UniqueDwellerData), so each rolls a random 30..50 to arrive
      // battle-ready; editable afterward in the sheet.
      const preps = uniqueIds.flatMap((uniqueId) => {
        const entry = gameData.uniqueDwellers[uniqueId];
        if (!entry) return [];
        let safe = entry;
        if (!gameData.outfitById.has(entry.outfitId)) {
          fixes.push(`outfit "${entry.outfitId}"`);
          safe = { ...safe, outfitId: DEFAULT_OUTFIT_ID };
        }
        if (entry.weaponId && !gameData.weaponById.has(entry.weaponId)) {
          fixes.push(`weapon "${entry.weaponId}"`);
          safe = { ...safe, weaponId: DEFAULT_WEAPON_ID };
        }
        return [{ uniqueId, safe, level: 30 + Math.floor(Math.random() * 21) }];
      });
      const first = preps[0];
      if (!first) return;
      applyEdit(
        (s) =>
          preps.reduce((acc, p) => {
            const next = addSpecialDweller(acc, p.uniqueId, p.safe);
            const added = next.dwellers?.dwellers ?? [];
            const newDweller = added[added.length - 1];
            return newDweller ? setLevel(next, newDweller.serializeId, p.level) : next;
          }, s),
        preps.length === 1
          ? `Add ${first.safe.name || first.uniqueId}`
          : `Add ${preps.length} special dwellers`,
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
  // Header count mirrors the game's own dweller list ("X/Y"): dwellers in the save vs the
  // living-quarters-derived capacity. Needs the room-capacity catalog, so it's count-only
  // until game data resolves.
  const populationCap = useMemo(
    () => (save && gameData ? computePopulationCap(save, gameData.roomCapacity) : null),
    [save, gameData],
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
        <span
          className="text-sm text-neutral-400"
          title="Dwellers in the save vs the vault's capacity from living quarters"
        >
          {visibleRows.length === rows.length
            ? `${rows.length}${populationCap !== null ? `/${populationCap}` : ''}`
            : `${visibleRows.length} of ${rows.length}${populationCap !== null ? `/${populationCap}` : ''}`}
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
