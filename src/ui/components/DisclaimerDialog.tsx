import * as Dialog from '@radix-ui/react-dialog';
import { MODAL_SMALL } from '../lib/modalClasses.ts';

interface DisclaimerDialogProps {
  open: boolean;
  onAccept: () => void;
}

// One-time disclaimer gate. Acceptance is persisted by
// the caller; the dialog has no dismiss path other than "I understand".
export function DisclaimerDialog({ open, onAccept }: DisclaimerDialogProps) {
  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_SMALL} p-6`}>
          <Dialog.Title className="text-lg font-semibold">Before you edit</Dialog.Title>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-neutral-300">
            <Dialog.Description>
              This tool reads and edits Fallout Shelter save files entirely in your browser. Nothing
              is ever uploaded; there is no server and no telemetry.
            </Dialog.Description>
            <p>
              Editing a save can permanently corrupt it. Modifying saves may also breach the
              game&apos;s or platform&apos;s terms of service and could cost you your account,
              achievements, or progress. A timestamped backup of your original file is downloaded
              before your first export, but keep your own copy too.
            </p>
            <p>
              This is an unofficial fan project, provided &ldquo;as is&rdquo; without warranty of
              any kind. It is not affiliated with, endorsed by, or sponsored by Bethesda Softworks,
              ZeniMax Media, Microsoft, or their affiliates. Fallout and Fallout Shelter are
              trademarks of their respective owners. You use this tool entirely at your own risk.
            </p>
          </div>
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={onAccept}
              className="rounded bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-amber-400"
            >
              I understand and accept the risks
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
