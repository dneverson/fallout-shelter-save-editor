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
  it('contains all 5 shipped seasons with the correct reward counts', () => {
    expect(catalog.seasons).toHaveLength(5);
    expect(catalog.seasonIds).toEqual([
      'NewVegasA',
      'NewVegasB',
      'UltraciteFever',
      'Enclave',
      'Institute',
    ]);
    for (const season of catalog.seasons) {
      expect(season.freeRewards).toHaveLength(12);
      expect(season.premiumRewards).toHaveLength(25);
      expect(season.maxRank).toBe(25);
      // Last 5 premium ranks are prestige rewards.
      expect(season.premiumRewards.filter((r) => r.isPrestige)).toHaveLength(5);
    }
  });

  it('indexes seasons by id and matches the meta count', () => {
    expect(catalog.seasonById.get('Institute')?.maxRank).toBe(25);
    expect(catalog.seasonById.has('NewVegasA')).toBe(true);
    const meta = load('meta') as { counts: Record<string, number> };
    expect(meta.counts.seasons).toBe(5);
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
