// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { Special } from '../../src/domain/gamedata/schemas.ts';
import {
  formatAvgDamage,
  outfitSpecialTotal,
  weaponAvgDamage,
} from '../../src/domain/gamedata/itemStats.ts';

const special = (over: Partial<Special>): Special => ({
  S: 0,
  P: 0,
  E: 0,
  C: 0,
  I: 0,
  A: 0,
  L: 0,
  ...over,
});

describe('itemStats (shared item-stat helpers)', () => {
  it('weaponAvgDamage is the midpoint of the min–max range', () => {
    expect(weaponAvgDamage({ damageMin: 2, damageMax: 4 })).toBe(3);
    expect(weaponAvgDamage({ damageMin: 3, damageMax: 4 })).toBe(3.5);
    expect(weaponAvgDamage({ damageMin: 10, damageMax: 10 })).toBe(10);
  });

  it('formatAvgDamage shows integers bare and halves to one decimal', () => {
    expect(formatAvgDamage(3)).toBe('3');
    expect(formatAvgDamage(3.5)).toBe('3.5');
  });

  it('outfitSpecialTotal sums every SPECIAL bonus', () => {
    expect(outfitSpecialTotal(special({}))).toBe(0);
    expect(outfitSpecialTotal(special({ S: 3, A: 2 }))).toBe(5);
    expect(outfitSpecialTotal(special({ S: 1, P: 1, E: 1, C: 1, I: 1, A: 1, L: 1 }))).toBe(7);
  });
});
