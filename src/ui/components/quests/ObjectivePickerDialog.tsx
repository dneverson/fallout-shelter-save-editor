import { useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ColumnDef } from '@tanstack/react-table';
import type { ObjectiveDef } from '../../../domain/gamedata/schemas.ts';
import { UnifiedTable } from '../table/UnifiedTable.tsx';
import { badgeColumn } from '../table/columnKit.tsx';
import {
  objectiveCatalogSchema,
  OBJECTIVE_PICKER_PRESET,
} from '../table/schemas/objectiveCatalogSchema.tsx';
import { MODAL_LARGE } from '../../lib/modalClasses.ts';

// Replacement picker for one objective slot: the full 530-entry catalog in the unified
// table (search, sort, per-column filters, persisted column layout - like the equip
// pickers). Clicking a row swaps the slot's objective (resetting its progress) and closes.
// Non-rotation / duplicate ids are inert on load, so the whole catalog is offered rather
// than only the shuffle-bag pool. `virtualized` defaults true; tests pass false since
// jsdom has no layout.

interface ObjectivePickerDialogProps {
  objectives: ObjectiveDef[];
  /** The id currently in the slot, badged in the table. */
  currentId: string | null;
  onPick: (objectiveID: string) => void;
  onClose: () => void;
  virtualized?: boolean;
}

export function ObjectivePickerDialog({
  objectives,
  currentId,
  onPick,
  onClose,
  virtualized = true,
}: ObjectivePickerDialogProps) {
  const schema = useMemo(() => objectiveCatalogSchema(), []);

  // Prepend a non-interactive "Current" badge column so the slot's objective is obvious.
  const leading = useMemo<ColumnDef<ObjectiveDef>[]>(
    () => [
      badgeColumn<ObjectiveDef>({
        id: '_current',
        label: 'Current',
        predicate: (o) => o.m_objectiveID === currentId,
        size: 76,
      }),
    ],
    [currentId],
  );

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_LARGE} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-base font-semibold">Choose an objective</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded px-2 py-1 text-neutral-400 hover:text-neutral-100"
            >
              ✕
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Replace this slot with a different daily objective from the catalog.
          </Dialog.Description>

          <UnifiedTable<ObjectiveDef>
            className="mt-3 min-h-0 flex-1"
            virtualized={virtualized}
            schema={schema}
            persistKey="objectivePicker"
            preset={OBJECTIVE_PICKER_PRESET}
            leading={leading}
            data={objectives}
            getRowId={(o) => o.m_objectiveID}
            enableGlobalFilter
            searchLabel="Search objectives"
            searchPlaceholder="Search objectives…"
            initialSorting={[
              { id: 'tier', desc: false },
              { id: 'objective', desc: false },
            ]}
            onRowClick={(o) => onPick(o.m_objectiveID)}
            emptyState="No objectives match."
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
