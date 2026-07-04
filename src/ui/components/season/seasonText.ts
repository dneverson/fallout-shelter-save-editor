import type { SeasonReward } from '../../../domain/model/seasonSchema.ts';
import type { GameData } from '../../../domain/gamedata/gameData.ts';
import type { ItemIconType } from '../../../domain/gamedata/visualSchemas.ts';
import type { SeasonTrack } from '../../../domain/ops/seasonOps.ts';

/** Stable key for a board cell (`${track}:${rewardId}`) - for inspected-cell highlight. */
export function cellKey(track: SeasonTrack, rewardId: number): string {
  return `${track}:${rewardId}`;
}

// Presentation helpers shared by the Season board, reward detail, and switcher. Pure string/
// shape mapping - no React. Reward names resolve through game data when available and fall
// back to the raw `dataValString` so the UI never shows a blank (mirrors the roster's
// graceful degradation when game data is absent).

/** "NewVegasA" → "New Vegas A", "UltraciteFever" → "Ultracite Fever". */
export function seasonLabel(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Za-z])([0-9])/g, '$1 $2');
}

const LUNCHBOX_LABELS: Record<string, string> = {
  regular: 'Lunchbox',
  mrhandy: 'Mr. Handy Lunchbox',
  petcarrier: 'Pet Carrier',
};

/** Friendly label for a reward type (the inert "[Type]" placeholder → "–"). */
export function rewardTypeLabel(rewardType: string): string {
  switch (rewardType) {
    case 'caps':
      return 'Caps';
    case 'stimpack':
      return 'Stimpaks';
    case 'lunchbox':
      return 'Lunchbox';
    case 'weapon':
      return 'Weapon';
    case 'outfit':
      return 'Outfit';
    case 'pet':
      return 'Pet';
    case 'dweller':
      return 'Dweller';
    case 'theme':
      return 'Theme';
    default:
      return '–';
  }
}

/** An atlas-icon descriptor; `fallback` is tried when the primary sprite is missing. */
export interface RewardIconRef {
  type: ItemIconType;
  id: string;
  fallback?: { type: ItemIconType; id: string };
}

/**
 * The atlas-icon descriptor for a reward, or null when it has no icon. Weapons/outfits/
 * pets use the item atlases (consistent with the rest of the app); everything else uses
 * the season-pass card art (`icons.season`, keyed by the reward's own `icon` sprite
 * name). Themes prefer their dedicated per-theme art (`theme:<id>`), falling back to the
 * generic BP_Theme card the game data names.
 */
export function rewardIcon(reward: SeasonReward): RewardIconRef | null {
  const seasonFallback = reward.icon
    ? { fallback: { type: 'season' as const, id: reward.icon } }
    : {};
  switch (reward.rewardType) {
    case 'weapon':
      return { type: 'weapons', id: reward.dataValString, ...seasonFallback };
    case 'outfit':
      return { type: 'outfits', id: reward.dataValString, ...seasonFallback };
    case 'pet':
      return { type: 'pets', id: reward.dataValString, ...seasonFallback };
    case 'theme':
      return { type: 'season', id: `theme:${reward.dataValString}`, ...seasonFallback };
    default:
      return reward.icon ? { type: 'season', id: reward.icon } : null;
  }
}

/** A human title for a reward (resolves item names through game data when present). */
export function rewardTitle(reward: SeasonReward, gameData: GameData | null): string {
  const qty = Math.trunc(reward.dataValInt);
  switch (reward.rewardType) {
    case 'caps':
      return `${qty.toLocaleString()} Caps`;
    case 'stimpack':
      return `${qty.toLocaleString()} Stimpak${qty === 1 ? '' : 's'}`;
    case 'lunchbox': {
      const name = LUNCHBOX_LABELS[reward.dataValString] ?? 'Lunchbox';
      return qty > 1 ? `${qty}× ${name}` : name;
    }
    case 'weapon':
      return gameData?.weaponById.get(reward.dataValString)?.name ?? reward.dataValString;
    case 'outfit':
      return gameData?.outfitById.get(reward.dataValString)?.name ?? reward.dataValString;
    case 'pet':
      return gameData?.petById.get(reward.dataValString)?.name ?? reward.dataValString;
    case 'dweller':
    case 'theme':
      return reward.dataValString || rewardTypeLabel(reward.rewardType);
    default:
      return reward.dataValString || '–';
  }
}
