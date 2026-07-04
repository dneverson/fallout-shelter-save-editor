import { useMemo, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ColumnDef } from '@tanstack/react-table';
import { UnifiedTable } from '../table/UnifiedTable.tsx';
import { badgeColumn } from '../table/columnKit.tsx';
import type { TableSchema } from '../table/tableSchema.ts';
import { MODAL_LARGE } from '../../lib/modalClasses.ts';

// Equip picker: the full item table in a modal. Clicking a row equips that
// item and closes; a footer action resets the slot to its default (the game has no empty
// weapon/outfit slot). The currently-equipped item is summarized in the header (delta vs
// current) and its row is badged. Generic over the item type so weapons,
// outfits, and pets share one component, each supplying its source-of-truth <TableSchema>
// and a persistence key (column layout persists per slot type via the unified table).
// `virtualized` defaults true; tests pass false since jsdom has no layout.

interface EquipPickerDialogProps<T> {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Summary of what's currently equipped, shown in the header. */
  currentSummary: ReactNode;
  data: T[];
  /** The type's full column schema (source of truth). */
  schema: TableSchema<T>;
  /** Persistence key for the picker's column layout (e.g. 'equip.weapon'). */
  persistKey: string;
  /** Hideable column ids visible by default; omit to show all. */
  preset?: readonly string[];
  getRowId: (row: T) => string;
  /** Id of the currently-equipped item, to badge its row. */
  equippedId: string | null;
  onEquip: (id: string) => void;
  /** Reset the slot to its default (unequip). */
  onReset: () => void;
  resetLabel: string;
  virtualized?: boolean;
}

export function EquipPickerDialog<T>({
  open,
  onClose,
  title,
  currentSummary,
  data,
  schema,
  persistKey,
  preset,
  getRowId,
  equippedId,
  onEquip,
  onReset,
  resetLabel,
  virtualized = true,
}: EquipPickerDialogProps<T>) {
  // Prepend a non-interactive "Equipped" badge column so the current item is obvious.
  const leading = useMemo<ColumnDef<T>[]>(
    () => [
      badgeColumn<T>({
        id: '_equipped',
        label: 'Equipped',
        predicate: (row) => getRowId(row) === equippedId,
      }),
    ],
    [getRowId, equippedId],
  );

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_LARGE} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-neutral-400">
                Currently equipped: {currentSummary}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="rounded px-2 py-1 text-neutral-400 hover:text-neutral-100"
            >
              ✕
            </Dialog.Close>
          </div>

          <UnifiedTable<T>
            className="mt-3 min-h-0 flex-1"
            virtualized={virtualized}
            schema={schema}
            persistKey={persistKey}
            {...(preset ? { preset } : {})}
            leading={leading}
            data={data}
            getRowId={getRowId}
            enableGlobalFilter
            initialSorting={[{ id: 'name', desc: false }]}
            onRowClick={(r) => {
              onEquip(getRowId(r));
              onClose();
            }}
            emptyState="No items."
          />

          <div className="mt-4 flex justify-between">
            <button
              type="button"
              onClick={() => {
                onReset();
                onClose();
              }}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              {resetLabel}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-100"
            >
              Close
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
