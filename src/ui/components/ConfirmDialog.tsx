import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { MODAL_SMALL } from '../lib/modalClasses.ts';

// Reusable confirmation modal for destructive/bulk actions. Modeled on the project's
// other Radix Dialog modals.

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red) rather than the default amber. */
  destructive?: boolean;
  /** Optional second action (e.g. an alternative path) shown beside the primary confirm. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  secondaryLabel,
  onSecondary,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_SMALL} p-6`}>
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-neutral-300">
            {message}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-100"
            >
              {cancelLabel}
            </button>
            {secondaryLabel && onSecondary && (
              <button
                type="button"
                onClick={onSecondary}
                className="rounded border border-amber-500/60 px-4 py-1.5 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/10"
              >
                {secondaryLabel}
              </button>
            )}
            <button
              type="button"
              onClick={onConfirm}
              className={`rounded px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors ${
                destructive ? 'bg-red-500 hover:bg-red-400' : 'bg-amber-500 hover:bg-amber-400'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
