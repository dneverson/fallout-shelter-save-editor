import { useMemo, useState } from 'react';
import { useSaveStore } from '../../../state/saveStore.ts';
import { useUIStore } from '../../../state/uiStore.ts';
import { useGameData } from '../../hooks/useGameData.ts';
import { selectDwellerRows } from '../../../domain/selectors/dwellerSelectors.ts';
import type { Pet } from '../../../domain/gamedata/schemas.ts';
import { createPet, type NewPet } from '../../../domain/ops/dwellerOps.ts';
import { petSpecialName } from '../../../domain/gamedata/gameData.ts';
import { addPet } from '../../../domain/ops/storageOps.ts';
import { computeItemCapacity } from '../../../domain/selectors/vaultSelectors.ts';
import { pushToast } from '../../../state/toastStore.ts';
import { CatalogTableView, type CatalogAddItem } from './CatalogTableView.tsx';
import { EquipOnDwellersDialog } from './EquipOnDwellersDialog.tsx';
import { petCatalogSchema } from '../table/schemas/petCatalogSchema.tsx';
import { useStorageCapacityGuard } from '../storage/StorageCapacityNotice.tsx';

// Pet CATALOG section - the "Catalog" tab of the Pets screen. Unlike the
// fungible weapon/outfit/junk catalogs (ItemCatalogSection), pets are INSTANCES with a
// rolled bonus value, so add/equip mint a fresh instance: add-to-storage grants a new
// pet via `addPet`, and equip creates+equips one on each selected dweller via `createPet`
// (which returns any pet they already wore to storage - instances are never silently
// destroyed). Catalog one-click grants the breed at its TOP legal value with the breed
// name; the "Create pet" form (Owned tab) remains for custom rolls/names.

/** Build a fresh pet instance for a catalog id at its best legal value. */
function newPetFor(pet: Pet): NewPet {
  return {
    petId: pet.id,
    uniqueName: petSpecialName(pet),
    bonus: pet.bonus,
    bonusValue: pet.bonusMax,
  };
}

export function PetCatalogSection({ virtualized = true }: { virtualized?: boolean } = {}) {
  const save = useSaveStore((s) => s.save);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const { data: gameData, status: gameDataStatus } = useGameData();

  const [equipId, setEquipId] = useState<string | null>(null);

  const pets = useMemo(() => gameData?.pets ?? [], [gameData]);
  const schema = useMemo(() => petCatalogSchema(), []);
  const dwellerRows = useMemo(
    () => (save ? selectDwellerRows(save, gameData ?? undefined) : []),
    [save, gameData],
  );

  const equipPet = equipId ? (pets.find((p) => p.id === equipId) ?? null) : null;

  // Storage-capacity guardrail, shared with the other catalog tabs: stored pets count
  // against the vault's item capacity like any other inventory item, so adds are blocked
  // past capacity unless the remembered bypass is on. (Equip is a swap, so it stays open.)
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
    const grants = items
      .map((it) => ({ pet: pets.find((p) => p.id === it.id) ?? null, count: it.count }))
      .filter((g): g is { pet: Pet; count: number } => g.pet !== null);
    const total = grants.reduce((n, g) => n + g.count, 0);
    if (total === 0) return;
    if (blocked) return; // buttons are disabled; belt-and-braces for keyboard flows
    if (slotsFree !== null && !bypassCapacity && total > Math.max(0, slotsFree)) {
      // Full is handled by `blocked`; this catches a partial overflow (e.g. 3 free, add 5).
      pushToast(`Not enough storage space (${Math.max(0, slotsFree)} free).`);
      return;
    }
    // Pets are instances, so a count of N mints N fresh instances of the breed (each at its
    // top legal value) rather than bumping a fungible stack.
    applyEdit((s) => {
      let next = s;
      for (const { pet, count } of grants) {
        for (let i = 0; i < count; i += 1) next = addPet(next, newPetFor(pet));
      }
      return next;
    }, `Add ${total} pets to storage`);
    pushToast(`Added ${total} ${total === 1 ? 'pet' : 'pets'} to storage.`);
  };

  const onConfirmEquip = (serializeIds: number[]): void => {
    if (!equipPet || serializeIds.length === 0) return;
    const pet = newPetFor(equipPet);
    applyEdit(
      (s) => serializeIds.reduce((acc, did) => createPet(acc, did, pet), s),
      `Equip ${petSpecialName(equipPet)}`,
    );
    pushToast(
      `Equipped ${petSpecialName(equipPet)} on ${serializeIds.length} ${
        serializeIds.length === 1 ? 'dweller' : 'dwellers'
      }.`,
    );
  };

  return (
    <div className="h-full min-h-0">
      <CatalogTableView<Pet>
        title="Pets"
        unitNoun="pets"
        data={pets}
        schema={schema}
        persistKey="catalog.pets"
        getRowId={(p) => p.id}
        getRowLabel={(p) => petSpecialName(p)}
        searchLabel="Search pets"
        searchPlaceholder="Search pets…"
        gameDataStatus={gameDataStatus}
        onAddToStorage={onAddToStorage}
        addDisabled={blocked}
        addDisabledReason="Storage is maxed. Tick the bypass checkbox in the notice above to add anyway."
        notice={notice}
        onEquip={(id) => setEquipId(id)}
        equipLabel="Equip…"
        virtualized={virtualized}
      />

      {equipPet && (
        <EquipOnDwellersDialog
          open
          onClose={() => setEquipId(null)}
          slot="Pet"
          itemName={petSpecialName(equipPet)}
          dwellers={dwellerRows}
          onConfirm={onConfirmEquip}
          virtualized={virtualized}
        />
      )}
    </div>
  );
}
