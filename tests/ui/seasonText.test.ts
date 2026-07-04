import { describe, it, expect } from 'vitest';
import type { SeasonReward } from '../../src/domain/model/seasonSchema.ts';
import type { GameData } from '../../src/domain/gamedata/gameData.ts';
import {
  cellKey,
  rewardIcon,
  rewardTitle,
  rewardTypeLabel,
  seasonLabel,
} from '../../src/ui/components/season/seasonText.ts';

// Pure presentation helpers behind the Season board / reward detail / switcher. No React -
// these are exercised here directly so the board/detail tests don't have to re-prove naming.

function makeReward(over: Partial<SeasonReward> & Pick<SeasonReward, 'rewardType'>): SeasonReward {
  return {
    id: 1,
    isPrestige: false,
    dataValInt: 0,
    dataValString: '',
    claimedList: [],
    levelRequired: 1,
    ...over,
  };
}

// Minimal game-data stand-in: only the id→entry maps the resolver reads (cast to GameData
// since the helpers only ever touch `.name` off these three maps).
const gameData = {
  weaponById: new Map([['Laser', { name: 'Laser Pistol' }]]),
  outfitById: new Map([['Suit', { name: 'Vault Suit' }]]),
  petById: new Map([['boxer_r', { name: 'Boxer' }]]),
} as unknown as GameData;

describe('seasonText.seasonLabel', () => {
  it('splits camel-case and trailing digits into spaced words', () => {
    expect(seasonLabel('NewVegasA')).toBe('New Vegas A');
    expect(seasonLabel('UltraciteFever')).toBe('Ultracite Fever');
    expect(seasonLabel('Enclave')).toBe('Enclave');
    expect(seasonLabel('76Overseer')).toBe('76 Overseer');
  });
});

describe('seasonText.rewardTypeLabel', () => {
  it('maps each known reward type to a friendly label', () => {
    expect(rewardTypeLabel('caps')).toBe('Caps');
    expect(rewardTypeLabel('stimpack')).toBe('Stimpaks');
    expect(rewardTypeLabel('lunchbox')).toBe('Lunchbox');
    expect(rewardTypeLabel('weapon')).toBe('Weapon');
    expect(rewardTypeLabel('outfit')).toBe('Outfit');
    expect(rewardTypeLabel('pet')).toBe('Pet');
    expect(rewardTypeLabel('dweller')).toBe('Dweller');
    expect(rewardTypeLabel('theme')).toBe('Theme');
  });

  it('renders the inert "[Type]" placeholder / unknown types as an em dash', () => {
    expect(rewardTypeLabel('[Type]')).toBe('–');
    expect(rewardTypeLabel('mystery')).toBe('–');
  });
});

describe('seasonText.rewardIcon', () => {
  it('returns an atlas descriptor for item rewards', () => {
    expect(rewardIcon(makeReward({ rewardType: 'weapon', dataValString: 'Laser' }))).toEqual({
      type: 'weapons',
      id: 'Laser',
    });
    expect(rewardIcon(makeReward({ rewardType: 'outfit', dataValString: 'Suit' }))).toEqual({
      type: 'outfits',
      id: 'Suit',
    });
    expect(rewardIcon(makeReward({ rewardType: 'pet', dataValString: 'boxer_r' }))).toEqual({
      type: 'pets',
      id: 'boxer_r',
    });
  });

  it('adds the season card art as a fallback for item rewards that carry an icon', () => {
    expect(
      rewardIcon(makeReward({ rewardType: 'weapon', dataValString: 'Laser', icon: 'BP_Laser' })),
    ).toEqual({
      type: 'weapons',
      id: 'Laser',
      fallback: { type: 'season', id: 'BP_Laser' },
    });
  });

  it('uses the season card art for caps / stimpaks / lunchboxes / dwellers', () => {
    expect(
      rewardIcon(makeReward({ rewardType: 'caps', dataValInt: 500, icon: 'BP_Caps' })),
    ).toEqual({ type: 'season', id: 'BP_Caps' });
    expect(
      rewardIcon(makeReward({ rewardType: 'stimpack', dataValInt: 3, icon: 'BP_Stimpack' })),
    ).toEqual({ type: 'season', id: 'BP_Stimpack' });
    expect(
      rewardIcon(
        makeReward({ rewardType: 'lunchbox', dataValString: 'mrhandy', icon: 'BP_MrHandy' }),
      ),
    ).toEqual({ type: 'season', id: 'BP_MrHandy' });
    expect(
      rewardIcon(
        makeReward({ rewardType: 'dweller', dataValString: 'Stephanie', icon: 'BP_Stephanie' }),
      ),
    ).toEqual({ type: 'season', id: 'BP_Stephanie' });
  });

  it('prefers per-theme art for themes, falling back to the generic card', () => {
    expect(
      rewardIcon(
        makeReward({
          rewardType: 'theme',
          dataValString: 'SunsetSarsaparilla',
          icon: 'BP_Theme',
        }),
      ),
    ).toEqual({
      type: 'season',
      id: 'theme:SunsetSarsaparilla',
      fallback: { type: 'season', id: 'BP_Theme' },
    });
  });

  it('returns null for rewards with neither an item id nor an icon sprite', () => {
    expect(rewardIcon(makeReward({ rewardType: 'caps', dataValInt: 500 }))).toBeNull();
    expect(rewardIcon(makeReward({ rewardType: '[Type]' }))).toBeNull();
  });
});

describe('seasonText.rewardTitle', () => {
  it('formats quantity rewards with thousands separators and pluralization', () => {
    expect(rewardTitle(makeReward({ rewardType: 'caps', dataValInt: 1500 }), null)).toBe(
      '1,500 Caps',
    );
    expect(rewardTitle(makeReward({ rewardType: 'stimpack', dataValInt: 1 }), null)).toBe(
      '1 Stimpak',
    );
    expect(rewardTitle(makeReward({ rewardType: 'stimpack', dataValInt: 3 }), null)).toBe(
      '3 Stimpaks',
    );
  });

  it('names lunchbox sub-types and prefixes a multiplier above one', () => {
    expect(
      rewardTitle(makeReward({ rewardType: 'lunchbox', dataValString: 'regular' }), null),
    ).toBe('Lunchbox');
    expect(
      rewardTitle(makeReward({ rewardType: 'lunchbox', dataValString: 'mrhandy' }), null),
    ).toBe('Mr. Handy Lunchbox');
    expect(
      rewardTitle(
        makeReward({ rewardType: 'lunchbox', dataValString: 'petcarrier', dataValInt: 2 }),
        null,
      ),
    ).toBe('2× Pet Carrier');
  });

  it('resolves item names through game data when present', () => {
    expect(
      rewardTitle(makeReward({ rewardType: 'weapon', dataValString: 'Laser' }), gameData),
    ).toBe('Laser Pistol');
    expect(rewardTitle(makeReward({ rewardType: 'outfit', dataValString: 'Suit' }), gameData)).toBe(
      'Vault Suit',
    );
    expect(rewardTitle(makeReward({ rewardType: 'pet', dataValString: 'boxer_r' }), gameData)).toBe(
      'Boxer',
    );
  });

  it('falls back to the raw dataValString when game data is absent or unknown', () => {
    expect(rewardTitle(makeReward({ rewardType: 'weapon', dataValString: 'Laser' }), null)).toBe(
      'Laser',
    );
    expect(
      rewardTitle(makeReward({ rewardType: 'pet', dataValString: 'unknown_pet' }), gameData),
    ).toBe('unknown_pet');
    expect(
      rewardTitle(makeReward({ rewardType: 'dweller', dataValString: 'Orion Moreno' }), gameData),
    ).toBe('Orion Moreno');
  });
});

describe('seasonText.cellKey', () => {
  it('builds a stable track:id key', () => {
    expect(cellKey('premium', 528977600)).toBe('premium:528977600');
    expect(cellKey('free', 42)).toBe('free:42');
  });
});
