import { VaultCard } from './VaultCard.tsx';
import { Toggle } from '../forms/Toggle.tsx';
import { InfoTooltip } from '../InfoTooltip.tsx';
import { fieldHelp } from '../../lib/fieldHelp.ts';
import { formatDuration } from '../../../domain/tasks/taskLookup.ts';
import type { DeathclawState } from '../../../domain/ops/timerOps.ts';

// Disaster toggles: deathclaw attacks + Bottle & Cappy visits. Presentational -
// state and callbacks come from VaultView (deathclawState / setDeathclawEnabled /
// isBottleAndCappyEnabled / setBottleAndCappyEnabled in timerOps).

function deathclawStatusLine(state: DeathclawState, remainingSeconds: number | null): string {
  switch (state) {
    case 'enabled':
      return 'Attacks can occur';
    case 'cooldown':
      return remainingSeconds !== null
        ? `Natural cooldown, ${formatDuration(remainingSeconds)} left`
        : 'Natural cooldown';
    case 'disabled':
      return 'Blocked by this editor';
  }
}

export function DisastersCard({
  deathclaw,
  deathclawRemaining,
  canToggleDeathclaw,
  onSetDeathclaw,
  bottleAndCappy,
  onSetBottleAndCappy,
}: {
  deathclaw: DeathclawState;
  deathclawRemaining: number | null;
  /** False when the save has no task list to write the blocker into (rare/corrupt). */
  canToggleDeathclaw: boolean;
  onSetDeathclaw: (enabled: boolean) => void;
  bottleAndCappy: boolean;
  onSetBottleAndCappy: (enabled: boolean) => void;
}) {
  return (
    <VaultCard
      title="Disasters"
      description="Toggle deathclaw attacks and Bottle & Cappy visits."
      help="Both switches are written safely into the save and are fully reversible here."
    >
      <div className="flex flex-col gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <div className="grow">
              <Toggle
                label="Deathclaw attacks"
                on={deathclaw === 'enabled' || deathclaw === 'cooldown'}
                onChange={onSetDeathclaw}
                disabled={!canToggleDeathclaw}
              />
            </div>
            <InfoTooltip text={fieldHelp.deathclawToggle} />
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">
            {deathclawStatusLine(deathclaw, deathclawRemaining)}
            {deathclaw !== 'disabled' &&
              ' - Off writes a blocker into the save’s timer list; toggling back On removes it cleanly.'}
          </p>
        </div>

        <div className="border-t border-neutral-800 pt-3">
          <div className="flex items-center gap-1.5">
            <div className="grow">
              <Toggle
                label="Bottle & Cappy visits"
                on={bottleAndCappy}
                onChange={onSetBottleAndCappy}
              />
            </div>
            <InfoTooltip text={fieldHelp.bottleAndCappy} />
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">
            {bottleAndCappy
              ? 'Visits allowed - they still require their unlock quest and appear on their own schedule.'
              : 'Visits prevented - the pair never enters the vault until re-enabled.'}
          </p>
        </div>
      </div>
    </VaultCard>
  );
}
