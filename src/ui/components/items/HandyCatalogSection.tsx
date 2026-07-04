import { useMemo, useState } from 'react';
import { useSaveStore } from '../../../state/saveStore.ts';
import { useGameData } from '../../hooks/useGameData.ts';
import type { Handy } from '../../../domain/gamedata/schemas.ts';
import {
  createMrHandy,
  handyFloorOptions,
  DEFAULT_MR_HANDY_HEALTH,
} from '../../../domain/ops/mrHandyOps.ts';
import { floorAdopterId } from '../../../domain/ops/roomOps.ts';
import { displayFloor } from '../../../domain/rooms/layout.ts';
import { pushToast } from '../../../state/toastStore.ts';
import { CatalogTableView, type CatalogAddItem } from './CatalogTableView.tsx';
import { handyCatalogSchema } from '../table/schemas/handyCatalogSchema.tsx';
import { AssignHandyFloorDialog } from '../handies/AssignHandyFloorDialog.tsx';

// Mr. Handy CATALOG section - the "Catalog" tab of the Mr. Handies screen, mirroring
// PetCatalogSection. The four vault-helper variants the game ships (from handies.json,
// extracted from the game's UniqueMrHandyData + MrHandyData registries). Two per-row
// actions: "Add" mints robots that wait outside the vault (a normal state - they sit at
// the door until placed); "Assign…" opens a FLOOR picker and mints one robot straight
// onto the chosen floor (one robot per floor, the game rule).

export function HandyCatalogSection({ virtualized = true }: { virtualized?: boolean } = {}) {
  const save = useSaveStore((s) => s.save);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const { data: gameData, status: gameDataStatus } = useGameData();

  const handies = useMemo(() => gameData?.handies ?? [], [gameData]);
  const schema = useMemo(() => handyCatalogSchema(), []);
  const fullHealth = gameData?.roomCapacity.base.mrHandyHealth ?? DEFAULT_MR_HANDY_HEALTH;

  // The variant the "Assign…" floor picker is currently open for (null = closed).
  const [assignFor, setAssignFor] = useState<Handy | null>(null);
  const floorOptions = useMemo(() => (save ? handyFloorOptions(save) : []), [save]);

  const onAdd = (items: CatalogAddItem[]): void => {
    if (!save) return;
    const grants = items
      .map((it) => ({ handy: handies.find((h) => h.id === it.id) ?? null, count: it.count }))
      .filter((g): g is { handy: Handy; count: number } => g.handy !== null);
    const total = grants.reduce((n, g) => n + g.count, 0);
    if (total === 0) return;
    applyEdit(
      (s) => {
        let next = s;
        for (const { handy, count } of grants) {
          for (let i = 0; i < count; i += 1) {
            next = createMrHandy(next, {
              name: handy.name,
              variant: handy.variantId,
              characterType: handy.characterType,
              actorDataId: handy.actorDataId,
              health: fullHealth,
            });
          }
        }
        return next;
      },
      `Add ${total} robot${total === 1 ? '' : 's'}`,
    );
    pushToast(
      `Added ${total} robot${total === 1 ? '' : 's'} (waiting outside the vault - use Assign… ` +
        `or the Owned tab to place ${total === 1 ? 'it' : 'them'} on a floor).`,
    );
  };

  // "Assign…" commit: mint ONE robot of the picked variant directly onto the chosen
  // floor (the domain resolves which room on that floor carries the reference).
  const onAssignToFloor = (row: number): void => {
    if (!save || !assignFor) return;
    const roomId = floorAdopterId(save, row);
    if (roomId === null) return;
    const handy = assignFor;
    applyEdit(
      (s) =>
        createMrHandy(s, {
          name: handy.name,
          variant: handy.variantId,
          characterType: handy.characterType,
          actorDataId: handy.actorDataId,
          health: fullHealth,
          roomId,
        }),
      `Add ${handy.name} to floor ${displayFloor(row)}`,
    );
    pushToast(`${handy.name} added and placed on floor ${displayFloor(row)}.`);
    setAssignFor(null);
  };

  return (
    <div className="h-full min-h-0">
      <CatalogTableView<Handy>
        title="Mr. Handies"
        unitNoun="robots"
        data={handies}
        schema={schema}
        persistKey="catalog.handies"
        getRowId={(h) => h.id}
        getRowLabel={(h) => h.name}
        searchLabel="Search robots"
        searchPlaceholder="Search robots…"
        gameDataStatus={gameDataStatus}
        onAddToStorage={onAdd}
        bulkAddLabel="Add to vault"
        onEquip={(id) => setAssignFor(handies.find((h) => h.id === id) ?? null)}
        equipLabel="Assign…"
        virtualized={virtualized}
      />
      {assignFor && (
        <AssignHandyFloorDialog
          open
          robotName={assignFor.name}
          floorOptions={floorOptions}
          onAssign={onAssignToFloor}
          onCancel={() => setAssignFor(null)}
        />
      )}
    </div>
  );
}
