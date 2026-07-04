import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { RowSelectionState } from '@tanstack/react-table';
import type { DwellerRow } from '../../../domain/selectors/dwellerSelectors.ts';
import { UnifiedTable } from '../table/UnifiedTable.tsx';
import { selectColumn } from '../table/columnKit.tsx';
import { dwellerSchema } from '../table/schemas/dwellerSchema.tsx';
import { MODAL_LARGE } from '../../lib/modalClasses.ts';

// Assign-dwellers-to-room dialog. The standardized dweller table:
// a searchable, multi-select roster of every dweller not already in the room, rendered from
// the shared dweller schema so the Columns button exposes the full column set (name / level
// / current assignment shown by default). Assign moves the chosen dwellers in one undo step.
// Capacity (room metadata maxDwellers) caps the selection - Assign disables past the
// remaining free slots.

interface AssignRoomDialogProps {
  open: boolean;
  onClose: () => void;
  roomLabel: string;
  dwellers: DwellerRow[];
  /** Free slots left in the room (0 = unlimited / not capacity-bound). */
  remaining: number;
  onAssign: (ids: number[]) => void;
  virtualized?: boolean;
}

export function AssignRoomDialog({
  open,
  onClose,
  roomLabel,
  dwellers,
  remaining,
  onAssign,
  virtualized = true,
}: AssignRoomDialogProps) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const selectedIds = useMemo(
    () =>
      Object.keys(rowSelection)
        .filter((id) => rowSelection[id])
        .map(Number),
    [rowSelection],
  );

  const close = (): void => {
    setRowSelection({});
    onClose();
  };

  const schema = useMemo(() => dwellerSchema(), []);
  const leading = useMemo(
    () => [selectColumn<DwellerRow>((d) => d.name || `#${d.serializeId}`)],
    [],
  );
  // Name + level + current assignment by default; the rest are one Columns-button click away.
  const preset = ['name', 'level', 'assignment'];

  const overCapacity = remaining > 0 && selectedIds.length > remaining;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_LARGE} p-5`}>
          <Dialog.Title className="text-base font-semibold">Assign to {roomLabel}</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-neutral-400">
            {remaining > 0
              ? `${remaining} free slot${remaining === 1 ? '' : 's'}`
              : 'Select dwellers to assign'}
          </Dialog.Description>

          <UnifiedTable<DwellerRow>
            className="mt-3 min-h-0 flex-1"
            virtualized={virtualized}
            schema={schema}
            persistKey="assignRoom"
            preset={preset}
            leading={leading}
            data={dwellers}
            getRowId={(d) => String(d.serializeId)}
            enableGlobalFilter
            searchLabel="Search dwellers"
            searchPlaceholder="Search dwellers…"
            initialSorting={[{ id: 'name', desc: false }]}
            enableRowSelection
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            emptyState="No dwellers"
          />

          <div className="mt-4 flex items-center justify-end gap-2">
            {overCapacity && (
              <span className="mr-auto text-xs text-amber-400">Exceeds free slots</span>
            )}
            <button
              type="button"
              onClick={close}
              className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedIds.length === 0 || overCapacity}
              onClick={() => {
                onAssign(selectedIds);
                close();
              }}
              className="rounded bg-amber-500 px-4 py-1.5 text-sm font-medium text-neutral-900 hover:bg-amber-400 disabled:opacity-40"
            >
              Assign {selectedIds.length || ''}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
