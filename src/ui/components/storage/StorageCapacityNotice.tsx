import type { ReactElement } from 'react';
import { useUIStore } from '../../../state/uiStore.ts';

// The ONE storage-capacity guardrail shared by every add-to-storage surface (the Storage
// tab's add dialog, the Weapons/Outfits/Junk catalog tabs, and pet creation). Tables and
// forms ALWAYS populate; when an add would exceed the vault's item capacity, this banner
// explains it and the add buttons disable, unless the user ticks the bypass, which is
// remembered (persisted uiStore flag) across every tab.

export interface StorageCapacityGuard {
  /** True when the pending add must be blocked (over capacity and no bypass). */
  blocked: boolean;
  /** True when the pending add exceeds capacity (banner shows even when bypassed). */
  over: boolean;
  /** The banner to render above the table/form (null when capacity is fine/unknown). */
  notice: ReactElement | null;
}

/**
 * Capacity guard for an add-to-storage surface. `slotsFree` = capacity − stored (null
 * while game data loads = no guard); `wouldAdd` = items the pending action would add
 * (pass 1 for single-item flows so a full vault blocks the next add).
 */
export function useStorageCapacityGuard(
  slotsFree: number | null,
  wouldAdd: number,
): StorageCapacityGuard {
  const bypass = useUIStore((s) => s.storageBypassCapacity);
  const setBypass = useUIStore((s) => s.setStorageBypassCapacity);

  const over = slotsFree !== null && wouldAdd > Math.max(0, slotsFree);
  const blocked = over && !bypass;
  if (!over) return { blocked: false, over: false, notice: null };

  const free = Math.max(0, slotsFree ?? 0);
  const overBy = wouldAdd - free;
  return {
    blocked,
    over,
    notice: (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
        <p className="min-w-0 text-neutral-200">
          <span className="font-medium text-amber-300">
            {free === 0 ? 'Storage is full' : 'Not enough storage space'}
          </span>{' '}
          ({free} slot{free === 1 ? '' : 's'} free
          {wouldAdd > 1 ? `, adding ${wouldAdd} exceeds capacity by ${overBy}` : ''}). Free up
          space, build/upgrade storage rooms, or bypass the limit below.
        </p>
        <label className="flex shrink-0 items-center gap-2 text-sm text-neutral-200">
          <input
            type="checkbox"
            checked={bypass}
            onChange={(e) => setBypass(e.target.checked)}
            className="h-4 w-4 accent-amber-500"
          />
          Bypass storage capacity (remembered)
        </label>
      </div>
    ),
  };
}
