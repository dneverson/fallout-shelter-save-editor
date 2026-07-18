import type { SeasonReward } from '../../../domain/model/seasonSchema.ts';
import type { GameData } from '../../../domain/gamedata/gameData.ts';
import { isRewardClaimed, type SeasonTrack } from '../../../domain/ops/seasonOps.ts';
import { ItemIcon } from '../ItemIcon.tsx';
import { rewardIcon, rewardTitle, rewardTypeLabel } from './seasonText.ts';

// Read-only per-reward detail panel. Shows the
// inspected board cell's full reward data; the only mutation is the explicit Claim / Unclaim
// button (the same one-undo-step claim the cell click performs). Identity fields
// (id/type/item) are shown but never edited - they're authored by the game and must round-trip
// verbatim.

interface RewardDetailProps {
  reward: SeasonReward | null;
  track: SeasonTrack | null;
  /** Vault-slot claim index the panel reads claim state for (Vault1 → 0 … Vault4 → 3). */
  claimIndex: number;
  gameData: GameData | null;
  /** Premium track is locked - premium rewards can't be claimed until it's unlocked. */
  premiumLocked: boolean;
  onToggle: () => void;
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="text-sm text-neutral-200">{value}</dd>
    </div>
  );
}

const QUANTITY_TYPES = new Set(['caps', 'stimpack', 'lunchbox']);

export function RewardDetail({
  reward,
  track,
  claimIndex,
  gameData,
  premiumLocked,
  onToggle,
}: RewardDetailProps) {
  // Both variants share a min height so hovering board cells never resizes the
  // card. A hover-driven height change shifts the page under the cursor, which
  // flips the hovered cell and flickers the panel in an endless loop.
  if (!reward || !track) {
    return (
      <div className="flex min-h-44 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-500">
        Hover or focus a reward on the board to see its details.
      </div>
    );
  }

  const claimed = isRewardClaimed(reward, claimIndex);
  const icon = rewardIcon(reward);
  const claimBlocked = track === 'premium' && premiumLocked && !claimed;

  return (
    <div className="min-h-44 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-start gap-3">
        {icon ? (
          <ItemIcon
            type={icon.type}
            id={icon.id}
            {...(icon.fallback ? { fallback: icon.fallback } : {})}
            size={40}
            className="mt-0.5"
          />
        ) : (
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded bg-neutral-800 text-[10px] text-neutral-300">
            {rewardTypeLabel(reward.rewardType)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-neutral-100">
              {rewardTitle(reward, gameData)}
            </h3>
            {reward.isPrestige && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                prestige
              </span>
            )}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                claimed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-neutral-800 text-neutral-400'
              }`}
            >
              {claimed ? 'claimed' : 'unclaimed'}
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            <Field label="Track" value={track === 'premium' ? 'Premium' : 'Free'} />
            <Field label="Type" value={rewardTypeLabel(reward.rewardType)} />
            <Field label="Rank" value={reward.levelRequired} />
            {QUANTITY_TYPES.has(reward.rewardType) && (
              <Field label="Quantity" value={Math.trunc(reward.dataValInt).toLocaleString()} />
            )}
            {reward.dataValString && <Field label="Item code" value={reward.dataValString} />}
            <Field label="Reward id" value={reward.id} />
          </dl>
        </div>

        <button
          type="button"
          onClick={onToggle}
          disabled={claimBlocked}
          title={claimBlocked ? 'Unlock the premium track to claim this reward' : undefined}
          className={`shrink-0 rounded px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
            claimed
              ? 'border border-neutral-700 text-neutral-200 hover:bg-neutral-800'
              : 'bg-amber-500 text-neutral-900 hover:bg-amber-400'
          }`}
        >
          {claimed ? 'Unclaim' : 'Claim'}
        </button>
      </div>

      {/* Constant-height footnote: the slot is always rendered and only the text
          swaps, so premium-locked and free cells produce identical card heights. */}
      <p className="mt-2 min-h-8 text-xs text-neutral-500">
        {claimBlocked
          ? 'Premium rewards require the premium track unlocked (Status → Premium, or Claim all).'
          : 'Claim / Unclaim edits the claimed list; the game hands out rewards the next time the save loads.'}
      </p>
    </div>
  );
}
