import { useState } from 'react';
import { VaultCard } from './VaultCard.tsx';
import { NumberField } from '../forms/NumberField.tsx';
import { InfoTooltip } from '../InfoTooltip.tsx';
import { fieldHelp } from '../../lib/fieldHelp.ts';
import { formatDuration } from '../../../domain/tasks/taskLookup.ts';
import type { DailyRewardStatus } from '../../../domain/ops/timerOps.ts';

// Global "hands of time" controls: fast-forward every vault timer at once
// (timerOps.fastForwardVault backdates timeMgr.timeSaveDate), plus the daily
// poker-chip reward timer. Presentational; VaultView applies the edits.
// `clockAheadSeconds` is the persistent feedback: cumulative fast-forward vs the
// imported save, so repeated clicks visibly add up (and undo visibly rolls back).

const PRESETS: ReadonlyArray<{ label: string; seconds: number }> = [
  { label: '+1 h', seconds: 3_600 },
  { label: '+8 h', seconds: 8 * 3_600 },
  { label: '+1 d', seconds: 86_400 },
  { label: '+1 w', seconds: 7 * 86_400 },
];

const MAX_CUSTOM_HOURS = 87_600; // 10 years, the op's own cap

const BUTTON =
  'rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 pointer-coarse:px-4';

export function VaultTimeCard({
  canFastForward,
  clockAheadSeconds,
  onFastForward,
  dailyRewards,
  onMakeDailyRewardsClaimable,
}: {
  /** False when the save carries no readable timeSaveDate (nothing to backdate). */
  canFastForward: boolean;
  /** Cumulative fast-forward vs the imported save (0 = untouched; null = unreadable). */
  clockAheadSeconds: number | null;
  onFastForward: (seconds: number, label: string) => void;
  dailyRewards: DailyRewardStatus;
  onMakeDailyRewardsClaimable: () => void;
}) {
  const [customHours, setCustomHours] = useState(12);

  return (
    <VaultCard
      title="Vault time"
      help={fieldHelp.vaultTime}
      description="Fast-forward every timer in the vault at once."
    >
      <p className="text-sm text-neutral-300">
        Vault clock is{' '}
        <span className="text-neutral-100">
          {clockAheadSeconds === null
            ? 'not readable in this save'
            : clockAheadSeconds > 0
              ? `${formatDuration(clockAheadSeconds)} ahead of the imported save`
              : 'unchanged from the imported save'}
        </span>
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        {PRESETS.map(({ label, seconds }) => (
          <button
            key={label}
            type="button"
            disabled={!canFastForward}
            onClick={() => onFastForward(seconds, `Fast-forward ${label.replace('+', '+ ')}`)}
            className={`${BUTTON} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <NumberField
          label="Custom (hours)"
          value={customHours}
          min={1}
          max={MAX_CUSTOM_HOURS}
          onCommit={setCustomHours}
          className="w-32"
        />
        <button
          type="button"
          disabled={!canFastForward}
          onClick={() => onFastForward(customHours * 3_600, `Fast-forward +${customHours}h`)}
          className={`${BUTTON} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          Apply
        </button>
      </div>

      <p className="mt-1.5 text-[11px] text-neutral-400">
        Clicks add up; undo steps back one click at a time. Takes effect the next time the save is
        loaded in the game: it catches up as if you had been away that long - production and
        crafting finish, pregnancies come due, training and exploration advance, cooldowns expire.
        Repeating timers complete one cycle and continue at their normal pace. This clock is
        independent of the Season clock on the Season Pass tab - vault time lives in this save,
        season timing in the season file, and moving one never moves the other.
      </p>

      <div className="mt-3 border-t border-neutral-800 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-sm text-neutral-300">
            Daily reward timer
            <InfoTooltip text={fieldHelp.dailyRewards} />
          </div>
          {dailyRewards.pending > 0 && (
            <button type="button" onClick={onMakeDailyRewardsClaimable} className={BUTTON}>
              Make claimable now
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-neutral-500">
          {dailyRewards.pending > 0
            ? `Next reward in ${
                dailyRewards.soonestSeconds !== null && Number.isFinite(dailyRewards.soonestSeconds)
                  ? formatDuration(dailyRewards.soonestSeconds)
                  : 'a long time'
              } (real-world clock).`
            : dailyRewards.total > 0
              ? 'Already claimable - the game grants it the next time this save loads.'
              : 'No timer recorded - the game creates it already claimable when this save loads (season vaults get a daily Spin-to-Win poker chip).'}
        </p>
      </div>
    </VaultCard>
  );
}
