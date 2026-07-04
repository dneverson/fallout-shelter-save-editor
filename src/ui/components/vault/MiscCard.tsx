import { VaultCard } from './VaultCard.tsx';
import { NumberField } from '../forms/NumberField.tsx';
import { fieldHelp } from '../../lib/fieldHelp.ts';

// Misc card: Mysterious Stranger show/hide + appearance timers. (Casino
// is a normal room, added via the Rooms Map's generic build-room flow; no button here.)

/** "185" → "3m 5s"; sub-minute values stay plain seconds ("45s"). */
function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function MiscCard({
  strangerShown,
  onToggleStranger,
  timeToAppear,
  remainingTime,
  onSetTimers,
}: {
  strangerShown: boolean;
  onToggleStranger: (show: boolean) => void;
  /** Seconds between appearances (MysteriousStranger.timeToAppear). */
  timeToAppear: number;
  /** Live countdown to the next appearance (remainingTimeToAppear). */
  remainingTime: number;
  onSetTimers: (timers: { timeToAppear?: number; remainingTimeToAppear?: number }) => void;
}) {
  return (
    <VaultCard title="Misc" help={fieldHelp.mysteriousStranger} description="Mysterious Stranger.">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-neutral-300">
          Mysterious Stranger
          <span className="ml-2 text-xs text-neutral-400">
            {strangerShown ? 'appearing' : 'hidden'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onToggleStranger(!strangerShown)}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
        >
          {strangerShown ? 'Hide' : 'Show'}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <NumberField
            label="Interval (seconds)"
            value={Math.round(timeToAppear)}
            min={0}
            max={100000}
            onCommit={(v) => onSetTimers({ timeToAppear: v })}
            className="w-32"
          />
          <span className="mt-0.5 text-[11px] text-neutral-500">
            = {formatDuration(timeToAppear)}
          </span>
        </div>
        <div className="flex flex-col">
          <NumberField
            label="Next in (seconds)"
            value={Math.round(remainingTime)}
            min={0}
            max={100000}
            onCommit={(v) => onSetTimers({ remainingTimeToAppear: v })}
            className="w-32"
          />
          <span className="mt-0.5 text-[11px] text-neutral-500">
            = {formatDuration(remainingTime)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onSetTimers({ remainingTimeToAppear: 1 })}
          title="Set the countdown to 1 second so the Stranger shows up right after loading"
          className="mb-4 rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
        >
          Appear now
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-neutral-400">
        Both timers are stored in the save in seconds. "Next in" is the live countdown to his next
        visit; it keeps ticking while you play, so a value near 0 makes him show up almost
        immediately after loading. "Interval" is the pause the game waits between visits; the edit
        is saved, but the game recalculates this value on its own over time, so treat it as a nudge
        rather than a permanent rate change. Find and tap him for a caps reward.
      </p>
    </VaultCard>
  );
}
