import { useMemo, useState } from 'react';
import { useSaveStore } from '../../state/saveStore.ts';
import { useUIStore } from '../../state/uiStore.ts';
import { useToastStore } from '../../state/toastStore.ts';
import { useGameData } from '../hooks/useGameData.ts';
import { useSeasonCatalog } from '../hooks/useSeasonCatalog.ts';
import type { SeasonReward } from '../../domain/model/seasonSchema.ts';
import {
  areAllSeasonsMaxed,
  claimAll,
  claimUnclaimed,
  grantPassTokens,
  isEntitledClaimed,
  isSeasonFullyClaimed,
  isSeasonMaxed,
  maxAllSeasons,
  maxSeason,
  setLevel,
  setMaxRank,
  setPremium,
  setPremiumPlus,
  setTokens,
  switchSeason,
  toggleReward,
  type SeasonTrack,
} from '../../domain/ops/seasonOps.ts';
import { SeasonOnboarding } from '../components/season/SeasonOnboarding.tsx';
import { SeasonSwitcher } from '../components/season/SeasonSwitcher.tsx';
import { SeasonStatusCard } from '../components/season/SeasonStatusCard.tsx';
import { SeasonQuickActions } from '../components/season/SeasonQuickActions.tsx';
import { SeasonBoard } from '../components/season/SeasonBoard.tsx';
import { RewardDetail } from '../components/season/RewardDetail.tsx';
import { SeasonExportBar } from '../components/season/SeasonExportBar.tsx';
import { cellKey, seasonLabel } from '../components/season/seasonText.ts';

// Season Pass tab. Orchestrates the season working model + game data
// through the store's combined `applySeasonEdit` (one claim = one undo step spanning the
// `.sav` and `spd.dat`). Before a season source is chosen it shows onboarding; afterwards
// the workspace (switcher, status, quick actions, board, read-only reward detail, export).

/** A board reward the user is inspecting (read-only detail), tagged with its season. */
interface Inspected {
  season: string;
  track: SeasonTrack;
  rewardId: number;
}

function rankCapOf(rewards: SeasonReward[]): number {
  return rewards.reduce((max, r) => Math.max(max, r.levelRequired), 0);
}

export function SeasonPassView() {
  const seasonSave = useSaveStore((s) => s.seasonSave);
  const seasonSource = useSaveStore((s) => s.seasonSource);
  const applySeasonEdit = useSaveStore((s) => s.applySeasonEdit);
  const startSeasonFromCatalog = useSaveStore((s) => s.startSeasonFromCatalog);
  const loadSeasonFromText = useSaveStore((s) => s.loadSeasonFromText);
  const allowOutOfRange = useUIStore((s) => s.allowOutOfRange);
  const pushToast = useToastStore((s) => s.push);
  const { data: gameData, status: gameDataStatus } = useGameData();
  const { data: catalog, status: catalogStatus, error: catalogError } = useSeasonCatalog();

  const [viewed, setViewed] = useState<string | null>(null);
  const [inspected, setInspected] = useState<Inspected | null>(null);

  // Season ids actually present in the working model, ordered by catalog order when known.
  const seasonIds = useMemo(() => {
    const keys = Object.keys(seasonSave?.seasonsData ?? {});
    const order = catalog?.seasonIds ?? [];
    const rank = (id: string): number => {
      const i = order.indexOf(id);
      return i < 0 ? order.length + keys.indexOf(id) : i;
    };
    return [...keys].sort((a, b) => rank(a) - rank(b));
  }, [seasonSave, catalog]);

  const gameDataReady = gameDataStatus === 'ready' && gameData !== null;

  // --- Onboarding (no season source yet) ----------------------------------------
  if (seasonSource === 'none' || !seasonSave) {
    return (
      <div className="h-full overflow-auto">
        <SeasonOnboarding
          onUpload={loadSeasonFromText}
          onContinue={() => {
            if (catalog) startSeasonFromCatalog(catalog);
          }}
          canContinue={catalogStatus === 'ready' && catalog !== null}
          catalogError={catalogStatus === 'error' ? catalogError : null}
        />
      </div>
    );
  }

  const activeSeason = seasonSave.currentSeason ?? '';
  const effectiveViewed =
    viewed && seasonIds.includes(viewed)
      ? viewed
      : seasonIds.includes(activeSeason)
        ? activeSeason
        : (seasonIds[0] ?? '');
  const record = seasonSave.seasonsData?.[effectiveViewed];

  if (!record) {
    return <div className="p-8 text-sm text-neutral-400">No season data for this season.</div>;
  }

  const isViewedActive = effectiveViewed === activeSeason;
  const viewedLabel = seasonLabel(effectiveViewed);
  const activeLabel = seasonLabel(activeSeason);
  const rankCap =
    catalog?.seasonById.get(effectiveViewed)?.maxRank ||
    rankCapOf([...(record.freeRewardsList ?? []), ...(record.premiumRewardsList ?? [])]) ||
    25;

  const inspectedReward: SeasonReward | null =
    inspected && inspected.season === effectiveViewed
      ? ((inspected.track === 'premium' ? record.premiumRewardsList : record.freeRewardsList)?.find(
          (r) => r.id === inspected.rewardId,
        ) ?? null)
      : null;

  // In-game pass-purchase economics for the viewed season (verified against the v2.4.1
  // game files): Premium Plus grants `premiumPassTokens` (25), which against the season's
  // token requirements levels a fresh pass straight to `plusSkipRank` (5). The base pass
  // grants 0 tokens and its goodie box; the game delivers goodie boxes to each vault on
  // load from the purchase record the toggles now write.
  const catalogSeason = catalog?.seasonById.get(effectiveViewed);
  const plusTokens = catalogSeason?.premiumPassTokens ?? 0;
  const plusSkipRank = (() => {
    const reqs = catalogSeason?.tokenRequirements ?? [];
    if (reqs.length === 0 || plusTokens <= 0) return 0;
    let level = 1;
    let tokens = plusTokens;
    while (level < reqs.length && (reqs[level] ?? 0) > 0 && tokens >= (reqs[level] ?? 0)) {
      tokens -= reqs[level] ?? 0;
      level++;
    }
    return level;
  })();

  // --- Edit helpers (each = one combined undo step) -----------------------------
  const needGameData = (): boolean => {
    if (gameDataReady) return true;
    pushToast('Game data is still loading - try again in a moment.', 'info');
    return false;
  };

  const onToggle = (track: SeasonTrack, rewardId: number): void => {
    setInspected({ season: effectiveViewed, track, rewardId });
    if (!needGameData() || !gameData) return;
    applySeasonEdit(
      (ws) => toggleReward(ws, gameData, effectiveViewed, track, rewardId),
      `Toggle reward - ${viewedLabel}`,
    );
  };

  const onClaimUnclaimed = (): void => {
    if (!needGameData() || !gameData) return;
    applySeasonEdit(
      (ws) => claimUnclaimed(ws, gameData, effectiveViewed),
      `Claim unclaimed - ${viewedLabel}`,
    );
    pushToast(`Claimed unclaimed rewards - ${viewedLabel}`);
  };

  const onClaimAll = (): void => {
    if (!needGameData() || !gameData) return;
    applySeasonEdit((ws) => claimAll(ws, gameData, effectiveViewed), `Claim all - ${viewedLabel}`);
    pushToast(`Claimed all rewards - ${viewedLabel}`);
  };

  const onMaxSeason = (): void => {
    if (!needGameData() || !gameData) return;
    applySeasonEdit(
      (ws) => maxSeason(ws, gameData, effectiveViewed),
      `Max season - ${viewedLabel}`,
    );
    pushToast(`Maxed ${viewedLabel}`);
  };

  const onMaxAllSeasons = (): void => {
    if (!needGameData() || !gameData) return;
    applySeasonEdit((ws) => maxAllSeasons(ws, gameData), 'Max all seasons');
    pushToast('Maxed all seasons');
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl p-6">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold">Season Pass</h2>
          {gameDataStatus === 'loading' && (
            <span className="text-xs text-neutral-400">loading game data…</span>
          )}
          {gameDataStatus === 'error' && (
            <span className="text-xs text-amber-500">
              game data unavailable - claiming items is disabled
            </span>
          )}
        </div>

        <div className="mt-4">
          <SeasonExportBar />
        </div>

        <div className="mt-4">
          <SeasonSwitcher
            seasonIds={seasonIds}
            viewed={effectiveViewed}
            active={activeSeason}
            onSelect={(id) => {
              setViewed(id);
              setInspected(null);
            }}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SeasonStatusCard
            viewedLabel={viewedLabel}
            activeLabel={activeLabel}
            isViewedActive={isViewedActive}
            isPremium={record.isPremium === true}
            isPremiumPlus={record.isPremiumPlus === true}
            maxRankAchieved={record.maxRankAchieved ?? 0}
            rankCap={rankCap}
            level={seasonSave.currentLevel ?? 0}
            tokens={seasonSave.currentTokens ?? 0}
            plusTokens={plusTokens}
            plusSkipRank={plusSkipRank}
            allowOutOfRange={allowOutOfRange}
            onSetPremium={(on) =>
              applySeasonEdit(
                (ws) => setPremium(ws, effectiveViewed, on),
                `Premium ${on ? 'unlocked' : 'locked'} - ${viewedLabel}`,
              )
            }
            onSetPremiumPlus={(on) => {
              // Replicate the real Premium Plus purchase (v2.4.1): flags + purchase
              // record (setPremiumPlus), plus the token grant that levels the ACTIVE
              // season's pass to rank 5. Skipped when it was already unlocked.
              const wasPlus = record.isPremiumPlus === true;
              applySeasonEdit(
                (ws) => {
                  let next = setPremiumPlus(ws, effectiveViewed, on);
                  if (on && !wasPlus && plusTokens > 0) {
                    next = grantPassTokens(
                      next,
                      effectiveViewed,
                      plusTokens,
                      catalogSeason?.tokenRequirements ?? [],
                    );
                  }
                  return next;
                },
                `Premium+ ${on ? 'unlocked' : 'locked'} - ${viewedLabel}`,
              );
              if (on && !wasPlus && plusTokens > 0 && isViewedActive) {
                pushToast(
                  `Premium+ purchase applied: +${plusTokens} tokens (levels the pass to rank ${plusSkipRank}).`,
                );
              }
            }}
            onSetMaxRank={(v) =>
              applySeasonEdit(
                (ws) => setMaxRank(ws, effectiveViewed, v),
                `Set max rank - ${viewedLabel}`,
              )
            }
            onSetLevel={(v) =>
              applySeasonEdit((ws) => setLevel(ws, v), `Set level - ${activeLabel}`)
            }
            onSetTokens={(v) =>
              applySeasonEdit((ws) => setTokens(ws, v), `Set tokens - ${activeLabel}`)
            }
            onMakeActive={() =>
              applySeasonEdit(
                (ws) => switchSeason(ws, effectiveViewed),
                `Active season → ${viewedLabel}`,
              )
            }
          />

          <SeasonQuickActions
            viewedLabel={viewedLabel}
            ready={gameDataReady}
            claimUnclaimedSpent={isEntitledClaimed(seasonSave, effectiveViewed)}
            claimAllSpent={isSeasonFullyClaimed(seasonSave, effectiveViewed)}
            maxSeasonSpent={isSeasonMaxed(seasonSave, effectiveViewed)}
            maxAllSeasonsSpent={areAllSeasonsMaxed(seasonSave)}
            onClaimUnclaimed={onClaimUnclaimed}
            onClaimAll={onClaimAll}
            onMaxSeason={onMaxSeason}
            onMaxAllSeasons={onMaxAllSeasons}
          />
        </div>

        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-neutral-300">Rewards - {viewedLabel}</h3>
          <SeasonBoard
            record={record}
            rankCap={rankCap}
            currentRank={isViewedActive ? (seasonSave.currentLevel ?? null) : null}
            gameData={gameData}
            inspectedKey={
              inspectedReward && inspected ? cellKey(inspected.track, inspectedReward.id) : null
            }
            onInspect={(track, rewardId) =>
              setInspected({ season: effectiveViewed, track, rewardId })
            }
            onToggle={onToggle}
            onLockedPremium={() =>
              pushToast('Unlock the premium track to claim premium rewards.', 'info')
            }
          />
        </div>

        <div className="mt-4">
          <RewardDetail
            reward={inspectedReward}
            track={inspectedReward ? (inspected?.track ?? null) : null}
            gameData={gameData}
            premiumLocked={record.isPremium !== true}
            onToggle={() => {
              if (inspectedReward && inspected) onToggle(inspected.track, inspected.rewardId);
            }}
          />
        </div>
      </div>
    </div>
  );
}
