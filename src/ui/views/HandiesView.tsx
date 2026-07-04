import { useMemo, useState } from 'react';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { useParams } from 'react-router-dom';
import { useSaveStore } from '../../state/saveStore.ts';
import { useUIStore } from '../../state/uiStore.ts';
import { useSectionNavigate } from '../routing/useSectionNavigate.ts';
import { useGameData } from '../hooks/useGameData.ts';
import {
  deleteMrHandies,
  deleteMrHandy,
  editMrHandy,
  handyFloorOptions,
  healMrHandy,
  selectMrHandyRows,
  setMrHandyHealth,
  unassignMrHandy,
  DEFAULT_MR_HANDY_HEALTH,
  type MrHandyRow,
} from '../../domain/ops/mrHandyOps.ts';
import { moveMrHandyToFloor } from '../../domain/ops/roomOps.ts';
import { healMrHandies } from '../../domain/ops/bulkPresets.ts';
import { displayFloor } from '../../domain/rooms/layout.ts';
import { pushToast } from '../../state/toastStore.ts';
import { UnifiedTable } from '../components/table/UnifiedTable.tsx';
import { actionsColumn, selectColumn } from '../components/table/columnKit.tsx';
import { ResizableSplit } from '../components/ResizableSplit.tsx';
import {
  handyInstanceSchema,
  type HandyTableRow,
} from '../components/table/schemas/handyInstanceSchema.tsx';
import { HandySheet } from '../components/handies/HandySheet.tsx';
import { HandyCatalogSection } from '../components/items/HandyCatalogSection.tsx';

// Mr. Handies section - a first-class master-detail screen replicating the Pets tab
// (Owned roster on the left, editable <HandySheet> on the right, plus a Catalog tab of
// the four game variants). Robots are actors with a stable serializeId, so the URL
// detail is simply #/handies/<serializeId>.

export function HandiesView({ virtualized = true }: { virtualized?: boolean } = {}) {
  const save = useSaveStore((s) => s.save);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const allowOutOfRange = useUIStore((s) => s.allowOutOfRange);
  const { data: gameData, status: gameDataStatus } = useGameData();

  const columnFilters = useUIStore((s) => s.handyColumnFilters);
  const setColumnFilters = useUIStore((s) => s.setHandyColumnFilters);
  const globalFilter = useUIStore((s) => s.handyGlobalFilter);
  const setGlobalFilter = useUIStore((s) => s.setHandyGlobalFilter);
  const { detail } = useParams();
  const goTo = useSectionNavigate();
  const selectedId = detail !== undefined ? Number(detail) : null;
  const setSelectedId = (id: number | null): void => goTo('handies', id);
  const panelWidth = useUIStore((s) => s.detailPanelWidth);
  const setPanelWidth = useUIStore((s) => s.setDetailPanelWidth);

  const [tab, setTab] = useState<'owned' | 'catalog'>('owned');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const fullHealth = gameData?.roomCapacity.base.mrHandyHealth ?? DEFAULT_MR_HANDY_HEALTH;

  const rows = useMemo<HandyTableRow[]>(() => {
    if (!save) return [];
    return selectMrHandyRows(save).map((r) => {
      const catalog = gameData?.handyByVariant.get(r.variant) ?? null;
      return { ...r, catalogId: catalog?.id ?? null, variantName: catalog?.name ?? r.variant };
    });
  }, [save, gameData]);
  const schema = useMemo(() => handyInstanceSchema(fullHealth), [fullHealth]);

  const selected =
    selectedId !== null ? (rows.find((r) => r.serializeId === selectedId) ?? null) : null;

  // Move targets: FLOORS (1-based labels), one robot per floor (the game rule). Which
  // room ends up carrying the mrHandyList reference is resolved by the domain op.
  const floorOptions = useMemo(() => (save ? handyFloorOptions(save) : []), [save]);

  const selectedRowIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection],
  );

  const hurtCount = rows.filter(
    (r) => r.dead || (r.health !== null && r.health < fullHealth),
  ).length;

  const onDeleteSelected = (): void => {
    const ids = selectedRowIds.map(Number).filter((n) => Number.isInteger(n));
    if (ids.length === 0) return;
    applyEdit(
      (s) => deleteMrHandies(s, ids),
      `Delete ${ids.length} robot${ids.length === 1 ? '' : 's'}`,
    );
    pushToast(`Deleted ${ids.length} robot${ids.length === 1 ? '' : 's'}.`);
    setRowSelection({});
    if (selectedId !== null && ids.includes(selectedId)) setSelectedId(null);
  };

  const onDeleteRow = (row: MrHandyRow): void => {
    applyEdit((s) => deleteMrHandy(s, row.serializeId), `Delete ${row.name}`);
    pushToast(`Deleted ${row.name}.`);
    setRowSelection({});
    if (selectedId === row.serializeId) setSelectedId(null);
  };

  const onHealAll = (): void => {
    applyEdit((s) => healMrHandies(s, fullHealth), 'Heal all Mr. Handies');
    pushToast(`Healed ${hurtCount} robot${hurtCount === 1 ? '' : 's'}.`);
  };

  // Leading select checkboxes + trailing per-row Delete, composed around the schema.
  const leading = useMemo(() => [selectColumn<HandyTableRow>((r) => r.name)], []);
  const trailing = useMemo<ColumnDef<HandyTableRow>[]>(
    () => [
      actionsColumn<HandyTableRow>(
        [
          {
            text: 'Delete',
            tone: 'red',
            ariaLabel: (r) => `Delete ${r.name}`,
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
        aria-label="Mr. Handies view"
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
          <HandyCatalogSection virtualized={virtualized} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ResizableSplit
            ariaLabel="Resize robot detail panel"
            width={panelWidth}
            onWidthChange={setPanelWidth}
            left={
              <div className="flex min-w-0 flex-1 flex-col p-4">
                <div className="flex items-baseline gap-3">
                  <h2 className="text-lg font-semibold">Mr. Handies</h2>
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

                <UnifiedTable<HandyTableRow>
                  className="mt-3 min-h-0 flex-1"
                  virtualized={virtualized}
                  schema={schema}
                  persistKey="handies"
                  leading={leading}
                  trailing={trailing}
                  data={rows}
                  getRowId={(r) => String(r.serializeId)}
                  toolbar={({ columnsMenu }) => (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <input
                        type="search"
                        value={globalFilter}
                        onChange={(e) => setGlobalFilter(e.target.value)}
                        placeholder="Search robots…"
                        aria-label="Search robots"
                        className="w-64 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder-neutral-500"
                      />
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
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          type="button"
                          disabled={hurtCount === 0}
                          onClick={onHealAll}
                          title={
                            hurtCount === 0
                              ? 'Every robot is already at full health'
                              : `Restore ${hurtCount} to ${fullHealth} HP and revive the destroyed`
                          }
                          className="rounded border border-emerald-700 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          Heal all{hurtCount > 0 ? ` (${hurtCount})` : ''}
                        </button>
                        {columnsMenu}
                      </div>
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
                  onRowClick={(r) => setSelectedId(r.serializeId)}
                  {...(selectedId !== null ? { activeRowId: String(selectedId) } : {})}
                  emptyState="No robots owned. Add one from the Catalog tab."
                />
              </div>
            }
            right={
              selected ? (
                <HandySheet
                  handy={selected}
                  gameData={gameData}
                  fullHealth={fullHealth}
                  allowOutOfRange={allowOutOfRange}
                  floorOptions={floorOptions}
                  onClose={() => setSelectedId(null)}
                  onRename={(name) =>
                    applyEdit((s) => editMrHandy(s, selected.serializeId, { name }), 'Rename robot')
                  }
                  onSetVariant={(variant) =>
                    applyEdit(
                      (s) =>
                        editMrHandy(s, selected.serializeId, {
                          variant: variant.variantId,
                          characterType: variant.characterType,
                          actorDataId: variant.actorDataId,
                        }),
                      `Set variant to ${variant.name}`,
                    )
                  }
                  onSetHealth={(health) =>
                    applyEdit(
                      (s) => setMrHandyHealth(s, selected.serializeId, health),
                      'Set robot health',
                    )
                  }
                  onHeal={() => {
                    applyEdit(
                      (s) => healMrHandy(s, selected.serializeId, fullHealth),
                      `Heal ${selected.name}`,
                    );
                    pushToast(`Healed ${selected.name}.`);
                  }}
                  onMove={(row) => {
                    if (row === null) {
                      applyEdit(
                        (s) => unassignMrHandy(s, selected.serializeId),
                        'Unassign Mr. Handy',
                      );
                      pushToast('Robot sent outside the vault (it waits at the door).');
                    } else {
                      applyEdit(
                        (s) => moveMrHandyToFloor(s, selected.serializeId, row),
                        'Move Mr. Handy',
                      );
                      pushToast(`Robot moved to floor ${displayFloor(row)}.`);
                    }
                  }}
                  onDelete={() => onDeleteRow(selected)}
                />
              ) : null
            }
          />
        </div>
      )}
    </div>
  );
}
