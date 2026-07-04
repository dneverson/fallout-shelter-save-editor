import { VaultCard } from '../vault/VaultCard.tsx';

// One-click power actions. Each is a single combined undo step
// (the batch ops in seasonOps already fold their many sub-edits into one workspace
// transition) and raises a toast - composed in the view. Disabled until game data is ready,
// because granting a claimed reward into the `.sav` needs the item catalogs to resolve.

interface SeasonQuickActionsProps {
  viewedLabel: string;
  /** False until game data is ready (claims grant into the `.sav` and need item resolution). */
  ready: boolean;
  /** Each true when the action would change nothing - the button is already "spent". */
  claimUnclaimedSpent: boolean;
  claimAllSpent: boolean;
  maxSeasonSpent: boolean;
  maxAllSeasonsSpent: boolean;
  onClaimUnclaimed: () => void;
  onClaimAll: () => void;
  onMaxSeason: () => void;
  onMaxAllSeasons: () => void;
}

const ACTION =
  'rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent';
const ACTION_PRIMARY =
  'rounded border border-amber-700 px-3 py-1.5 text-sm text-amber-300 transition-colors hover:bg-amber-900/30 disabled:opacity-40 disabled:hover:bg-transparent';

export function SeasonQuickActions({
  viewedLabel,
  ready,
  claimUnclaimedSpent,
  claimAllSpent,
  maxSeasonSpent,
  maxAllSeasonsSpent,
  onClaimUnclaimed,
  onClaimAll,
  onMaxSeason,
  onMaxAllSeasons,
}: SeasonQuickActionsProps) {
  return (
    <VaultCard
      title="Quick actions"
      description={ready ? `Batch claims for ${viewedLabel}.` : 'Loading game data…'}
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={ACTION}
          disabled={!ready || claimUnclaimedSpent}
          title={ready && claimUnclaimedSpent ? 'Nothing left to claim.' : undefined}
          onClick={onClaimUnclaimed}
        >
          Claim unclaimed
        </button>
        <button
          type="button"
          className={ACTION}
          disabled={!ready || claimAllSpent}
          title={ready && claimAllSpent ? 'Everything is already claimed.' : undefined}
          onClick={onClaimAll}
        >
          Claim all
        </button>
        <button
          type="button"
          className={ACTION_PRIMARY}
          disabled={!ready || maxSeasonSpent}
          title={ready && maxSeasonSpent ? 'This season is already maxed.' : undefined}
          onClick={onMaxSeason}
        >
          Max this season
        </button>
        <button
          type="button"
          className={ACTION_PRIMARY}
          disabled={!ready || maxAllSeasonsSpent}
          title={ready && maxAllSeasonsSpent ? 'All seasons are already maxed.' : undefined}
          onClick={onMaxAllSeasons}
        >
          Max all seasons
        </button>
      </div>
    </VaultCard>
  );
}
