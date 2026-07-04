// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseLossless, LosslessInt, isLosslessInt } from '../../src/domain/codec/losslessJson.ts';
import {
  decodeSeason,
  encodeSeason,
  decodeNvf,
  encodeNvf,
} from '../../src/domain/codec/saveCodec.ts';
import {
  seasonSaveSchema,
  nvfSchema,
  REWARD_TYPES,
  type SeasonSave,
  type NvfData,
} from '../../src/domain/model/seasonSchema.ts';

const SEASON_SAMPLE = resolve(process.cwd(), 'tests/fixtures/season-sample.json');

// The fixture is decoded JSON text with the two out-of-range tick literals intact;
// parse it with the lossless parser (plain JSON.parse would corrupt them).
function loadSample(): SeasonSave {
  return parseLossless(readFileSync(SEASON_SAMPLE, 'utf8')) as SeasonSave;
}

describe('seasonSchema - acceptance', () => {
  it('parses the spd.dat sample without dropping keys (looseObject round-trip)', () => {
    const sample = loadSample();
    const parsed = seasonSaveSchema.parse(sample);
    // looseObject keeps every key; the parsed value is structurally identical.
    expect(parsed).toEqual(sample);
  });

  it('preserves unknown/untouched top-level and nested keys', () => {
    const sample = loadSample() as Record<string, unknown>;
    const withUnknown = {
      ...sample,
      someManagerWeNeverTouch: { nested: [1, 2, 3] },
      seasonsData: {
        Institute: {
          ...(sample.seasonsData as Record<string, Record<string, unknown>>).Institute,
          futureSeasonField: 'survives',
        },
      },
    };
    const parsed = seasonSaveSchema.parse(withUnknown) as Record<string, unknown>;
    expect(parsed.someManagerWeNeverTouch).toEqual({ nested: [1, 2, 3] });
    const inst = (parsed.seasonsData as Record<string, Record<string, unknown>>).Institute;
    expect(inst.futureSeasonField).toBe('survives');
  });

  it('accepts LosslessInt for int64 tick fields and keeps in-range ticks native', () => {
    const parsed = seasonSaveSchema.parse(loadSample());
    expect(isLosslessInt(parsed.saveTime)).toBe(true);
    expect((parsed.saveTime as LosslessInt).literal).toBe('639162074157166331');
    expect(isLosslessInt(parsed.seasonStartSplashLastDisplayTime)).toBe(true);
    // lastPremiumUpsellTime is 0 in the sample - in range, stays a native number.
    expect(parsed.lastPremiumUpsellTime).toBe(0);
  });

  it('types the reward edit surface and exposes the known reward types', () => {
    const parsed = seasonSaveSchema.parse(loadSample());
    const free = parsed.seasonsData?.Institute?.freeRewardsList ?? [];
    expect(free).toHaveLength(1);
    const reward = free[0];
    expect(reward.rewardType).toBe('lunchbox');
    expect(reward.dataValString).toBe('regular');
    expect(reward.claimedList).toEqual([0]);
    expect(REWARD_TYPES).toContain('lunchbox');
    expect(REWARD_TYPES).toContain('dweller');
  });

  it('schemaVersion stays 2 in the sample', () => {
    expect(seasonSaveSchema.parse(loadSample()).schemaVersion).toBe(2);
  });
});

describe('seasonSchema - nvf.dat', () => {
  it('parses the nvf shape and keeps the season pointer', () => {
    const nvf = nvfSchema.parse({ season: { id: 'Institute', type: 2 } });
    expect(nvf.season?.id).toBe('Institute');
    expect(nvf.season?.type).toBe(2);
  });
});

describe('season codec wrappers (decodeSeason/encodeSeason, decodeNvf/encodeNvf)', () => {
  it('round-trips spd.dat through the shared container with big-ints exact', async () => {
    const sample = loadSample();
    const decoded = await decodeSeason(await encodeSeason(sample));
    expect(decoded).toEqual(sample);
    expect((decoded.saveTime as LosslessInt).literal).toBe('639162074157166331');
  });

  it('round-trips nvf.dat through the shared container', async () => {
    const nvf: NvfData = { season: { id: 'Institute', type: 2 } };
    expect(await decodeNvf(await encodeNvf(nvf))).toEqual(nvf);
  });
});
