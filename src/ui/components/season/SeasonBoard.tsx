import type { SeasonRecord, SeasonReward } from '../../../domain/model/seasonSchema.ts';
import type { GameData } from '../../../domain/gamedata/gameData.ts';
import { isRewardClaimed, type SeasonTrack } from '../../../domain/ops/seasonOps.ts';
import { ItemIcon } from '../ItemIcon.tsx';
import { cellKey, rewardIcon, rewardTitle, rewardTypeLabel } from './seasonText.ts';

// The reward board: a condensed horizontal timeline, PREMIUM track on
// top and FREE on the bottom, one column per rank (1..cap). Per the locked design, clicking a
// cell toggles its claim; hovering/focusing a cell inspects it in the read-only detail panel
// below (so inspection never grants/removes anything). Premium cells are dimmed and not
// claim-toggleable until the premium track is unlocked.

export interface SeasonBoardProps {
  record: SeasonRecord;
  rankCap: number;
  /** Highlighted "current rank" column, or null when the viewed season isn't the active one. */
  currentRank: number | null;
  /** Vault-slot claim index the board reads claim state for (Vault1 → 0 … Vault4 → 3). */
  claimIndex: number;
  gameData: GameData | null;
  /** `${track}:${rewardId}` of the cell shown in the detail panel, for highlight. */
  inspectedKey: string | null;
  onInspect: (track: SeasonTrack, rewardId: number) => void;
  onToggle: (track: SeasonTrack, rewardId: number) => void;
  /** Clicked a premium cell while the premium track is locked. */
  onLockedPremium: () => void;
}

/** level → reward for a track (levels are unique within a track in the shipped seasons). */
function byLevel(list: SeasonReward[] | undefined): Map<number, SeasonReward> {
  const map = new Map<number, SeasonReward>();
  for (const r of list ?? []) map.set(r.levelRequired, r);
  return map;
}

const LABEL_COL = 'w-16 shrink-0 text-xs';
const CELL = 'h-12 w-12 shrink-0';

function RewardCellButton({
  reward,
  track,
  claimIndex,
  gameData,
  locked,
  inspected,
  onInspect,
  onToggle,
  onLockedPremium,
}: {
  reward: SeasonReward;
  track: SeasonTrack;
  claimIndex: number;
  gameData: GameData | null;
  locked: boolean;
  inspected: boolean;
  onInspect: () => void;
  onToggle: () => void;
  onLockedPremium: () => void;
}) {
  const claimed = isRewardClaimed(reward, claimIndex);
  const icon = rewardIcon(reward);
  const title = rewardTitle(reward, gameData);

  const stateClass = claimed
    ? 'border-emerald-600/60 bg-emerald-500/15'
    : locked
      ? 'border-neutral-800 bg-neutral-900/40 opacity-50'
      : 'border-neutral-700 bg-neutral-950/60 hover:border-amber-500/60';

  return (
    <button
      type="button"
      onClick={locked ? onLockedPremium : onToggle}
      onMouseEnter={onInspect}
      onFocus={onInspect}
      aria-label={`Rank ${reward.levelRequired} ${track} - ${title}${
        claimed ? ', claimed' : locked ? ', locked' : ''
      }`}
      title={`Rank ${reward.levelRequired} · ${rewardTypeLabel(reward.rewardType)} · ${title}`}
      className={`relative flex items-center justify-center rounded border ${CELL} ${stateClass} ${
        inspected ? 'ring-2 ring-amber-400' : ''
      }`}
    >
      {icon ? (
        <ItemIcon
          type={icon.type}
          id={icon.id}
          {...(icon.fallback ? { fallback: icon.fallback } : {})}
          size={38}
        />
      ) : (
        <span className="px-0.5 text-center text-[9px] leading-tight text-neutral-300">
          {rewardTypeLabel(reward.rewardType)}
        </span>
      )}
      {reward.isPrestige && (
        <span
          className="absolute left-0.5 top-0.5 text-[9px] leading-none text-amber-300"
          aria-hidden="true"
        >
          ★
        </span>
      )}
      {claimed && (
        <span
          className="absolute bottom-0.5 right-0.5 text-[10px] leading-none text-emerald-300"
          aria-hidden="true"
        >
          ✓
        </span>
      )}
    </button>
  );
}

function EmptyCell() {
  return <div className={`rounded border border-dashed border-neutral-800/70 ${CELL}`} />;
}

function TrackRow({
  label,
  track,
  rewards,
  ranks,
  premiumLocked,
  claimIndex,
  gameData,
  inspectedKey,
  onInspect,
  onToggle,
  onLockedPremium,
}: {
  label: string;
  track: SeasonTrack;
  rewards: Map<number, SeasonReward>;
  ranks: number[];
  premiumLocked: boolean;
  claimIndex: number;
  gameData: GameData | null;
  inspectedKey: string | null;
  onInspect: (track: SeasonTrack, rewardId: number) => void;
  onToggle: (track: SeasonTrack, rewardId: number) => void;
  onLockedPremium: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <div className={`${LABEL_COL} font-medium text-neutral-300`}>{label}</div>
      {ranks.map((rank) => {
        const reward = rewards.get(rank);
        if (!reward) return <EmptyCell key={rank} />;
        return (
          <RewardCellButton
            key={rank}
            reward={reward}
            track={track}
            claimIndex={claimIndex}
            gameData={gameData}
            locked={track === 'premium' && premiumLocked}
            inspected={inspectedKey === cellKey(track, reward.id)}
            onInspect={() => onInspect(track, reward.id)}
            onToggle={() => onToggle(track, reward.id)}
            onLockedPremium={onLockedPremium}
          />
        );
      })}
    </div>
  );
}

export function SeasonBoard({
  record,
  rankCap,
  currentRank,
  claimIndex,
  gameData,
  inspectedKey,
  onInspect,
  onToggle,
  onLockedPremium,
}: SeasonBoardProps) {
  const ranks = Array.from({ length: rankCap }, (_, i) => i + 1);
  const premium = byLevel(record.premiumRewardsList);
  const free = byLevel(record.freeRewardsList);
  const premiumLocked = record.isPremium !== true;

  return (
    <div className="overflow-x-auto pb-2">
      <div className="inline-flex min-w-full flex-col gap-1">
        {/* Rank header */}
        <div className="flex items-center gap-1">
          <div className={LABEL_COL} />
          {ranks.map((rank) => (
            <div
              key={rank}
              className={`${CELL.replace('h-12', 'h-6')} flex items-center justify-center text-[11px] tabular-nums ${
                rank === currentRank ? 'font-semibold text-amber-300' : 'text-neutral-500'
              }`}
            >
              {rank}
            </div>
          ))}
        </div>

        <TrackRow
          label="Premium"
          track="premium"
          rewards={premium}
          ranks={ranks}
          premiumLocked={premiumLocked}
          claimIndex={claimIndex}
          gameData={gameData}
          inspectedKey={inspectedKey}
          onInspect={onInspect}
          onToggle={onToggle}
          onLockedPremium={onLockedPremium}
        />
        <TrackRow
          label="Free"
          track="free"
          rewards={free}
          ranks={ranks}
          premiumLocked={premiumLocked}
          claimIndex={claimIndex}
          gameData={gameData}
          inspectedKey={inspectedKey}
          onInspect={onInspect}
          onToggle={onToggle}
          onLockedPremium={onLockedPremium}
        />
      </div>
    </div>
  );
}
