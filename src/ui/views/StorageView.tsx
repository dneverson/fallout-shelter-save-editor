import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSaveStore } from '../../state/saveStore.ts';
import { useUIStore } from '../../state/uiStore.ts';
import { useGameData } from '../hooks/useGameData.ts';
import type { NewPet } from '../../domain/ops/dwellerOps.ts';
import {
  addPet,
  grantItems,
  removeStoredItemAt,
  setItemCount,
  type StackableType,
} from '../../domain/ops/storageOps.ts';
import type { Item } from '../../domain/model/saveSchema.ts';
import type { GameData } from '../../domain/gamedata/gameData.ts';
import { computeItemCapacity } from '../../domain/selectors/vaultSelectors.ts';
import type { ColumnDef } from '@tanstack/react-table';
import { UnifiedTable } from '../components/table/UnifiedTable.tsx';
import { actionsColumn } from '../components/table/columnKit.tsx';
import { InfoTooltip } from '../components/InfoTooltip.tsx';
import { fieldHelp } from '../lib/fieldHelp.ts';
import { AddItemsDialog, type AddSegment } from '../components/storage/AddItemsDialog.tsx';
import type { CatalogAddItem } from '../components/items/CatalogTableView.tsx';
import {
  storageGroupSchema,
  storedPetSchema,
  type StorageGroupRow,
  type StoragePetRow,
} from '../components/table/schemas/storageSchemas.tsx';

// Storage editor. The vault's stored items
// (`vault.inventory.items`), segmented by type: weapons / outfits / junk are fungible -
// grouped by id with an editable count, set/remove inline; pets are unique instances -
// listed individually with remove. "Add items" opens the unified catalog picker
// (multi-select + per-row quantity + rarity filter, capacity-guarded). The capacity
// meter shows used / max (max = base 10 + Σ storage-room item capacity at each room's
// mergeLevel/level, from the extracted room-capacity catalog: `computeItemCapacity`);
// existing over-capacity stock is warned (red), and new adds are blocked past capacity
// unless out-of-range edits are enabled. Each edit is one applyEdit = one undo step.

const SEGMENTS: ReadonlyArray<{ id: AddSegment; label: string }> = [
  { id: 'Weapon', label: 'Weapons' },
  { id: 'Outfit', label: 'Outfits' },
  { id: 'Pet', label: 'Pets' },
  { id: 'Junk', label: 'Junk' },
];

const tabClass = (active: boolean): string =>
  `rounded px-3 py-1.5 text-sm ${
    active ? 'bg-amber-500/20 text-amber-300' : 'text-neutral-300 hover:bg-neutral-800'
  }`;

/** Catalog lookup of an item's display name + rarity for the active stackable type. */
function enrich(
  gameData: GameData | null,
  type: StackableType,
  id: string,
): { name: string; rarity: string } {
  const catalog =
    type === 'Weapon'
      ? gameData?.weaponById.get(id)
      : type === 'Outfit'
        ? gameData?.outfitById.get(id)
        : gameData?.junkById.get(id);
  return { name: catalog?.name ?? id, rarity: catalog?.rarity ?? '–' };
}

/** Group fungible items of one type by id with a count, enriched + name-sorted. */
function groupRows(
  items: Item[],
  gameData: GameData | null,
  type: StackableType,
): StorageGroupRow[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.type !== type) continue;
    counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count, ...enrich(gameData, type, id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Project each stored pet instance (with its inventory index) for the pets segment. */
function petRows(items: Item[], gameData: GameData | null): StoragePetRow[] {
  const rows: StoragePetRow[] = [];
  items.forEach((item, index) => {
    if (item.type !== 'Pet') return;
    const catalog = gameData?.petById.get(item.id);
    const extra = item.extraData ?? {};
    rows.push({
      index,
      id: item.id,
      name: extra.uniqueName || catalog?.name || item.id,
      breed: catalog?.name ?? item.id,
      rarity: catalog?.rarity ?? '–',
      bonus: extra.bonus ?? catalog?.bonus ?? '–',
      value: extra.bonusValue ?? 0,
    });
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function StorageView({ virtualized = true }: { virtualized?: boolean } = {}) {
  const save = useSaveStore((s) => s.save);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const allowOutOfRange = useUIStore((s) => s.allowOutOfRange);
  const { data: gameData, status: gameDataStatus } = useGameData();

  // Active segment is deep-linkable via #/storage/<segment> (e.g. the Vault-overview
  // Weapons/Outfits/Junk/Pets tiles link straight to the matching area). Tabs still switch
  // locally; when the URL segment changes (a fresh deep-link) we adopt it during render -
  // React's recommended "adjust state on prop change" pattern (no effect, no cascade).
  const { detail } = useParams();
  const urlSegment = SEGMENTS.find((s) => s.id === detail)?.id;
  const [segment, setSegment] = useState<AddSegment>(urlSegment ?? 'Weapon');
  const [seenUrlSegment, setSeenUrlSegment] = useState(urlSegment);
  if (urlSegment && urlSegment !== seenUrlSegment) {
    setSeenUrlSegment(urlSegment);
    setSegment(urlSegment);
  }
  const [addOpen, setAddOpen] = useState(false);

  const items = useMemo<Item[]>(() => save?.vault?.inventory?.items ?? [], [save]);

  // Composition counts (item-count accurate; no capacity denominator yet).
  const totals = useMemo(() => {
    let weapon = 0;
    let outfit = 0;
    let junk = 0;
    let pet = 0;
    for (const item of items) {
      if (item.type === 'Weapon') weapon += 1;
      else if (item.type === 'Outfit') outfit += 1;
      else if (item.type === 'Junk') junk += 1;
      else if (item.type === 'Pet') pet += 1;
    }
    return { weapon, outfit, junk, pet, total: items.length };
  }, [items]);

  // Storage-room item capacity denominator: base + Σ storage-room contributions.
  // null while game data loads / fails (the meter falls back to a count-only display).
  const itemCapacity = useMemo(
    () => (save && gameData ? computeItemCapacity(save, gameData.roomCapacity) : null),
    [save, gameData],
  );
  const overCapacity = itemCapacity !== null && totals.total > itemCapacity;

  const groupRowsData = useMemo(
    () => (segment === 'Pet' ? [] : groupRows(items, gameData, segment)),
    [items, gameData, segment],
  );
  const petRowsData = useMemo(
    () => (segment === 'Pet' ? petRows(items, gameData) : []),
    [items, gameData, segment],
  );

  const groupSchema = useMemo(() => {
    const type = segment === 'Pet' ? 'Weapon' : segment;
    return storageGroupSchema({
      type,
      onSetCount: (id, count) =>
        applyEdit((s) => setItemCount(s, type, id, count), 'Set item count'),
    });
  }, [segment, applyEdit]);
  const groupTrailing = useMemo<ColumnDef<StorageGroupRow>[]>(() => {
    const type = segment === 'Pet' ? 'Weapon' : segment;
    return [
      actionsColumn<StorageGroupRow>(
        [
          {
            text: 'Remove',
            tone: 'red',
            ariaLabel: (r) => `Remove all ${r.name}`,
            onClick: (r) => applyEdit((s) => setItemCount(s, type, r.id, 0), 'Remove items'),
          },
        ],
        { size: 110 },
      ),
    ];
  }, [segment, applyEdit]);

  const petSchema = useMemo(() => storedPetSchema(), []);
  const petTrailing = useMemo<ColumnDef<StoragePetRow>[]>(
    () => [
      actionsColumn<StoragePetRow>(
        [
          {
            text: 'Remove',
            tone: 'red',
            ariaLabel: (r) => `Remove ${r.name}`,
            onClick: (r) => applyEdit((s) => removeStoredItemAt(s, r.index), 'Remove stored item'),
          },
        ],
        { size: 110 },
      ),
    ],
    [applyEdit],
  );

  // Bulk grant: every picked catalog item lands in ONE applyEdit = one undo step.
  const onGrant = (picked: CatalogAddItem[]): void => {
    if (segment === 'Pet' || picked.length === 0) return;
    const total = picked.reduce((n, it) => n + it.count, 0);
    applyEdit(
      (s) => picked.reduce((acc, it) => grantItems(acc, segment, it.id, it.count), s),
      `Add ${total} to storage`,
    );
  };
  const onAddPet = (pet: NewPet): void => applyEdit((s) => addPet(s, pet), 'Create pet');

  const meterParts: ReadonlyArray<{ label: string; n: number; className: string }> = [
    { label: 'Weapons', n: totals.weapon, className: 'bg-sky-600' },
    { label: 'Outfits', n: totals.outfit, className: 'bg-violet-600' },
    { label: 'Junk', n: totals.junk, className: 'bg-amber-600' },
    { label: 'Pets', n: totals.pet, className: 'bg-emerald-600' },
  ];

  // Bar spans the capacity; when over capacity the segments fill 100% (using `total`)
  // and the over-cap warning carries the message. Without game data, fall back to total.
  const meterDenominator =
    itemCapacity !== null ? Math.max(itemCapacity, totals.total) : totals.total;

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">Storage</h2>
        <span className="flex items-center gap-1.5 text-sm text-neutral-400">
          {totals.total}
          {itemCapacity !== null && ` / ${itemCapacity}`} items stored
          <InfoTooltip text={fieldHelp.storageCapacity} />
        </span>
        {overCapacity && <span className="text-xs font-medium text-red-400">⚠ over capacity</span>}
        {gameDataStatus === 'loading' && (
          <span className="text-xs text-neutral-400">loading game data…</span>
        )}
        {gameDataStatus === 'error' && (
          <span className="text-xs text-amber-500">game data unavailable - showing raw ids</span>
        )}
      </div>

      {/* Capacity meter: used / max, warn-but-allow over capacity ----------- */}
      <div className="mt-3">
        <div
          className={`flex h-2.5 w-full overflow-hidden rounded bg-neutral-800 ${
            overCapacity ? 'ring-1 ring-red-500/60' : ''
          }`}
        >
          {meterDenominator > 0 &&
            meterParts.map((p) =>
              p.n > 0 ? (
                <div
                  key={p.label}
                  className={p.className}
                  style={{ width: `${(p.n / meterDenominator) * 100}%` }}
                  title={`${p.label}: ${p.n}`}
                />
              ) : null,
            )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
          {meterParts.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-sm ${p.className}`}
                aria-hidden="true"
              />
              {p.label} {p.n}
            </span>
          ))}
          {itemCapacity !== null && (
            <span
              className={`ml-auto tabular-nums ${overCapacity ? 'text-red-400' : 'text-neutral-400'}`}
            >
              {overCapacity
                ? `${totals.total - itemCapacity} over capacity`
                : `${itemCapacity - totals.total} slots free`}
            </span>
          )}
        </div>
      </div>

      {/* Segment tabs + add actions --------------------------------------------- */}
      <div className="mt-4 flex items-center justify-between gap-3 border-b border-neutral-800 pb-2">
        <div className="flex gap-1">
          {SEGMENTS.map((seg) => (
            <button
              key={seg.id}
              type="button"
              className={tabClass(segment === seg.id)}
              aria-current={segment === seg.id ? 'true' : undefined}
              onClick={() => setSegment(seg.id)}
            >
              {seg.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="rounded border border-emerald-700 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-900/40"
        >
          Add items
        </button>
      </div>

      {segment === 'Pet' ? (
        <UnifiedTable<StoragePetRow>
          className="mt-3 min-h-0 flex-1"
          virtualized={virtualized}
          schema={petSchema}
          persistKey="storage.pet"
          trailing={petTrailing}
          data={petRowsData}
          getRowId={(r) => String(r.index)}
          enableGlobalFilter
          initialSorting={[{ id: 'name', desc: false }]}
          emptyState="No pets in storage. Use “Add items” to grant one."
        />
      ) : (
        <UnifiedTable<StorageGroupRow>
          className="mt-3 min-h-0 flex-1"
          virtualized={virtualized}
          schema={groupSchema}
          persistKey={`storage.${segment}`}
          trailing={groupTrailing}
          data={groupRowsData}
          getRowId={(r) => r.id}
          enableGlobalFilter
          initialSorting={[{ id: 'name', desc: false }]}
          emptyState="Nothing of this type in storage. Use “Add items” to grant some."
        />
      )}

      {addOpen && (
        <AddItemsDialog
          segment={segment}
          gameData={gameData}
          allowOutOfRange={allowOutOfRange}
          slotsFree={itemCapacity !== null ? itemCapacity - totals.total : null}
          onGrant={onGrant}
          onAddPet={onAddPet}
          onClose={() => setAddOpen(false)}
          virtualized={virtualized}
        />
      )}
    </div>
  );
}
