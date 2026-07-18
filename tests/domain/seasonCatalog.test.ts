// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSeasonCatalog } from '../../src/domain/gamedata/seasonCatalog.ts';
import { REWARD_TYPES } from '../../src/domain/model/seasonSchema.ts';

// Validates the committed public/gamedata/season-pass.json against the schema. It ships
// in the repo (not gitignored), so this runs in CI without the reference spd.dat.
function load(name: string): unknown {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/gamedata', `${name}.json`), 'utf8'),
  );
}

const catalog = parseSeasonCatalog(load('season-pass'));

describe('season-pass catalog artifact', () => {
  it('contains all 8 shipped seasons with the correct reward counts', () => {
    expect(catalog.seasons).toHaveLength(8);
    expect(catalog.seasonIds).toEqual([
      'NewVegasA',
      'NewVegasB',
      'UltraciteFever',
      'Enclave',
      'Institute',
      // v2.5.0 rerun seasons: date-suffixed replays of the original cycle.
      'NewVegasA_26_07',
      'NewVegasB_26_09',
      'UltraciteFever_26_10',
    ]);
    for (const season of catalog.seasons) {
      // The active rerun (NewVegasA_26_07) fills every free level 1-20 with caps
      // rewards; the original seasons and not-yet-started reruns carry 12.
      expect(season.freeRewards).toHaveLength(season.id === 'NewVegasA_26_07' ? 20 : 12);
      expect(season.premiumRewards).toHaveLength(25);
      expect(season.maxRank).toBe(25);
      // Last 5 premium ranks are prestige rewards.
      expect(season.premiumRewards.filter((r) => r.isPrestige)).toHaveLength(5);
    }
  });

  it('indexes seasons by id and matches the meta count', () => {
    expect(catalog.seasonById.get('Institute')?.maxRank).toBe(25);
    expect(catalog.seasonById.has('NewVegasA')).toBe(true);
    expect(catalog.seasonById.has('NewVegasA_26_07')).toBe(true);
    const meta = load('meta') as { counts: Record<string, number> };
    expect(meta.counts.seasons).toBe(8);
  });

  it('carries the inert ncqReward placeholder template (claim state stripped)', () => {
    expect(catalog.ncqReward).toMatchObject({ id: 0, rewardType: '[Type]', levelRequired: 0 });
    // Catalog rewards never carry per-save claim state.
    expect(catalog.ncqReward).not.toHaveProperty('claimedList');
  });

  it('every catalog reward is a known grantable type and carries no claim state', () => {
    const grantable = new Set<string>(REWARD_TYPES);
    for (const season of catalog.seasons) {
      for (const reward of [...season.freeRewards, ...season.premiumRewards]) {
        expect(grantable.has(reward.rewardType)).toBe(true);
        expect(reward).not.toHaveProperty('claimedList');
        expect(reward.dataValString.length).toBeGreaterThan(0);
      }
    }
  });
});
