import type { SaveData, Item } from '../model/saveSchema.ts';
import type { NvfData, SeasonReward, SeasonSave } from '../model/seasonSchema.ts';
import type { CatalogReward, Pet, UniqueDwellers } from '../gamedata/schemas.ts';
import type { SeasonCatalog } from '../gamedata/seasonCatalog.ts';
import { petSpecialName } from '../gamedata/gameData.ts';
import { grantItems, removeStoredItemAt, addPet, type StackableType } from './storageOps.ts';
import {
  resources,
  setResource,
  consumableCounts,
  setConsumableCount,
  CONSUMABLE_CODES,
} from './vaultOps.ts';
import { addSpecialDweller, remove as removeDweller, hasDweller } from './dwellerOps.ts';
import { addRecipes, removeRecipes, recipeKnown } from './recipeOps.ts';

// Pure, immutable SEASON-PASS edit operations. Like the other ops modules these are `(workspace, …args) =>
// SeasonWorkspace` with no mutation - structural sharing keeps untouched subtrees
// (and every `LosslessInt` tick) by reference, so the store records one season edit
// as one cheap combined undo snapshot. A no-op returns the SAME workspace reference.
//
// The headline mechanic is CLAIM: claiming a reward BOTH grants the item into
// the `.sav` working model (delegating to the existing storage/dweller/recipe/vault ops)
// AND sets the `spd.dat` claim flag, within one workspace transition. UNCLAIM reverses
// the exact instance the claim added - using a per-claim REVERSAL HANDLE captured at
// claim time and kept in the editor-only `handles` map (never written to any file).
//
// Claim and level are ORTHOGONAL: claiming never auto-levels; level is
// an explicit setter, and the "Max" actions set it deliberately.
//
// This module needs game data (weapon/outfit/pet/dweller/recipe resolution) for grants;
// it is passed in by the caller (the UI's gameData), mirroring how the other ops take
// already-resolved values rather than fetching. Pure: no React/DOM.

/** Single-vault claim index - a reward is "claimed" when its `claimedList` holds this. */
const VAULT_INDEX = 0;

/** Caps live under `vault.storage.resources.Nuka`, NOT a `Caps` key. */
const CAPS_KEY = 'Nuka';
/** Stimpacks are a vault resource keyed `StimPack`. */
const STIMPACK_KEY = 'StimPack';

/** `lunchbox` reward sub-type (`dataValString`) → consumable code. */
const LUNCHBOX_SUBTYPE_CODES: Record<string, number> = {
  regular: CONSUMABLE_CODES.Lunchbox,
  mrhandy: CONSUMABLE_CODES.MrHandy,
  petcarrier: CONSUMABLE_CODES.PetCarrier,
};

/** Which reward track a reward lives in. */
export type SeasonTrack = 'free' | 'premium';

const REWARD_LIST_KEY = {
  free: 'freeRewardsList',
  premium: 'premiumRewardsList',
} as const;

type RewardListKey = (typeof REWARD_LIST_KEY)[keyof typeof REWARD_LIST_KEY];

/**
 * The reversal info captured when a claim grants into the `.sav`, so an unclaim removes
 * the EXACT instance the claim added - never an item the user already owned.
 * Editor-only: lives in the workspace `handles` map, never serialized to any file.
 */
export type ReversalHandle =
  | { kind: 'resource'; key: string; amount: number }
  | { kind: 'consumable'; code: number; amount: number }
  | { kind: 'item'; itemType: StackableType; id: string }
  | { kind: 'pet'; index: number; id: string }
  | { kind: 'dweller'; serializeId: number }
  | { kind: 'recipe'; id: string; added: boolean }
  | { kind: 'none' };

/** Reward key → the reversal handle for the claim the editor made this session. */
export type ReversalHandles = Record<string, ReversalHandle>;

/**
 * The slice of game data the reward resolver needs to grant items (interface-segregated
 * from the full `GameData`, which satisfies it). `weaponById`/`outfitById` are only probed
 * for id existence; `petById`/`uniqueDwellers` supply the full entry the grant ops consume.
 */
export interface RewardResolverData {
  weaponById: ReadonlyMap<string, unknown>;
  outfitById: ReadonlyMap<string, unknown>;
  petById: ReadonlyMap<string, Pet>;
  uniqueDwellers: UniqueDwellers;
}

/**
 * The editor's combined season working state. `save` and `spd`/`nvf` move together so a
 * claim is one atomic transition (and one undo entry in the store). `handles` is the
 * editor-only reversal table - it is never part of an exported file.
 */
export interface SeasonWorkspace {
  /** The `.sav` working model (rewards are granted into this). */
  save: SaveData;
  /** The `spd.dat` working model (claim/level/premium state). */
  spd: SeasonSave;
  /** The `nvf.dat` working model (current-season pointer; kept in sync with `spd`). */
  nvf: NvfData;
  /** Per-claim reversal handles, keyed by {@link rewardKey}. Editor-only - never exported. */
  handles: ReversalHandles;
}

/** Stable key for a reward's reversal handle. */
function rewardKey(seasonId: string, track: SeasonTrack, rewardId: number): string {
  return `${seasonId}#${track}#${rewardId}`;
}

// --- inventory helpers (read-only) ----------------------------------------------

function inventoryItems(save: SaveData): Item[] {
  const items = save.vault?.inventory?.items;
  return Array.isArray(items) ? items : [];
}

// --- structural-sharing writers for spd ------------------------------------------

function withRecord(
  spd: SeasonSave,
  seasonId: string,
  record: NonNullable<SeasonSave['seasonsData']>[string],
): SeasonSave {
  return { ...spd, seasonsData: { ...spd.seasonsData, [seasonId]: record } };
}

function withReward(
  spd: SeasonSave,
  seasonId: string,
  listKey: RewardListKey,
  index: number,
  reward: SeasonReward,
): SeasonSave {
  const record = spd.seasonsData?.[seasonId];
  if (!record) return spd;
  const list = (record[listKey] ?? []).slice();
  list[index] = reward;
  return withRecord(spd, seasonId, { ...record, [listKey]: list });
}

// --- reward → grant resolution ----------------------------------

interface GrantResult {
  save: SaveData;
  handle: ReversalHandle;
}

/** Resolve a unique/special dweller catalog entry from a reward's full display name. */
function resolveDweller(
  data: RewardResolverData,
  displayName: string,
): { key: string; entry: UniqueDwellers[string] } | null {
  const target = displayName.trim();
  // Prefer an exact "name + lastName" match; fall back to the whole name living in `name`
  // alone (entries like "Ghoul King", "Scribe Valdez", "76 Overseer").
  for (const [key, entry] of Object.entries(data.uniqueDwellers)) {
    if (`${entry.name} ${entry.lastName}`.trim() === target) return { key, entry };
  }
  for (const [key, entry] of Object.entries(data.uniqueDwellers)) {
    if (entry.name.trim() === target) return { key, entry };
  }
  return null;
}

/**
 * Apply a reward's grant to the `.sav` working model and return the new save plus the
 * reversal handle for an exact unclaim. Quantities follow the file verbatim
 * (`cur + dataValInt`) - a zero-quantity reward (e.g. some `lunchbox:mrhandy`) grants
 * nothing but still claims, exactly as the data dictates. Unresolved/inert rewards
 * (the `"[Type]"` placeholder, or an item id absent from game data) grant nothing and
 * carry a `'none'` handle so the claim is a pure flag flip.
 */
function grantReward(save: SaveData, reward: SeasonReward, data: RewardResolverData): GrantResult {
  const amount = Math.trunc(reward.dataValInt);
  switch (reward.rewardType) {
    case 'caps': {
      const cur = resources(save)[CAPS_KEY] ?? 0;
      return {
        save: setResource(save, CAPS_KEY, cur + amount),
        handle: { kind: 'resource', key: CAPS_KEY, amount },
      };
    }
    case 'stimpack': {
      const cur = resources(save)[STIMPACK_KEY] ?? 0;
      return {
        save: setResource(save, STIMPACK_KEY, cur + amount),
        handle: { kind: 'resource', key: STIMPACK_KEY, amount },
      };
    }
    case 'lunchbox': {
      const code = LUNCHBOX_SUBTYPE_CODES[reward.dataValString];
      if (code === undefined) return { save, handle: { kind: 'none' } };
      const cur = consumableCounts(save)[code] ?? 0;
      return {
        save: setConsumableCount(save, code, cur + amount),
        handle: { kind: 'consumable', code, amount },
      };
    }
    case 'weapon':
    case 'outfit': {
      const itemType: StackableType = reward.rewardType === 'weapon' ? 'Weapon' : 'Outfit';
      const id = reward.dataValString;
      const known = itemType === 'Weapon' ? data.weaponById.has(id) : data.outfitById.has(id);
      if (!known) return { save, handle: { kind: 'none' } };
      return { save: grantItems(save, itemType, id, 1), handle: { kind: 'item', itemType, id } };
    }
    case 'pet': {
      const id = reward.dataValString;
      const pet = data.petById.get(id);
      if (!pet) return { save, handle: { kind: 'none' } };
      // Grant the best legal roll (a recovery/cheat tool - "max" is the friendly default).
      const next = addPet(save, {
        petId: id,
        uniqueName: petSpecialName(pet),
        bonus: pet.bonus,
        bonusValue: pet.bonusMax,
      });
      // addPet appends, so the new instance is the last inventory entry.
      const index = inventoryItems(next).length - 1;
      return { save: next, handle: { kind: 'pet', index, id } };
    }
    case 'dweller': {
      const resolved = resolveDweller(data, reward.dataValString);
      if (!resolved) return { save, handle: { kind: 'none' } };
      const next = addSpecialDweller(save, resolved.key, resolved.entry);
      // addSpecialDweller bumps `dwellers.id` to the new dweller's serializeId.
      const serializeId = next.dwellers?.id;
      if (typeof serializeId !== 'number') return { save: next, handle: { kind: 'none' } };
      return { save: next, handle: { kind: 'dweller', serializeId } };
    }
    case 'theme': {
      const id = reward.dataValString;
      // Only flag for removal on unclaim if THIS claim actually added the recipe (don't
      // strip a theme the user already owned).
      const added = !recipeKnown(save, id);
      return { save: addRecipes(save, [id]), handle: { kind: 'recipe', id, added } };
    }
    default:
      // Inert placeholder ("[Type]") or any unknown type - claim is a flag flip only.
      return { save, handle: { kind: 'none' } };
  }
}

/** Reverse a captured grant. Pure; clamps resources/consumables at 0; no-op if absent. */
function reverseGrant(save: SaveData, handle: ReversalHandle): SaveData {
  switch (handle.kind) {
    case 'resource': {
      const cur = resources(save)[handle.key] ?? 0;
      return setResource(save, handle.key, cur - handle.amount); // setResource floors at 0
    }
    case 'consumable': {
      const cur = consumableCounts(save)[handle.code] ?? 0;
      return setConsumableCount(save, handle.code, Math.max(0, cur - handle.amount));
    }
    case 'item': {
      const items = inventoryItems(save);
      const idx = items.findIndex((i) => i.type === handle.itemType && i.id === handle.id);
      return idx === -1 ? save : removeStoredItemAt(save, idx);
    }
    case 'pet': {
      const items = inventoryItems(save);
      // Prefer the captured index when it still points at the matching pet; otherwise
      // remove the LAST matching pet (robust if storage shifted since the claim).
      const at = items[handle.index];
      if (at && at.type === 'Pet' && at.id === handle.id) {
        return removeStoredItemAt(save, handle.index);
      }
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].type === 'Pet' && items[i].id === handle.id) {
          return removeStoredItemAt(save, i);
        }
      }
      return save;
    }
    case 'dweller':
      return hasDweller(save, handle.serializeId) ? removeDweller(save, handle.serializeId) : save;
    case 'recipe':
      return handle.added ? removeRecipes(save, [handle.id]) : save;
    case 'none':
      return save;
  }
}

// --- locate a reward in the workspace -------------------------------------------

interface RewardLocation {
  listKey: RewardListKey;
  index: number;
  reward: SeasonReward;
}

function locateReward(
  spd: SeasonSave,
  seasonId: string,
  track: SeasonTrack,
  rewardId: number,
): RewardLocation | null {
  const record = spd.seasonsData?.[seasonId];
  if (!record) return null;
  const listKey = REWARD_LIST_KEY[track];
  const list = record[listKey];
  if (!Array.isArray(list)) return null;
  const index = list.findIndex((r) => r.id === rewardId);
  if (index === -1) return null;
  return { listKey, index, reward: list[index] };
}

/** True if a reward's `claimedList` holds the (single-vault) claim index. */
export function isRewardClaimed(reward: SeasonReward): boolean {
  return reward.claimedList.includes(VAULT_INDEX);
}

/** The season id under which the Ultracite Mine / Ultracite Weapon Workshop function. */
export const ULTRACITE_SEASON_ID = 'UltraciteFever';

/**
 * True when Ultracite Fever is the ACTIVE season (`spd.currentSeason`). The game only lets the
 * Ultracite Mine produce ultracite and the Ultracite Weapon Workshop craft while this season is
 * running; in any other vault (no season loaded, or a different active season) those rooms are
 * inert. Null spd (no season model loaded) is not active.
 */
export function isUltraciteSeasonActive(spd: SeasonSave | null): boolean {
  return spd?.currentSeason === ULTRACITE_SEASON_ID;
}

// --- claim / unclaim ---------------------------------------------------

/**
 * Claim a reward: grant the item into the `.sav` and set the `spd.dat` claim flag, in one
 * transition. Captures a reversal handle for an exact unclaim. No-op (same workspace) if
 * the reward is missing or already claimed.
 */
export function claimReward(
  ws: SeasonWorkspace,
  data: RewardResolverData,
  seasonId: string,
  track: SeasonTrack,
  rewardId: number,
): SeasonWorkspace {
  const loc = locateReward(ws.spd, seasonId, track, rewardId);
  if (!loc || isRewardClaimed(loc.reward)) return ws;

  const { save, handle } = grantReward(ws.save, loc.reward, data);
  const claimedReward: SeasonReward = {
    ...loc.reward,
    claimedList: [...loc.reward.claimedList, VAULT_INDEX],
  };
  return {
    save,
    spd: withReward(ws.spd, seasonId, loc.listKey, loc.index, claimedReward),
    nvf: ws.nvf,
    handles: { ...ws.handles, [rewardKey(seasonId, track, rewardId)]: handle },
  };
}

/**
 * Unclaim a reward: clear the `spd.dat` claim flag and, IF the editor made this claim this
 * session (a stored handle), reverse the exact grant in the `.sav`. A reward that was
 * already claimed on import (no handle - e.g. an uploaded file's game-granted reward) only
 * has its flag cleared, never touching the user's `.sav` items. No-op if not claimed.
 */
export function unclaimReward(
  ws: SeasonWorkspace,
  seasonId: string,
  track: SeasonTrack,
  rewardId: number,
): SeasonWorkspace {
  const loc = locateReward(ws.spd, seasonId, track, rewardId);
  if (!loc || !isRewardClaimed(loc.reward)) return ws;

  const key = rewardKey(seasonId, track, rewardId);
  const handle = ws.handles[key];
  const save = handle ? reverseGrant(ws.save, handle) : ws.save;
  const unclaimedReward: SeasonReward = {
    ...loc.reward,
    claimedList: loc.reward.claimedList.filter((i) => i !== VAULT_INDEX),
  };
  const handles = { ...ws.handles };
  delete handles[key];
  return {
    save,
    spd: withReward(ws.spd, seasonId, loc.listKey, loc.index, unclaimedReward),
    nvf: ws.nvf,
    handles,
  };
}

/** Toggle a reward's claim state (the board-cell click). */
export function toggleReward(
  ws: SeasonWorkspace,
  data: RewardResolverData,
  seasonId: string,
  track: SeasonTrack,
  rewardId: number,
): SeasonWorkspace {
  const loc = locateReward(ws.spd, seasonId, track, rewardId);
  if (!loc) return ws;
  return isRewardClaimed(loc.reward)
    ? unclaimReward(ws, seasonId, track, rewardId)
    : claimReward(ws, data, seasonId, track, rewardId);
}

// --- batch helpers (one combined undo entry in the store) ------------------------

function rewardIds(spd: SeasonSave, seasonId: string, track: SeasonTrack): number[] {
  const record = spd.seasonsData?.[seasonId];
  const list = record?.[REWARD_LIST_KEY[track]];
  return Array.isArray(list) ? list.map((r) => r.id) : [];
}

/**
 * Claim every currently-unclaimed reward the user is entitled to: the whole free track,
 * plus the premium track only when premium is unlocked (matches the board's grant gate).
 */
export function claimUnclaimed(
  ws: SeasonWorkspace,
  data: RewardResolverData,
  seasonId: string,
): SeasonWorkspace {
  let next = ws;
  const premiumUnlocked = next.spd.seasonsData?.[seasonId]?.isPremium === true;
  for (const id of rewardIds(next.spd, seasonId, 'free')) {
    next = claimReward(next, data, seasonId, 'free', id);
  }
  if (premiumUnlocked) {
    for (const id of rewardIds(next.spd, seasonId, 'premium')) {
      next = claimReward(next, data, seasonId, 'premium', id);
    }
  }
  return next;
}

/**
 * Claim EVERYTHING in a season: unlock premium + premium-plus, then claim both tracks.
 * (Premium rewards aren't claimable without premium, so "claim all" implies unlocking it.)
 */
export function claimAll(
  ws: SeasonWorkspace,
  data: RewardResolverData,
  seasonId: string,
): SeasonWorkspace {
  let next = setPremiumPlus(ws, seasonId, true);
  for (const track of ['free', 'premium'] as const) {
    for (const id of rewardIds(next.spd, seasonId, track)) {
      next = claimReward(next, data, seasonId, track, id);
    }
  }
  return next;
}

/** Highest level gate across a season's rewards - its rank cap (25 in shipped seasons). */
function maxRankOf(spd: SeasonSave, seasonId: string): number {
  const record = spd.seasonsData?.[seasonId];
  if (!record) return 0;
  let max = 0;
  for (const listKey of [REWARD_LIST_KEY.free, REWARD_LIST_KEY.premium] as const) {
    for (const reward of record[listKey] ?? []) max = Math.max(max, reward.levelRequired);
  }
  return max;
}

/**
 * Max a season: claim everything, set `maxRankAchieved` to the rank cap, and - when this is
 * the active season - set `currentLevel`/`battlepassWindowLastObservedLevel` to the cap too.
 */
export function maxSeason(
  ws: SeasonWorkspace,
  data: RewardResolverData,
  seasonId: string,
): SeasonWorkspace {
  const cap = maxRankOf(ws.spd, seasonId);
  let next = claimAll(ws, data, seasonId);
  next = setMaxRank(next, seasonId, cap);
  if (next.spd.currentSeason === seasonId) next = setLevel(next, cap);
  return next;
}

/** Max every season present in the workspace (one combined undo entry in the store). */
export function maxAllSeasons(ws: SeasonWorkspace, data: RewardResolverData): SeasonWorkspace {
  let next = ws;
  for (const seasonId of Object.keys(next.spd.seasonsData ?? {})) {
    next = maxSeason(next, data, seasonId);
  }
  return next;
}

// --- "already spent" predicates ----------------------------------------------------
// The quick-action buttons disable on these: once a batch action can't add anything the
// button is spent, and clicking it again would only confuse (nothing visibly happens).

/** True when a season's track list is fully claimed (empty lists count as claimed). */
function trackClaimed(spd: SeasonSave, seasonId: string, track: SeasonTrack): boolean {
  const record = spd.seasonsData?.[seasonId];
  return (record?.[REWARD_LIST_KEY[track]] ?? []).every(isRewardClaimed);
}

/**
 * True when everything {@link claimUnclaimed} is entitled to claim is already claimed:
 * the whole free track, plus the premium track when premium is unlocked.
 */
export function isEntitledClaimed(spd: SeasonSave, seasonId: string): boolean {
  const premiumUnlocked = spd.seasonsData?.[seasonId]?.isPremium === true;
  return (
    trackClaimed(spd, seasonId, 'free') &&
    (!premiumUnlocked || trackClaimed(spd, seasonId, 'premium'))
  );
}

/**
 * True when {@link claimAll} would change nothing: both tracks fully claimed and the
 * premium + plus unlocks it performs are already in place.
 */
export function isSeasonFullyClaimed(spd: SeasonSave, seasonId: string): boolean {
  const record = spd.seasonsData?.[seasonId];
  return (
    record?.isPremium === true &&
    record.isPremiumPlus === true &&
    trackClaimed(spd, seasonId, 'free') &&
    trackClaimed(spd, seasonId, 'premium')
  );
}

/**
 * True when {@link maxSeason} has nothing left to add: fully claimed, `maxRankAchieved`
 * at (or past) the rank cap, and - for the active season - `currentLevel` there too.
 */
export function isSeasonMaxed(spd: SeasonSave, seasonId: string): boolean {
  if (!isSeasonFullyClaimed(spd, seasonId)) return false;
  const cap = maxRankOf(spd, seasonId);
  const record = spd.seasonsData?.[seasonId];
  if ((record?.maxRankAchieved ?? 0) < cap) return false;
  return spd.currentSeason !== seasonId || (spd.currentLevel ?? 0) >= cap;
}

/** True when every season in the workspace is maxed ({@link maxAllSeasons} is spent). */
export function areAllSeasonsMaxed(spd: SeasonSave): boolean {
  return Object.keys(spd.seasonsData ?? {}).every((id) => isSeasonMaxed(spd, id));
}

// --- status setters --------------------------------------------------------------

/** Set the active-season level (`currentLevel`), keeping `battlepassWindowLastObservedLevel`
 *  in lock-step. Floors at 0; the UI clamps to the rank cap unless out-of-range is allowed. */
export function setLevel(ws: SeasonWorkspace, level: number): SeasonWorkspace {
  const value = Math.max(0, Math.trunc(level));
  if (ws.spd.currentLevel === value && ws.spd.battlepassWindowLastObservedLevel === value) {
    return ws;
  }
  return {
    ...ws,
    spd: { ...ws.spd, currentLevel: value, battlepassWindowLastObservedLevel: value },
  };
}

/** Set the active-season token count (`currentTokens`). Floors at 0. */
export function setTokens(ws: SeasonWorkspace, tokens: number): SeasonWorkspace {
  const value = Math.max(0, Math.trunc(tokens));
  if (ws.spd.currentTokens === value) return ws;
  return { ...ws, spd: { ...ws.spd, currentTokens: value } };
}

/** Set a season's `maxRankAchieved`. Floors at 0. */
export function setMaxRank(ws: SeasonWorkspace, seasonId: string, rank: number): SeasonWorkspace {
  const record = ws.spd.seasonsData?.[seasonId];
  if (!record) return ws;
  const value = Math.max(0, Math.trunc(rank));
  if (record.maxRankAchieved === value) return ws;
  return { ...ws, spd: withRecord(ws.spd, seasonId, { ...record, maxRankAchieved: value }) };
}

/**
 * Keep `spd.purchaseHistory.SeasonPassLunchboxClaims` in sync with a season's premium
 * flags. This list is the game's record of PURCHASED passes: on vault load the game
 * compares it against the `.sav`'s own claims and delivers the season's goodie-box
 * lunchbox to any vault that hasn't received it yet (Vault.GrantEligibleSeasonalLunchboxes,
 * verified v2.4.1). Recording the purchase here is what makes the game grant the box.
 * When both flags are off the entry is removed (nothing purchased).
 */
function syncPurchaseHistory(
  spd: SeasonSave,
  seasonId: string,
  premium: boolean,
  premiumPlus: boolean,
): SeasonSave {
  const list = spd.purchaseHistory?.SeasonPassLunchboxClaims ?? [];
  const existing = list.find((e) => e.ID === seasonId);
  const wantEntry = premium || premiumPlus;
  if (!wantEntry && !existing) return spd;
  if (existing && existing.Premium === premium && (existing.PremiumPlus ?? false) === premiumPlus) {
    return spd;
  }
  const next = wantEntry
    ? existing
      ? list.map((e) =>
          e.ID === seasonId ? { ...e, Premium: premium, PremiumPlus: premiumPlus } : e,
        )
      : [...list, { ID: seasonId, Premium: premium, PremiumPlus: premiumPlus }]
    : list.filter((e) => e.ID !== seasonId);
  return {
    ...spd,
    purchaseHistory: { ...spd.purchaseHistory, SeasonPassLunchboxClaims: next },
  };
}

/**
 * Toggle a season's premium track. Turning premium OFF also clears premium-plus (plus
 * without premium is an invalid state). The purchase-history record moves with the flags
 * so the game's on-load goodie-box grant matches the ownership state (see
 * {@link syncPurchaseHistory}).
 */
export function setPremium(ws: SeasonWorkspace, seasonId: string, on: boolean): SeasonWorkspace {
  const record = ws.spd.seasonsData?.[seasonId];
  if (!record) return ws;
  const nextPlus = on ? (record.isPremiumPlus ?? false) : false;
  if (record.isPremium === on && (record.isPremiumPlus ?? false) === nextPlus) return ws;
  const spd = withRecord(ws.spd, seasonId, { ...record, isPremium: on, isPremiumPlus: nextPlus });
  return { ...ws, spd: syncPurchaseHistory(spd, seasonId, on, nextPlus) };
}

/**
 * Toggle a season's premium-plus track. Turning plus ON also unlocks premium (plus implies
 * premium ownership). Purchase history follows the flags (see {@link syncPurchaseHistory}).
 */
export function setPremiumPlus(
  ws: SeasonWorkspace,
  seasonId: string,
  on: boolean,
): SeasonWorkspace {
  const record = ws.spd.seasonsData?.[seasonId];
  if (!record) return ws;
  const nextPremium = on ? true : (record.isPremium ?? false);
  if ((record.isPremiumPlus ?? false) === on && (record.isPremium ?? false) === nextPremium) {
    return ws;
  }
  const spd = withRecord(ws.spd, seasonId, {
    ...record,
    isPremiumPlus: on,
    isPremium: nextPremium,
  });
  return { ...ws, spd: syncPurchaseHistory(spd, seasonId, nextPremium, on) };
}

/**
 * Apply the in-game pass-purchase token grant (ShopWindow → SeasonPassTokenManager,
 * verified v2.4.1): add `amount` tokens to the ACTIVE season, then convert tokens to
 * levels exactly like the game - while the current level's cost (`tokenRequirements`
 * indexed by CURRENT level) is met, consume it and level up. Premium Plus grants 25
 * tokens in every shipped season, walking a fresh pass from level 1 to rank 5 ("instantly
 * skips the first levels"); the base Premium purchase grants 0. `maxRankAchieved` rises
 * with the new level. No-op for a non-active season (level/tokens are top-level
 * active-season fields, and the game only sells the active season's pass) or when
 * already at the rank cap (the game's AddTokens gate).
 */
export function grantPassTokens(
  ws: SeasonWorkspace,
  seasonId: string,
  amount: number,
  tokenRequirements: readonly number[],
): SeasonWorkspace {
  const grant = Math.trunc(amount);
  if (ws.spd.currentSeason !== seasonId || grant <= 0 || tokenRequirements.length === 0) return ws;
  const cap = tokenRequirements.length;
  let level = ws.spd.currentLevel ?? 1;
  if (level >= cap) return ws; // at max reward level the game ignores added tokens
  let tokens = (ws.spd.currentTokens ?? 0) + grant;
  const costOf = (lvl: number): number =>
    tokenRequirements[Math.min(Math.max(lvl, 0), cap - 1)] ?? 0;
  while (costOf(level) > 0 && tokens >= costOf(level) && level < cap) {
    tokens -= costOf(level);
    level++;
  }
  let next: SeasonWorkspace = {
    ...ws,
    spd: {
      ...ws.spd,
      currentLevel: level,
      currentTokens: tokens,
      battlepassWindowLastObservedLevel: level,
    },
  };
  const record = next.spd.seasonsData?.[seasonId];
  if (record && (record.maxRankAchieved ?? 0) < level) {
    next = {
      ...next,
      spd: withRecord(next.spd, seasonId, { ...record, maxRankAchieved: level }),
    };
  }
  return next;
}

/**
 * Switch the active season: point `spd.currentSeason` and `nvf.season.id` at `seasonId`
 * (they must stay in sync). `nvf.season.type` is preserved
 * (the per-season type enum is not carried in `spd.dat`/the catalog).
 */
export function switchSeason(ws: SeasonWorkspace, seasonId: string): SeasonWorkspace {
  const idInSync = ws.spd.currentSeason === seasonId && ws.nvf.season?.id === seasonId;
  if (idInSync) return ws;
  return {
    ...ws,
    spd: { ...ws.spd, currentSeason: seasonId },
    nvf: { ...ws.nvf, season: { ...ws.nvf.season, id: seasonId } },
  };
}

// --- fresh model construction ("Continue without a file") -------------

/** A reward laid out by the catalog gains a fresh, empty `claimedList`. */
function freshReward(reward: CatalogReward): SeasonReward {
  return { ...reward, claimedList: [] };
}

/** The empty 4×5 leaderboard claim grid, stringified the way the game stores it. */
const EMPTY_LEADERBOARD_GRID = JSON.stringify(
  Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => false)),
);

/**
 * Build a fresh, fully-editable `spd.dat` working model from the static catalog (nothing
 * claimed, level 1, no premium). The active season defaults to the most recent catalog
 * season. Reward ids/codes are taken verbatim from the catalog - never regenerated.
 */
export function buildFreshSeasonSave(catalog: SeasonCatalog): SeasonSave {
  const currentSeason = catalog.seasonIds[catalog.seasonIds.length - 1] ?? '';
  const seasonsData: NonNullable<SeasonSave['seasonsData']> = {};
  for (const entry of catalog.seasons) {
    seasonsData[entry.id] = {
      isPremium: false,
      isPremiumPlus: false,
      isFirstLogin: true,
      hasBeenWarnedAboutSeasonEnd: false,
      leaderboardData: {
        score: 0,
        claimedRewards: EMPTY_LEADERBOARD_GRID,
        lastRewardLevelUnlocked: -1,
      },
      maxRankAchieved: 0,
      ...(catalog.ncqReward ? { ncqReward: freshReward(catalog.ncqReward) } : {}),
      freeRewardsList: entry.freeRewards.map(freshReward),
      premiumRewardsList: entry.premiumRewards.map(freshReward),
    };
  }
  return {
    schemaVersion: 2,
    currentSeason,
    currentLevel: 1,
    currentTokens: 0,
    battlepassWindowLastObservedLevel: 1,
    saveTime: 0,
    seasonStartSplashLastDisplayTime: 0,
    lastPremiumUpsellTime: 0,
    debugTimeOffset: 0,
    purchaseHistory: { SeasonPassLunchboxClaims: [] },
    seasonsData,
  };
}

/** Build a fresh `nvf.dat` pointer for the catalog's default active season. */
export function buildFreshNvf(catalog: SeasonCatalog): NvfData {
  return { season: { id: catalog.seasonIds[catalog.seasonIds.length - 1] ?? '', type: 0 } };
}

/**
 * Normalize an uploaded `spd.dat` into a working model: defensively guarantee every reward
 * carries a `claimedList` array so the board never reads `undefined`. Pass-through for the
 * rest (the loose schema already preserves unknown keys for round-trip).
 */
export function loadSeasonSave(spd: SeasonSave): SeasonSave {
  const seasonsData = spd.seasonsData;
  if (!seasonsData) return spd;
  let changed = false;
  const nextData: NonNullable<SeasonSave['seasonsData']> = {};
  for (const [seasonId, record] of Object.entries(seasonsData)) {
    let recordChanged = false;
    const fix = (list: SeasonReward[] | undefined): SeasonReward[] | undefined => {
      if (!Array.isArray(list)) return list;
      let listChanged = false;
      const next = list.map((r) => {
        if (Array.isArray(r.claimedList)) return r;
        listChanged = true;
        return { ...r, claimedList: [] };
      });
      if (listChanged) recordChanged = true;
      return listChanged ? next : list;
    };
    const free = fix(record.freeRewardsList);
    const premium = fix(record.premiumRewardsList);
    if (recordChanged) {
      changed = true;
      nextData[seasonId] = { ...record, freeRewardsList: free, premiumRewardsList: premium };
    } else {
      nextData[seasonId] = record;
    }
  }
  return changed ? { ...spd, seasonsData: nextData } : spd;
}

// --- Season clock (the game's own debug time offset) ------------------------------

/** .NET ticks in one day. */
const TICKS_PER_DAY = 86_400 * 10_000_000;

/**
 * Advance the season clock by `days` (`spd.debugTimeOffset`, .NET ticks the game adds
 * to "now" for ALL season timing - weekly unlocks, event windows, season end). Mirrors
 * the game's own AddGlobalTimeOffsetDays: += days worth of ticks + 1. A realistic
 * offset stays far inside Number.MAX_SAFE_INTEGER, so plain number math is exact;
 * a hand-edited out-of-range value (parsed as LosslessInt fails the schema's number
 * type) is replaced wholesale via the ?? 0 fallback.
 */
export function advanceSeasonClock(ws: SeasonWorkspace, days: number): SeasonWorkspace {
  const d = Math.trunc(days);
  if (!Number.isFinite(d) || d <= 0) return ws;
  const current = typeof ws.spd.debugTimeOffset === 'number' ? ws.spd.debugTimeOffset : 0;
  return { ...ws, spd: { ...ws.spd, debugTimeOffset: current + d * TICKS_PER_DAY + 1 } };
}

/** Reset the season clock to real time (`debugTimeOffset = 0`). */
export function resetSeasonClock(ws: SeasonWorkspace): SeasonWorkspace {
  if ((ws.spd.debugTimeOffset ?? 0) === 0) return ws;
  return { ...ws, spd: { ...ws.spd, debugTimeOffset: 0 } };
}

/**
 * Jump the season clock past the active season's end - the game's own
 * SkipToEndOfCurrentSeason cheat: offset = endDate - now + 1 tick. The caller
 * computes both tick values (catalog endDate / Date.now via taskLookup.ticksFromUnixMs)
 * so the op stays pure. No-op when the season already ended (offset would be <= 0).
 */
export function skipToSeasonEnd(
  ws: SeasonWorkspace,
  endDateTicks: bigint,
  nowTicks: bigint,
): SeasonWorkspace {
  const offset = endDateTicks - nowTicks + 1n;
  if (offset <= 0n) return ws;
  const value = Number(offset);
  if (!Number.isSafeInteger(value)) return ws; // > ~28 years out - malformed input
  if (ws.spd.debugTimeOffset === value) return ws;
  return { ...ws, spd: { ...ws.spd, debugTimeOffset: value } };
}

/** Current season-clock offset in whole days (0 = real time). */
export function seasonClockOffsetDays(spd: SeasonSave): number {
  const offset = typeof spd.debugTimeOffset === 'number' ? spd.debugTimeOffset : 0;
  return Math.floor(offset / TICKS_PER_DAY);
}
