// season-pass.json - the static Season Pass reward catalog.
//
// Enables the Season tab's "Continue without a file" path: a fresh, fully-editable
// `spd.dat` working model is built purely from this catalog (no user file). It is the
// per-season reward layout (free + premium tracks, level gates, item codes) with the
// per-SAVE claim state stripped out - `claimedList` is omitted here because it is save
// state, not catalog; the fresh-model builder (seasonOps) attaches `[]`.
//
// Source: a reference `spd.dat` at the repo root (a real season-pass save, gitignored
// like every `.dat`/`.sav`). Only the derived season-pass.json is committed; the
// reference file stays on the curation machine. Re-run via `pnpm gamedata:build` when
// the game ships new seasons. The reward ids/codes are emitted verbatim - never
// regenerated.
import { createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PATHS, REPO_ROOT, readSource, writeOutput } from './lib/io.mjs';

// Same fixed game-wide key/IV as the app codec (src/domain/crypto/aesCbc.ts).
// Duplicated here because the build scripts are plain Node
// ESM and don't import the app's TS crypto module.
const KEY = Buffer.from('a7ca9f3366d892c2f0bef417341ca971b69ae9f7bacccffcf43c62d1d7d021f9', 'hex');
const IV = Buffer.from('7475383967656a693334307438397532', 'hex'); // ASCII "tu89geji340t89u2"

const REFERENCE_SPD = join(REPO_ROOT, 'spd.dat');

/** Decode a Fallout Shelter container file (base64 → AES-256-CBC → UTF-8 → JSON). */
function decodeContainer(text) {
  const decipher = createDecipheriv('aes-256-cbc', KEY, IV); // PKCS#7 padding (default)
  const plain = Buffer.concat([
    decipher.update(Buffer.from(text.trim(), 'base64')),
    decipher.final(),
  ]);
  // The catalog carries no out-of-range integers (reward ids/levels are small), so
  // plain JSON.parse is exact here - the big-int-lossless path is only needed for the
  // app's tick fields, which this catalog excludes.
  return JSON.parse(plain.toString('utf8'));
}

/** Strip per-save state from a reward, keeping only the catalog (layout) fields. */
function catalogReward(reward) {
  return {
    id: reward.id,
    isPrestige: reward.isPrestige,
    rewardType: reward.rewardType,
    dataValInt: reward.dataValInt,
    dataValString: reward.dataValString,
    icon: reward.icon,
    levelRequired: reward.levelRequired,
  };
}

/**
 * Per-season level-up token costs from SeasonPassDataManager.prefab. Serialized as a
 * hex-encoded little-endian int32 array under `m_tokenRequirements`, a couple of lines
 * after the season's `m_id:`. The game's SeasonPassTokenManager indexes this list by
 * CURRENT level to get the cost of the next level (index clamped to the list) - so
 * [0,3,5,6,6,10,…] means level 1→2 costs 3 tokens, 2→3 costs 5, and so on.
 */
function parseTokenRequirements() {
  const text = readSource(join(PATHS.gameObjectDir, 'SeasonPassDataManager.prefab'));
  const out = new Map();
  let seasonId = null;
  for (const line of text.split('\n')) {
    const id = line.match(/^\s*m_id:\s*([A-Za-z]\w*)\s*$/);
    if (id) {
      seasonId = id[1];
      continue;
    }
    const req = line.match(/^\s*m_tokenRequirements:\s*([0-9a-f]+)\s*$/);
    if (req && seasonId) {
      const hex = req[1];
      const costs = [];
      for (let i = 0; i + 8 <= hex.length; i += 8) {
        // little-endian int32: reverse the 4 bytes
        const le = hex.slice(i, i + 8);
        costs.push(parseInt(le.slice(6, 8) + le.slice(4, 6) + le.slice(2, 4) + le.slice(0, 2), 16));
      }
      out.set(seasonId, costs);
      seasonId = null;
    }
  }
  return out;
}

/**
 * Per-season scheduled end dates from SeasonPassDataManager.prefab
 * (`m_endDateString: 2026-07-13`, a couple of lines after the season's `m_id:`).
 * The game compares them against local DateTime.Now (+ the spd.dat debugTimeOffset)
 * to decide when a season ends - the Season tab's "skip past end of season" needs them.
 */
function parseSeasonEndDates() {
  const text = readSource(join(PATHS.gameObjectDir, 'SeasonPassDataManager.prefab'));
  const out = new Map();
  let seasonId = null;
  for (const line of text.split('\n')) {
    const id = line.match(/^\s*m_id:\s*([A-Za-z]\w*)\s*$/);
    if (id) {
      seasonId = id[1];
      continue;
    }
    const end = line.match(/^\s*m_endDateString:\s*(\d{4}-\d{2}-\d{2})\s*$/);
    if (end && seasonId) {
      out.set(seasonId, end[1]);
      seasonId = null;
    }
  }
  return out;
}

/**
 * Per-season pass-purchase token grants from GameParameters.prefab
 * (Shop.SeasonPassPurchaseRewardsCollection). Verified v2.4.1: every season grants
 * 0 tokens on the base (Premium) purchase and 25 on Premium Plus - which, against the
 * token requirements above, levels a fresh pass straight to rank 5 (the in-game
 * "instantly skips the first levels" effect).
 */
function parsePassTokens() {
  const text = readSource(PATHS.gameParams);
  const out = new Map();
  let seasonId = null;
  let base = 0;
  for (const line of text.split('\n')) {
    const id = line.match(/^\s*-\s*m_seasonID:\s*(\w+)\s*$/);
    if (id) {
      seasonId = id[1];
      continue;
    }
    const baseTok = line.match(/^\s*m_basePassTokens:\s*(\d+)\s*$/);
    if (baseTok) {
      base = Number(baseTok[1]);
      continue;
    }
    const premTok = line.match(/^\s*m_premiumPassTokens:\s*(\d+)\s*$/);
    if (premTok && seasonId) {
      out.set(seasonId, { basePassTokens: base, premiumPassTokens: Number(premTok[1]) });
      seasonId = null;
      base = 0;
    }
  }
  return out;
}

export function buildSeasonPass() {
  if (!existsSync(REFERENCE_SPD)) {
    throw new Error(
      `Missing Season Pass source:\n  ${REFERENCE_SPD}\n` +
        'build-season-pass needs a reference spd.dat at the repo root (a real season-pass\n' +
        'save, gitignored like every .dat/.sav). The committed public/gamedata/season-pass.json\n' +
        'already ships the derived catalog - you only need this file to regenerate it when the\n' +
        'game adds seasons.',
    );
  }

  const spd = decodeContainer(readFileSync(REFERENCE_SPD, 'utf8'));
  const seasonsData = spd.seasonsData ?? {};
  const tokenRequirements = parseTokenRequirements();
  const passTokens = parsePassTokens();
  const endDates = parseSeasonEndDates();

  // The inert ncqReward placeholder is identical across all seasons; emit one template
  // (claim state stripped) for the fresh-model builder to attach per season.
  const sampleRecord = Object.values(seasonsData)[0];
  const ncqReward = sampleRecord?.ncqReward ? catalogReward(sampleRecord.ncqReward) : null;

  const seasons = Object.entries(seasonsData).map(([id, record]) => {
    const freeRewards = (record.freeRewardsList ?? []).map(catalogReward);
    const premiumRewards = (record.premiumRewardsList ?? []).map(catalogReward);
    // The season's rank cap is the highest level gate across both tracks (premium runs
    // 1..25 in every shipped season; prestige rewards are the last 5 premium ranks).
    const maxRank = [...freeRewards, ...premiumRewards].reduce(
      (m, r) => Math.max(m, r.levelRequired),
      0,
    );
    const tokens = passTokens.get(id) ?? { basePassTokens: 0, premiumPassTokens: 0 };
    const endDate = endDates.get(id);
    return {
      id,
      maxRank,
      tokenRequirements: tokenRequirements.get(id) ?? [],
      basePassTokens: tokens.basePassTokens,
      premiumPassTokens: tokens.premiumPassTokens,
      ...(endDate !== undefined ? { endDate } : {}),
      freeRewards,
      premiumRewards,
    };
  });

  return { ncqReward, seasons };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('season-pass.json', buildSeasonPass());
}
