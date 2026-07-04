import { useMemo, useState } from 'react';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { useParams } from 'react-router-dom';
import { useSaveStore } from '../../state/saveStore.ts';
import { useUIStore } from '../../state/uiStore.ts';
import { useSectionNavigate } from '../routing/useSectionNavigate.ts';
import { useGameData } from '../hooks/useGameData.ts';
import {
  selectPetByLocation,
  selectPetRows,
  type PetLocation,
  type PetRow,
} from '../../domain/selectors/petSelectors.ts';
import { selectDwellerRows } from '../../domain/selectors/dwellerSelectors.ts';
import {
  assignPet,
  deletePet,
  deletePets,
  editPet,
  maxPetStats,
  sendPetToStorage,
} from '../../domain/ops/petOps.ts';
import { petBonusRange } from '../../domain/gamedata/gameData.ts';
import { pushToast } from '../../state/toastStore.ts';
import { UnifiedTable } from '../components/table/UnifiedTable.tsx';
import { actionsColumn, selectColumn } from '../components/table/columnKit.tsx';
import { ResizableSplit } from '../components/ResizableSplit.tsx';
import { petInstanceSchema } from '../components/table/schemas/petInstanceSchema.tsx';
import { PetSheet } from '../components/pets/PetSheet.tsx';
import { PetCatalogSection } from '../components/items/PetCatalogSection.tsx';

// Pets section - a first-class master-detail screen
// like Dwellers: a roster of every owned pet INSTANCE (equipped on a dweller +
// loose in storage) on the left, the editable <PetSheet> on the right. Pets have no
// intrinsic stable id, so a selected instance is addressed by a LOCATION (owner id /
// inventory index, parsed from the row id); reassign/send/delete ops can change that
// location, so the handlers recompute the selection to the post-op location by reading
// the store back (the new stored index is the last inventory entry).

/** Parse a roster row id (`e:<dwellerId>` / `s:<index>`) back into a pet location. */
function parseRowId(rowId: string): PetLocation | null {
  const n = Number(rowId.slice(2));
  if (!Number.isInteger(n)) return null;
  if (rowId.startsWith('e:')) return { kind: 'equipped', dwellerId: n };
  if (rowId.startsWith('s:')) return { kind: 'stored', index: n };
  return null;
}

/** Inventory index of the most recently appended item (for post-op re-selection). */
function lastInventoryIndex(): number {
  const items = useSaveStore.getState().save?.vault?.inventory?.items ?? [];
  return items.length - 1;
}

export function PetsView({ virtualized = true }: { virtualized?: boolean } = {}) {
  const save = useSaveStore((s) => s.save);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const allowOutOfRange = useUIStore((s) => s.allowOutOfRange);
  const { data: gameData, status: gameDataStatus } = useGameData();

  // Persisted column layout is owned by <UnifiedTable> via the 'pets' key; session filters
  // (search, per-column) stay here.
  const columnFilters = useUIStore((s) => s.petColumnFilters);
  const setColumnFilters = useUIStore((s) => s.setPetColumnFilters);
  const globalFilter = useUIStore((s) => s.petGlobalFilter);
  const setGlobalFilter = useUIStore((s) => s.setPetGlobalFilter);
  // Selected pet instance lives in the URL (#/pets/e:<id> or #/pets/s:<idx>) - deep-linkable.
  const { detail } = useParams();
  const goTo = useSectionNavigate();
  const selectedPetRowId = detail ?? null;
  const setSelectedPetRowId = (rowId: string | null): void => goTo('pets', rowId);
  const panelWidth = useUIStore((s) => s.detailPanelWidth);
  const setPanelWidth = useUIStore((s) => s.setDetailPanelWidth);

  const [tab, setTab] = useState<'owned' | 'catalog'>('owned');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const rows = useMemo<PetRow[]>(
    () => (save ? selectPetRows(save, gameData ?? undefined) : []),
    [save, gameData],
  );
  const dwellerRows = useMemo(
    () => (save ? selectDwellerRows(save, gameData ?? undefined) : []),
    [save, gameData],
  );
  const schema = useMemo(() => petInstanceSchema(), []);

  const location = selectedPetRowId ? parseRowId(selectedPetRowId) : null;
  const resolved = location && save ? selectPetByLocation(save, location) : null;

  const selectedRowIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection],
  );

  // Deleting shifts stored-pet inventory indexes, so every `s:<index>` row id (checkbox
  // selection AND the URL detail selection) can point at the wrong pet afterwards - clear
  // both instead of guessing.
  const afterDelete = (): void => {
    setRowSelection({});
    setSelectedPetRowId(null);
  };

  const onDeleteSelected = (): void => {
    const locations = selectedRowIds.map(parseRowId).filter((l): l is PetLocation => l !== null);
    if (locations.length === 0) return;
    applyEdit(
      (s) => deletePets(s, locations),
      `Delete ${locations.length} pet${locations.length === 1 ? '' : 's'}`,
    );
    pushToast(`Deleted ${locations.length} pet${locations.length === 1 ? '' : 's'}.`);
    afterDelete();
  };

  // Bulk "max all stats": set every owned pet's rolled bonus value to its breed/rarity legal
  // maximum. Needs game data to know each pet's ceiling; disabled until it loads / no pets.
  const maxableCount = useMemo(() => {
    if (!gameData) return 0;
    return rows.filter((r) => petBonusRange(gameData, r.id) != null).length;
  }, [gameData, rows]);

  const onMaxAllStats = (): void => {
    if (!gameData || maxableCount === 0) return;
    const maxFor = (id: string): number | null => petBonusRange(gameData, id)?.max ?? null;
    applyEdit(
      (s) => maxPetStats(s, maxFor),
      `Max ${maxableCount} pet stat${maxableCount === 1 ? '' : 's'}`,
    );
    pushToast(`Maxed ${maxableCount} pet stat${maxableCount === 1 ? '' : 's'} to the legal limit.`);
  };

  const onDeleteRow = (row: PetRow): void => {
    const label = row.uniqueName || row.breed;
    applyEdit((s) => deletePet(s, row.location), `Delete pet ${label}`);
    pushToast(`Deleted ${label}.`);
    afterDelete();
  };

  // Leading select checkboxes + trailing per-row Delete, composed around the pet schema.
  const leading = useMemo(() => [selectColumn<PetRow>((r) => r.uniqueName || r.breed)], []);
  const trailing = useMemo<ColumnDef<PetRow>[]>(
    () => [
      actionsColumn<PetRow>(
        [
          {
            text: 'Delete',
            tone: 'red',
            ariaLabel: (r) => `Delete ${r.uniqueName || r.breed}`,
            onClick: (r) => onDeleteRow(r),
          },
        ],
        { size: 90 },
      ),
    ],
    // onDeleteRow closes over the current save via applyEdit; the store handles staleness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Pets view"
        className="flex gap-1 border-b border-neutral-800 px-4 pt-3"
      >
        {(['owned', 'catalog'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-t px-3 py-1.5 text-sm ${
              tab === t
                ? 'bg-neutral-800 font-medium text-amber-300'
                : 'text-neutral-400 hover:text-neutral-100'
            }`}
          >
            {t === 'owned' ? 'Owned' : 'Catalog'}
          </button>
        ))}
      </div>

      {tab === 'catalog' ? (
        <div className="min-h-0 flex-1">
          <PetCatalogSection virtualized={virtualized} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ResizableSplit
            ariaLabel="Resize pet detail panel"
            width={panelWidth}
            onWidthChange={setPanelWidth}
            left={
              <div className="flex min-w-0 flex-1 flex-col p-4">
                <div className="flex items-baseline gap-3">
                  <h2 className="text-lg font-semibold">Pets</h2>
                  <span className="text-sm text-neutral-400">{rows.length} owned</span>
                  {gameDataStatus === 'loading' && (
                    <span className="text-xs text-neutral-400">loading game data…</span>
                  )}
                  {gameDataStatus === 'error' && (
                    <span className="text-xs text-amber-500">
                      game data unavailable - showing raw ids
                    </span>
                  )}
                </div>

                <UnifiedTable<PetRow>
                  className="mt-3 min-h-0 flex-1"
                  virtualized={virtualized}
                  schema={schema}
                  persistKey="pets"
                  leading={leading}
                  trailing={trailing}
                  data={rows}
                  getRowId={(r) => r.rowId}
                  toolbar={({ columnsMenu }) => (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <input
                        type="search"
                        value={globalFilter}
                        onChange={(e) => setGlobalFilter(e.target.value)}
                        placeholder="Search pets…"
                        aria-label="Search pets"
                        className="w-64 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder-neutral-500"
                      />
                      <button
                        type="button"
                        onClick={onMaxAllStats}
                        disabled={maxableCount === 0}
                        title="Set every owned pet's bonus value to its legal maximum"
                        className="rounded border border-amber-800 px-3 py-1 text-xs text-amber-300 hover:bg-amber-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Max all stats
                      </button>
                      {selectedRowIds.length > 0 && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={onDeleteSelected}
                            className="rounded border border-red-800 px-3 py-1 text-xs text-red-300 hover:bg-red-900/40"
                          >
                            Delete ({selectedRowIds.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setRowSelection({})}
                            className="rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-100"
                          >
                            Clear
                          </button>
                        </div>
                      )}
                      <div className="ml-auto flex items-center gap-2">{columnsMenu}</div>
                    </div>
                  )}
                  columnFilters={columnFilters}
                  onColumnFiltersChange={setColumnFilters}
                  enableGlobalFilter
                  globalFilter={globalFilter}
                  onGlobalFilterChange={setGlobalFilter}
                  enableRowSelection
                  rowSelection={rowSelection}
                  onRowSelectionChange={setRowSelection}
                  onRowClick={(r) => setSelectedPetRowId(r.rowId)}
                  {...(selectedPetRowId ? { activeRowId: selectedPetRowId } : {})}
                  emptyState="No pets owned. Add one from the Catalog tab."
                />
              </div>
            }
            right={
              location && resolved ? (
                <PetSheet
                  location={location}
                  item={resolved.item}
                  {...(resolved.ownerName !== undefined ? { ownerName: resolved.ownerName } : {})}
                  gameData={gameData}
                  allowOutOfRange={allowOutOfRange}
                  dwellers={dwellerRows}
                  onClose={() => setSelectedPetRowId(null)}
                  onEdit={(changes) => applyEdit((s) => editPet(s, location, changes), 'Edit pet')}
                  onAssign={(dwellerId) => {
                    applyEdit((s) => assignPet(s, location, dwellerId), 'Assign pet');
                    setSelectedPetRowId(`e:${dwellerId}`);
                  }}
                  onSendToStorage={() => {
                    applyEdit((s) => sendPetToStorage(s, location), 'Send pet to storage');
                    setSelectedPetRowId(`s:${lastInventoryIndex()}`);
                  }}
                  onDelete={() => {
                    applyEdit((s) => deletePet(s, location), 'Delete pet');
                    setSelectedPetRowId(null);
                  }}
                />
              ) : null
            }
          />
        </div>
      )}
    </div>
  );
}
