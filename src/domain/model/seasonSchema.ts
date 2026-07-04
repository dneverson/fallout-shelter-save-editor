import { z } from 'zod';
import { LosslessInt } from '../codec/losslessJson.ts';

// Typed-permissive season model. Same philosophy as
// saveSchema: validate only the fields the Season Pass ops read/write and let every
// other key pass through untouched via `z.looseObject`, so a decode→encode cycle of
// `spd.dat` / `nvf.dat` is semantically lossless (unknown managers/challenges survive).
//
// The season files are never `.parse()`d as a whole - the codec casts (decodeSeason /
// decodeNvf in saveCodec.ts). These schemas are the single source of truth for the
// *types* the season ops use, and stay available for targeted validation.
//
// Pure domain code: no React/DOM imports.

// --- int64 fields ---------------------------------
// `spd.dat` carries .NET DateTime ticks above Number.MAX_SAFE_INTEGER (~6.39e17).
// The lossless codec boxes those into `LosslessInt`; in-range values (e.g. `0` for
// `lastPremiumUpsellTime` in the sample) stay native `number`. Accept both so the
// schema types these fields without forcing the codec's containment rule.
const int64 = z.union([z.number(), z.instanceof(LosslessInt)]);

/** An int64 tick field - either a native `number` (in range) or a boxed `LosslessInt`. */
export type Int64 = z.infer<typeof int64>;

// --- Reward ---------------------------------------
// One entry of `freeRewardsList` / `premiumRewardsList` (and the inert `ncqReward`
// placeholder, which shares the shape with rewardType "[Type]"). `rewardType` stays a
// plain string rather than an enum so the placeholder and any future type round-trip;
// the known grantable types are enumerated as REWARD_TYPES for the ops/UI.

/** Known grantable reward types. The file may also carry
 *  the inert placeholder `"[Type]"`, which is not in this set. */
export const REWARD_TYPES = [
  'lunchbox',
  'caps',
  'stimpack',
  'outfit',
  'weapon',
  'pet',
  'dweller',
  'theme',
] as const;

/** A grantable reward type (excludes the inert `"[Type]"` placeholder). */
export type RewardType = (typeof REWARD_TYPES)[number];

const rewardSchema = z.looseObject({
  id: z.number(),
  isPrestige: z.boolean(),
  rewardType: z.string(),
  dataValInt: z.number(),
  dataValString: z.string(),
  icon: z.string().optional(),
  // [] = unclaimed; a claimed reward holds the vault index (0 in single-vault saves).
  claimedList: z.array(z.number()),
  levelRequired: z.number(),
});

// --- Per-season record ----------------------------
const leaderboardDataSchema = z.looseObject({
  score: z.number().optional(),
  // Stringified 4x5 bool grid of leaderboard-reward claim state.
  claimedRewards: z.string().optional(),
  lastRewardLevelUnlocked: z.number().optional(),
});

const seasonRecordSchema = z.looseObject({
  isPremium: z.boolean().optional(),
  isPremiumPlus: z.boolean().optional(),
  isFirstLogin: z.boolean().optional(),
  hasBeenWarnedAboutSeasonEnd: z.boolean().optional(),
  leaderboardData: leaderboardDataSchema.optional(),
  maxRankAchieved: z.number().optional(),
  ncqReward: rewardSchema.optional(),
  freeRewardsList: z.array(rewardSchema).optional(),
  premiumRewardsList: z.array(rewardSchema).optional(),
});

// --- spd.dat top-level ----------------------------
const purchaseHistorySchema = z.looseObject({
  SeasonPassLunchboxClaims: z
    .array(
      z.looseObject({
        ID: z.string(),
        Premium: z.boolean().optional(),
        PremiumPlus: z.boolean().optional(),
      }),
    )
    .optional(),
});

export const seasonSaveSchema = z.looseObject({
  // schemaVersion MUST stay 2 - never written by ops.
  schemaVersion: z.number().optional(),
  currentSeason: z.string().optional(),
  currentLevel: z.number().optional(),
  currentTokens: z.number().optional(),
  battlepassWindowLastObservedLevel: z.number().optional(),
  saveTime: int64.optional(),
  seasonStartSplashLastDisplayTime: int64.optional(),
  lastPremiumUpsellTime: int64.optional(),
  debugTimeOffset: z.number().optional(),
  showSeasonHasEndedMainMenuSplash: z.string().optional(),
  purchaseHistory: purchaseHistorySchema.optional(),
  allSeasonChallenges: z.array(z.unknown()).optional(),
  completed: z.array(z.unknown()).optional(),
  claimed: z.array(z.unknown()).optional(),
  seasonsData: z.record(z.string(), seasonRecordSchema).optional(),
});

// --- nvf.dat --------------------------------------
export const nvfSchema = z.looseObject({
  season: z
    .looseObject({
      id: z.string().optional(),
      type: z.number().optional(),
    })
    .optional(),
});

/** A single reward in a season track (or the inert `ncqReward` placeholder). */
export type SeasonReward = z.infer<typeof rewardSchema>;

/** A per-season payload under `spd.dat.seasonsData.<SeasonID>`. */
export type SeasonRecord = z.infer<typeof seasonRecordSchema>;

/** The decoded `spd.dat` JSON (season-pass data). */
export type SeasonSave = z.infer<typeof seasonSaveSchema>;

/** The decoded `nvf.dat` JSON (current-season pointer). */
export type NvfData = z.infer<typeof nvfSchema>;
