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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

/** Read a single-line YAML scalar (`m_foo: bar`) from a ScriptableObject asset. */
function assetField(text, field) {
  return text.match(new RegExp(`^\\s*${field}:\\s*(.+?)\\s*$`, 'm'))?.[1] ?? null;
}

/** Read the guid out of an inline asset reference (`m_foo: {fileID: …, guid: …, type: 2}`). */
function assetRefGuid(text, field) {
  return text.match(new RegExp(`^\\s*${field}:\\s*\\{[^}]*guid:\\s*([0-9a-f]+)`, 'm'))?.[1] ?? null;
}

/** Decode Unity's hex-encoded little-endian int32 array serialization. */
function decodeInt32Array(hex) {
  const out = [];
  for (let i = 0; i + 8 <= hex.length; i += 8) {
    const le = hex.slice(i, i + 8);
    out.push(parseInt(le.slice(6, 8) + le.slice(4, 6) + le.slice(2, 4) + le.slice(0, 2), 16));
  }
  return out;
}

/** Map asset guid -> asset path for MonoBehaviour files matching a filename prefix. */
function guidIndex(prefix) {
  const out = new Map();
  for (const f of readdirSync(PATHS.monoBehaviourDir)) {
    if (!f.startsWith(prefix) || !f.endsWith('.asset.meta')) continue;
    const guid = assetField(readSource(join(PATHS.monoBehaviourDir, f)), 'guid');
    if (guid) out.set(guid, join(PATHS.monoBehaviourDir, f.slice(0, -'.meta'.length)));
  }
  return out;
}

/**
 * Per-season static data from the v2.5.0 ScriptableObject layout. Season definitions
 * moved out of SeasonPassDataManager.prefab into per-season assets:
 *
 *   Season_<id>.asset          - m_id, m_endDateString, m_seasonDataSet {guid}
 *   SeasonDataSet_<name>.asset - m_tokenRequirements {guid}, m_passPurchaseRewardsDefID
 *   SeasonPassTokenRequirements_<name>.asset - m_data (hex-encoded LE int32 array)
 *   SeasonPassPurchaseRewards_<defID>.asset  - m_basePassTokens, m_premiumPassTokens
 *
 * Token costs are indexed by CURRENT level (SeasonPassTokenManager, clamped) - so
 * [0,3,5,6,6,10,…] means level 1→2 costs 3 tokens, 2→3 costs 5, and so on. End dates
 * are compared by the game against local DateTime.Now (+ the spd.dat debugTimeOffset);
 * the Season tab's "skip past end of season" needs them. Pass-purchase token grants
 * (verified v2.4.1-v2.5.0): 0 on the base (Premium) purchase, 25 on Premium Plus -
 * which levels a fresh pass straight to rank 5 (the in-game "instantly skips the
 * first levels" effect). Rerun seasons (NewVegasA_26_07, …) reference the original
 * season's purchase-rewards def and the shared Default token table.
 */
function parseSeasonAssets() {
  const dataSetByGuid = guidIndex('SeasonDataSet_');
  const tokenReqByGuid = guidIndex('SeasonPassTokenRequirements_');

  // Pass-purchase token grants, keyed by the def id in the asset name (the datasets
  // reference them by m_passPurchaseRewardsDefID string, not by guid).
  const passTokensByDefId = new Map();
  for (const f of readdirSync(PATHS.monoBehaviourDir)) {
    const m = f.match(/^SeasonPassPurchaseRewards_(\w+)\.asset$/);
    if (!m) continue;
    const text = readSource(join(PATHS.monoBehaviourDir, f));
    passTokensByDefId.set(m[1], {
      basePassTokens: Number(assetField(text, 'm_basePassTokens') ?? 0),
      premiumPassTokens: Number(assetField(text, 'm_premiumPassTokens') ?? 0),
    });
  }

  const out = new Map();
  for (const f of readdirSync(PATHS.monoBehaviourDir)) {
    if (!/^Season_\w+\.asset$/.test(f)) continue;
    const season = readSource(join(PATHS.monoBehaviourDir, f));
    const id = assetField(season, 'm_id');
    if (!id) continue;

    let tokenRequirements = [];
    let passTokens = { basePassTokens: 0, premiumPassTokens: 0 };
    const dataSetPath = dataSetByGuid.get(assetRefGuid(season, 'm_seasonDataSet'));
    if (dataSetPath) {
      const dataSet = readSource(dataSetPath);
      const tokenReqPath = tokenReqByGuid.get(assetRefGuid(dataSet, 'm_tokenRequirements'));
      if (tokenReqPath) {
        tokenRequirements = decodeInt32Array(assetField(readSource(tokenReqPath), 'm_data') ?? '');
      }
      const defId = assetField(dataSet, 'm_passPurchaseRewardsDefID');
      passTokens = passTokensByDefId.get(defId) ?? passTokens;
    }

    out.set(id, {
      endDate: assetField(season, 'm_endDateString') ?? undefined,
      tokenRequirements,
      ...passTokens,
    });
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
  const seasonAssets = parseSeasonAssets();

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
    const assets = seasonAssets.get(id);
    return {
      id,
      maxRank,
      tokenRequirements: assets?.tokenRequirements ?? [],
      basePassTokens: assets?.basePassTokens ?? 0,
      premiumPassTokens: assets?.premiumPassTokens ?? 0,
      ...(assets?.endDate !== undefined ? { endDate: assets.endDate } : {}),
      freeRewards,
      premiumRewards,
    };
  });

  return { ncqReward, seasons };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('season-pass.json', buildSeasonPass());
}
