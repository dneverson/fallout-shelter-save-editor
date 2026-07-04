import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import type { DwellerRow } from '../../../domain/selectors/dwellerSelectors.ts';
import { UnifiedTable } from '../table/UnifiedTable.tsx';
import { selectColumn } from '../table/columnKit.tsx';
import { dwellerSchema } from '../table/schemas/dwellerSchema.tsx';
import { MODAL_LARGE } from '../../lib/modalClasses.ts';

// Single-item → multi-dweller equip chooser. Opened from
// a catalog table's per-row "Equip…" action: the user has picked ONE item
// (weapon/outfit/pet) and now selects any number of dwellers to equip it onto. Built on
// the shared <DataTable> so the chooser is itself sortable + searchable, with distinct
// columns the user asked for: each dweller's room LOCATION (matters most for outfits -
// the room's SPECIAL drives the outfit choice), their CURRENT item for this slot, and
// the seven SPECIAL stats as individual sortable badges (not a #/#/# string). Confirm
// hands the selected serializeIds back to the view, which applies the slot's equip op to
// all of them in one undo step. Mounted only while open, so the selection resets each time.

export type EquipSlot = 'Weapon' | 'Outfit' | 'Pet';

/** The dweller's current item name for the slot being equipped (or "–" when empty). */
function currentSlotLabel(dweller: DwellerRow, slot: EquipSlot): string {
  if (slot === 'Weapon') return dweller.weapon?.name ?? '–';
  if (slot === 'Outfit') return dweller.outfit?.name ?? '–';
  const pet = dweller.pet;
  return pet ? pet.uniqueName || pet.breed : '–';
}

interface EquipOnDwellersDialogProps {
  open: boolean;
  onClose: () => void;
  slot: EquipSlot;
  itemName: string;
  dwellers: DwellerRow[];
  onConfirm: (serializeIds: number[]) => void;
  virtualized?: boolean;
}

export function EquipOnDwellersDialog({
  open,
  onClose,
  slot,
  itemName,
  dwellers,
  onConfirm,
  virtualized = true,
}: EquipOnDwellersDialogProps) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const selectedIds = useMemo(
    () =>
      Object.keys(rowSelection)
        .filter((id) => rowSelection[id])
        .map(Number)
        .sort((a, b) => a - b),
    [rowSelection],
  );

  const slotNoun = slot.toLowerCase();

  const schema = useMemo(() => dwellerSchema(), []);
  // Pinned columns the chooser always shows: the select checkbox and this slot's CURRENT
  // item (which the equip will replace). The rest come from the dweller schema via the
  // preset below, and the Columns button reveals anything else.
  const leading = useMemo<ColumnDef<DwellerRow>[]>(
    () => [
      selectColumn<DwellerRow>((d) => d.name || `#${d.serializeId}`),
      {
        id: 'current',
        accessorFn: (d) => currentSlotLabel(d, slot),
        header: `Current ${slot}`,
        cell: ({ getValue }) => {
          const label = getValue<string>();
          return <span title={label}>{label}</span>;
        },
        size: 170,
        enableColumnFilter: false,
      },
    ],
    [slot],
  );
  // Location matters most for outfits (the room's SPECIAL drives the choice) + the SPECIAL
  // stats; name + level round it out.
  const preset = ['name', 'assignment', 'level', 's', 'p', 'e', 'c', 'i', 'a', 'l'];

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_LARGE} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-semibold">Equip {itemName}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-neutral-400">
                Select dwellers to equip this {slotNoun} onto. Each dweller&rsquo;s current{' '}
                {slotNoun} is replaced. Sort or search to find the right dwellers.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="rounded px-2 py-1 text-neutral-400 hover:text-neutral-100"
            >
              ✕
            </Dialog.Close>
          </div>

          <UnifiedTable<DwellerRow>
            className="mt-3 min-h-0 flex-1"
            virtualized={virtualized}
            schema={schema}
            persistKey={`equipOnDwellers.${slotNoun}`}
            preset={preset}
            leading={leading}
            data={dwellers}
            getRowId={(d) => String(d.serializeId)}
            enableGlobalFilter
            enableRowSelection
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            initialSorting={[{ id: 'name', desc: false }]}
            emptyState="No dwellers to equip."
          />

          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-neutral-400">{selectedIds.length} selected</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={() => {
                  onConfirm(selectedIds);
                  onClose();
                }}
                className="rounded border border-sky-700 px-3 py-1.5 text-sm text-sky-300 hover:bg-sky-900/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Equip on {selectedIds.length === 1 ? '1 dweller' : `${selectedIds.length} dwellers`}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
