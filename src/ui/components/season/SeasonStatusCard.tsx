import { NumberField } from '../forms/NumberField.tsx';
import { VaultCard } from '../vault/VaultCard.tsx';

// Season status editors. Split into two groups because the underlying
// fields have different scopes in spd.dat:
//   • Premium / Premium+ / max rank achieved are PER-SEASON (seasonsData[viewed]).
//   • Level / tokens are the single top-level `currentLevel`/`currentTokens` - they belong to
//     the ACTIVE season only. When you're viewing a non-active season, editing level/tokens
//     still targets the active season, so the group is labelled with the active season and a
//     "make this season active" action is offered.
// Every change is one applySeasonEdit = one combined undo step (composed in seasonOps).

interface SeasonStatusCardProps {
  viewedLabel: string;
  activeLabel: string;
  isViewedActive: boolean;
  isPremium: boolean;
  isPremiumPlus: boolean;
  maxRankAchieved: number;
  rankCap: number;
  level: number;
  tokens: number;
  /** Tokens the in-game Premium Plus purchase grants (25 in shipped seasons; 0 = unknown). */
  plusTokens: number;
  /** Rank those tokens level a fresh pass to (5 in shipped seasons; 0 = unknown). */
  plusSkipRank: number;
  allowOutOfRange: boolean;
  onSetPremium: (on: boolean) => void;
  onSetPremiumPlus: (on: boolean) => void;
  onSetMaxRank: (value: number) => void;
  onSetLevel: (value: number) => void;
  onSetTokens: (value: number) => void;
  onMakeActive: () => void;
}

const TOKENS_FALLBACK_MAX = 9_999_999;

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-neutral-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={`rounded border px-3 py-1 text-xs font-medium transition-colors ${
          on
            ? 'border-emerald-600/60 bg-emerald-500/15 text-emerald-300'
            : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'
        }`}
      >
        {on ? 'Unlocked' : 'Locked'}
      </button>
    </div>
  );
}

export function SeasonStatusCard({
  viewedLabel,
  activeLabel,
  isViewedActive,
  isPremium,
  isPremiumPlus,
  maxRankAchieved,
  rankCap,
  level,
  tokens,
  plusTokens,
  plusSkipRank,
  allowOutOfRange,
  onSetPremium,
  onSetPremiumPlus,
  onSetMaxRank,
  onSetLevel,
  onSetTokens,
  onMakeActive,
}: SeasonStatusCardProps) {
  return (
    <VaultCard
      title="Status"
      description={`Premium, rank and level for ${viewedLabel}.`}
      action={
        !isViewedActive && (
          <button
            type="button"
            onClick={onMakeActive}
            title="Point the save's active season (and nvf.dat) at this season"
            className="rounded border border-amber-700 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-900/30"
          >
            Make active
          </button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <Toggle label="Premium track" on={isPremium} onChange={onSetPremium} />
        <Toggle label="Premium+ track" on={isPremiumPlus} onChange={onSetPremiumPlus} />

        {/* What each paid tier does, verified against the v2.4.1 game files (ShopWindow /
            SeasonPassTokenManager / Vault.GrantEligibleSeasonalLunchboxes). */}
        <div className="rounded border border-neutral-800 bg-neutral-950/50 px-2.5 py-2 text-[11px] leading-relaxed text-neutral-400">
          <p>
            <span className="font-medium text-neutral-300">Premium</span> unlocks the premium reward
            row on the board. In game the purchase also queues this season&apos;s goodie box; the
            game delivers it to each vault the next time it loads. Toggling it on here records that
            purchase in the save.
          </p>
          <p className="mt-1.5">
            <span className="font-medium text-neutral-300">Premium+</span> includes Premium and adds
            the bigger goodie box (bonus caps, legendary gear and pets, a unique dweller)
            {plusTokens > 0 && plusSkipRank > 1 ? (
              <>
                {' '}
                plus {plusTokens} pass tokens, instantly leveling a fresh pass to rank{' '}
                {plusSkipRank}. Toggling it on applies the token boost to the active season.
              </>
            ) : (
              '.'
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-neutral-800 pt-3">
          <NumberField
            label="Max rank achieved"
            value={maxRankAchieved}
            min={0}
            max={rankCap}
            allowOutOfRange={allowOutOfRange}
            onCommit={onSetMaxRank}
          />
          <div />
        </div>

        <div className="border-t border-neutral-800 pt-3">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">
            Active season - {activeLabel}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <NumberField
              label="Level"
              value={level}
              min={0}
              max={rankCap}
              allowOutOfRange={allowOutOfRange}
              onCommit={onSetLevel}
            />
            <NumberField
              label="Tokens"
              value={tokens}
              min={0}
              max={TOKENS_FALLBACK_MAX}
              allowOutOfRange={allowOutOfRange}
              onCommit={onSetTokens}
            />
          </div>
          {!isViewedActive && (
            <p className="mt-1.5 text-[11px] text-neutral-500">
              Level and tokens apply to the active season ({activeLabel}). Make this season active
              to edit them for {viewedLabel}.
            </p>
          )}
        </div>
      </div>
    </VaultCard>
  );
}
