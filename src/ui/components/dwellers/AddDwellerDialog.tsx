import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { Gender } from '../../../domain/model/saveSchema.ts';
import type { NewDwellerOpts } from '../../../domain/ops/dwellerOps.ts';
import { randomName } from '../../lib/randomName.ts';
import { MODAL_SMALL } from '../../lib/modalClasses.ts';

// Add-dweller modal: a new dweller at the door, level 1, optional random name.
// Collects first/last name + gender, with a one-click Randomize. The
// op fills in the full base shape; the new dweller opens in the character sheet for any
// further edits. Mounted only while open, so its state resets each time.

interface AddDwellerDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (opts: NewDwellerOpts) => void;
}

export function AddDwellerDialog({ open, onClose, onCreate }: AddDwellerDialogProps) {
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState<Gender>(2);

  const randomize = (): void => {
    const r = randomName(gender);
    setName(r.name);
    setLastName(r.lastName);
  };

  const create = (): void => {
    onCreate({ name: name.trim(), lastName: lastName.trim(), gender });
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_SMALL} p-6`}>
          <Dialog.Title className="text-base font-semibold">Add dweller</Dialog.Title>
          <Dialog.Description className="mt-0.5 text-xs text-neutral-400">
            Created at the vault door, level 1. Edit the rest in the character sheet.
          </Dialog.Description>

          <div className="mt-4 flex gap-2">
            <label className="flex flex-1 flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-neutral-400">
                First name
              </span>
              <input
                type="text"
                aria-label="First name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
              />
            </label>
            <label className="flex flex-1 flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-neutral-400">
                Last name
              </span>
              <input
                type="text"
                aria-label="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
              />
            </label>
          </div>

          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-neutral-400">Gender</span>
              <div className="flex overflow-hidden rounded border border-neutral-700">
                {([1, 2] as Gender[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={gender === g}
                    onClick={() => setGender(g)}
                    className={`px-3 py-1 text-sm ${
                      gender === g
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'text-neutral-300 hover:bg-neutral-800'
                    }`}
                  >
                    {g === 1 ? 'Female' : 'Male'}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={randomize}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              Randomize
            </button>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={create}
              className="rounded bg-amber-500 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-amber-400"
            >
              Add dweller
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
