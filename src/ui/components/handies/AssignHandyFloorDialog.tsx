import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { MODAL_SMALL } from '../../lib/modalClasses.ts';
import type { HandyFloorOption } from '../../../domain/ops/mrHandyOps.ts';

// Floor picker for placing a Mr. Handy (the Catalog tab's per-row "Assign…" action).
// Assignment is by FLOOR (1-based labels), never a specific room - the domain resolves
// which room's mrHandyList carries the reference. Floors that already hold a robot are
// disabled (one per floor, the game rule).

interface AssignHandyFloorDialogProps {
  open: boolean;
  /** Robot being placed, for the title ("Assign Snip Snip to a floor"). */
  robotName: string;
  floorOptions: HandyFloorOption[];
  onAssign: (row: number) => void;
  onCancel: () => void;
}

export function AssignHandyFloorDialog({
  open,
  robotName,
  floorOptions,
  onAssign,
  onCancel,
}: AssignHandyFloorDialogProps) {
  const freeFloors = useMemo(
    () => floorOptions.filter((f) => f.takenBy === undefined),
    [floorOptions],
  );
  const [pick, setPick] = useState<string>('');
  const picked = pick !== '' ? Number(pick) : (freeFloors[0]?.row ?? null);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_SMALL} p-6`}>
          <Dialog.Title className="text-base font-semibold">
            Assign {robotName} to a floor
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-neutral-300">
            Adds the robot and places it on the chosen floor. One robot per floor (the game&apos;s
            rule) - floors that already have one are disabled.
          </Dialog.Description>
          <label className="mt-4 flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-neutral-400">Floor</span>
            <select
              aria-label="Floor to assign the robot to"
              value={picked ?? ''}
              onChange={(e) => setPick(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
            >
              {floorOptions.length === 0 && <option value="">No floors available</option>}
              {floorOptions.map((f) => (
                <option key={f.row} value={f.row} disabled={f.takenBy !== undefined}>
                  {f.label}
                  {f.takenBy !== undefined ? ' (already has a robot)' : ''}
                </option>
              ))}
            </select>
          </label>
          {freeFloors.length === 0 && floorOptions.length > 0 && (
            <p className="mt-2 text-xs text-amber-400">
              Every floor already has a robot - free one up first (or use Add to leave the new robot
              waiting outside the vault).
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={picked === null || freeFloors.every((f) => f.row !== picked)}
              onClick={() => {
                if (picked !== null) onAssign(picked);
              }}
              className="rounded bg-amber-500 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-amber-400 disabled:opacity-40"
            >
              Assign
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
