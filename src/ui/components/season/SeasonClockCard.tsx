import { VaultCard } from '../vault/VaultCard.tsx';
import { fieldHelp } from '../../lib/fieldHelp.ts';

// Season clock: the game's own debug time offset (spd.debugTimeOffset). Advancing it
// shifts ALL season timing forward (weekly challenge unlocks, event windows, season end)
// without touching the vault save. Presentational; SeasonPassView applies the edits
// (advanceSeasonClock / skipToSeasonEnd / resetSeasonClock in seasonOps).

const BUTTON =
  'rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:px-4';

export function SeasonClockCard({
  offsetDays,
  activeLabel,
  endDate,
  onAdvanceDays,
  onSkipToEnd,
  onReset,
}: {
  /** Current offset in whole days (0 = real time). */
  offsetDays: number;
  /** Display label of the ACTIVE season (the clock always applies to season timing globally). */
  activeLabel: string;
  /** The active season's scheduled end date ("YYYY-MM-DD"), or null when unknown. */
  endDate: string | null;
  onAdvanceDays: (days: number) => void;
  onSkipToEnd: () => void;
  onReset: () => void;
}) {
  return (
    <VaultCard
      title="Season clock"
      help={fieldHelp.seasonClock}
      description={`Move season time forward for ${activeLabel}.`}
    >
      <p className="text-sm text-neutral-300">
        Clock is{' '}
        <span className="text-neutral-100">
          {offsetDays > 0
            ? `${offsetDays} day${offsetDays === 1 ? '' : 's'} ahead`
            : 'at real time'}
        </span>
        {endDate && <span className="text-neutral-500"> · season scheduled to end {endDate}</span>}
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={BUTTON} onClick={() => onAdvanceDays(1)}>
          +1 day
        </button>
        <button type="button" className={BUTTON} onClick={() => onAdvanceDays(7)}>
          +7 days
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={endDate === null}
          title={
            endDate === null
              ? 'This season has no known end date in the catalog'
              : 'Jump the clock just past the season end'
          }
          onClick={onSkipToEnd}
        >
          Skip past end of season
        </button>
        <button type="button" className={BUTTON} disabled={offsetDays <= 0} onClick={onReset}>
          Reset to real time
        </button>
      </div>

      <p className="mt-1.5 text-[11px] text-neutral-400">
        This is the game&apos;s own debug clock, stored in the season file. It unlocks weekly
        challenges and events early and can end the season; &quot;Reset to real time&quot; undoes it
        completely. It is separate from the Vault time card on the Vault tab - this clock only moves
        season timing and never advances production, crafting or other vault timers.
      </p>
    </VaultCard>
  );
}
