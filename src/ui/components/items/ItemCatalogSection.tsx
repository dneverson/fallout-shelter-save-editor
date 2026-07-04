import { useMemo, useState } from 'react';
import type { TableSchema } from '../table/tableSchema.ts';
import { useSaveStore } from '../../../state/saveStore.ts';
import { useUIStore } from '../../../state/uiStore.ts';
import { useGameData } from '../../hooks/useGameData.ts';
import { selectDwellerRows } from '../../../domain/selectors/dwellerSelectors.ts';
import { grantItems, type StackableType } from '../../../domain/ops/storageOps.ts';
import { equipOutfit, equipWeapon } from '../../../domain/ops/dwellerOps.ts';
import { computeItemCapacity } from '../../../domain/selectors/vaultSelectors.ts';
import { pushToast } from '../../../state/toastStore.ts';
import { CatalogTableView, type CatalogAddItem } from './CatalogTableView.tsx';
import { EquipOnDwellersDialog, type EquipSlot } from './EquipOnDwellersDialog.tsx';
import { useStorageCapacityGuard } from '../storage/StorageCapacityNotice.tsx';

// Standalone catalog section for the FUNGIBLE stackable item types - weapons, outfits,
// junk. Wires the generic <CatalogTableView> to the
// store: multi-select rows → bulk add-to-storage (`grantItems`), and a single-row
// "Equip…" → <EquipOnDwellersDialog> that equips that one item onto every selected
// dweller in ONE undo step (replacing - and discarding - whatever they had, per the
// game's equip-overwrite). Junk passes `slot=null` (it can't be equipped). Pets are
// instances with a rolled value, so they have their own section flow (PetsView).

/** The shared shape of a stackable catalog row (weapons/outfits/junk all carry id+name). */
interface StackableItem {
  id: string;
  name: string;
}

interface ItemCatalogSectionProps<T extends StackableItem> {
  title: string;
  /** Plural noun for the count + toasts, e.g. "weapons". */
  unitNoun: string;
  /** Storage item type written by `grantItems`. */
  storageType: StackableType;
  /** Equip slot, or null for junk (which can only go to storage). */
  slot: EquipSlot | null;
  data: T[];
  /** The type's full column schema (source of truth). */
  schema: TableSchema<T>;
  /** Persistence key for this catalog's column layout. */
  persistKey: string;
  /** Hideable column ids visible by default; omit to show all. */
  preset?: readonly string[];
  searchLabel: string;
  searchPlaceholder: string;
  virtualized?: boolean;
}

export function ItemCatalogSection<T extends StackableItem>({
  title,
  unitNoun,
  storageType,
  slot,
  data,
  schema,
  persistKey,
  preset,
  searchLabel,
  searchPlaceholder,
  virtualized = true,
}: ItemCatalogSectionProps<T>) {
  const save = useSaveStore((s) => s.save);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const { data: gameData, status: gameDataStatus } = useGameData();

  const [equipId, setEquipId] = useState<string | null>(null);

  const dwellerRows = useMemo(
    () => (save ? selectDwellerRows(save, gameData ?? undefined) : []),
    [save, gameData],
  );

  const equipItem = equipId ? (data.find((d) => d.id === equipId) ?? null) : null;

  // Storage-capacity guardrail, shared with the Storage tab's add dialog: the catalog
  // ALWAYS populates; adds are blocked past capacity unless the remembered bypass is on.
  const slotsFree = useMemo(
    () =>
      save && gameData?.roomCapacity
        ? computeItemCapacity(save, gameData.roomCapacity) -
          (save.vault?.inventory?.items?.length ?? 0)
        : null,
    [save, gameData],
  );
  const { blocked, notice } = useStorageCapacityGuard(slotsFree, 1);
  const bypassCapacity = useUIStore((s) => s.storageBypassCapacity);

  const onAddToStorage = (items: CatalogAddItem[]): void => {
    const total = items.reduce((n, it) => n + it.count, 0);
    if (total === 0) return;
    if (blocked) return; // buttons are disabled; belt-and-braces for keyboard flows
    if (slotsFree !== null && !bypassCapacity && total > Math.max(0, slotsFree)) {
      // Full is handled by `blocked`; this catches a partial overflow (e.g. 3 free, add 5).
      pushToast(`Not enough storage space (${Math.max(0, slotsFree)} free).`);
      return;
    }
    applyEdit(
      (s) => items.reduce((acc, it) => grantItems(acc, storageType, it.id, it.count), s),
      `Add ${total} to storage`,
    );
    pushToast(`Added ${total} ${unitNoun} to storage.`);
  };

  const onConfirmEquip = (serializeIds: number[]): void => {
    if (!equipItem || slot === null || serializeIds.length === 0) return;
    const op = slot === 'Outfit' ? equipOutfit : equipWeapon;
    const id = equipItem.id;
    applyEdit(
      (s) => serializeIds.reduce((acc, did) => op(acc, did, id), s),
      `Equip ${equipItem.name}`,
    );
    pushToast(
      `Equipped ${equipItem.name} on ${serializeIds.length} ${
        serializeIds.length === 1 ? 'dweller' : 'dwellers'
      }.`,
    );
  };

  return (
    <div className="h-full min-h-0">
      <CatalogTableView<T>
        title={title}
        unitNoun={unitNoun}
        data={data}
        schema={schema}
        persistKey={persistKey}
        {...(preset ? { preset } : {})}
        getRowId={(r) => r.id}
        getRowLabel={(r) => r.name}
        searchLabel={searchLabel}
        searchPlaceholder={searchPlaceholder}
        gameDataStatus={gameDataStatus}
        onAddToStorage={onAddToStorage}
        addDisabled={blocked}
        addDisabledReason="Storage is maxed. Tick the bypass checkbox in the notice above to add anyway."
        notice={notice}
        {...(slot !== null ? { onEquip: (id: string) => setEquipId(id) } : {})}
        virtualized={virtualized}
      />

      {equipItem && slot !== null && (
        <EquipOnDwellersDialog
          open
          onClose={() => setEquipId(null)}
          slot={slot}
          itemName={equipItem.name}
          dwellers={dwellerRows}
          onConfirm={onConfirmEquip}
          virtualized={virtualized}
        />
      )}
    </div>
  );
}
