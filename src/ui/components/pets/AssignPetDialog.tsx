import { useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ColumnDef } from '@tanstack/react-table';
import type { DwellerRow } from '../../../domain/selectors/dwellerSelectors.ts';
import { UnifiedTable } from '../table/UnifiedTable.tsx';
import { badgeColumn } from '../table/columnKit.tsx';
import { dwellerSchema } from '../table/schemas/dwellerSchema.tsx';
import { MODAL_LARGE } from '../../lib/modalClasses.ts';

// Dweller picker for equipping a pet instance onto a dweller.
// Clicking a dweller equips this pet onto them - swapping any pet they already wear
// back to storage (handled by the op) - and closes. The dweller already wearing this
// instance is badged. A dedicated picker rather than the generic EquipPickerDialog,
// which carries item equip/reset semantics that don't apply here.

interface AssignPetDialogProps {
  open: boolean;
  onClose: () => void;
  dwellers: DwellerRow[];
  /** serializeId of the dweller currently wearing this instance, to badge its row. */
  currentOwnerId: number | null;
  onAssign: (dwellerId: number) => void;
  virtualized?: boolean;
}

export function AssignPetDialog({
  open,
  onClose,
  dwellers,
  currentOwnerId,
  onAssign,
  virtualized = true,
}: AssignPetDialogProps) {
  const schema = useMemo(() => dwellerSchema(), []);
  const leading = useMemo<ColumnDef<DwellerRow>[]>(
    () => [
      badgeColumn<DwellerRow>({
        id: '_current',
        label: 'Wearing',
        size: 86,
        predicate: (d) => d.serializeId === currentOwnerId,
      }),
    ],
    [currentOwnerId],
  );
  // The dweller's name, level, and current pet (which assigning will replace).
  const preset = ['name', 'level', 'pet'];

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_LARGE} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-semibold">Equip pet to dweller</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-neutral-400">
                Their current pet, if any, returns to storage.
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
            persistKey="assignPet"
            preset={preset}
            leading={leading}
            data={dwellers}
            getRowId={(d) => String(d.serializeId)}
            enableGlobalFilter
            initialSorting={[{ id: 'name', desc: false }]}
            onRowClick={(d) => {
              onAssign(d.serializeId);
              onClose();
            }}
            emptyState="No dwellers."
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
