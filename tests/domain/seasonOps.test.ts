import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import type { NvfData, SeasonReward, SeasonSave } from '../../src/domain/model/seasonSchema.ts';
import type { Pet, UniqueDweller } from '../../src/domain/gamedata/schemas.ts';
import { parseSeasonCatalog } from '../../src/domain/gamedata/seasonCatalog.ts';
import {
  buildFreshNvf,
  buildFreshSeasonSave,
  claimAll,
  claimReward,
  claimUnclaimed,
  grantPassTokens,
  isRewardClaimed,
  maxSeason,
  setLevel,
  setPremium,
  setPremiumPlus,
  switchSeason,
  toggleReward,
  unclaimReward,
  type RewardResolverData,
  type SeasonWorkspace,
  advanceSeasonClock,
  resetSeasonClock,
  seasonClockOffsetDays,
  skipToSeasonEnd,
} from '../../src/domain/ops/seasonOps.ts';

// --- fixtures -------------------------------------------------------------------

function makeReward(over: Partial<SeasonReward> & Pick<SeasonReward, 'id'>): SeasonReward {
  return {
    isPrestige: false,
    rewardType: 'caps',
    dataValInt: 0,
    dataValString: 'none',
    claimedList: [],
    levelRequired: 1,
    ...over,
  };
}

function makePet(over: Partial<Pet> = {}): Pet {
  return {
    id: 'boxer_r',
    name: 'Boxer',
    baseName: 'Boxer',
    breed: 'boxer',
    breedCode: 0,
    type: 'dog',
    typeCode: 0,
    rarity: 'Rare',
    rarityCode: 0,
    bonus: 'DamageBoost',
    bonusCode: 0,
    bonusMin: 1,
    bonusMax: 5,
    sprite: '',
    headSprite: '',
    poolName: '',
    codeId: 0,
    sellPrice: 0,
    petCarrierOdds: 0,
    descriptionLocalization: '',
    isHidden: false,
    craftOnly: false,
    lunchboxOnly: false,
    sortIndex: 0,
    ...over,
  };
}

function makeUnique(over: Partial<UniqueDweller> = {}): UniqueDweller {
  return {
    ascendancyId: -1,
    name: 'Conrad',
    lastName: 'Kellogg',
    gender: 2,
    hair: null,
    faceMask: null,
    outfitId: 'TestOutfit',
    weaponId: 'TestWeapon',
    skinColor: 0,
    hairColor: 0,
    stats: [1, 1, 1, 1, 1, 1, 1],
    isInfertile: false,
    randomBody: false,
    randomName: false,
    ...over,
  };
}

function makeData(): RewardResolverData {
  return {
    weaponById: new Map([['TestWeapon', { id: 'TestWeapon' }]]),
    outfitById: new Map([['TestOutfit', { id: 'TestOutfit' }]]),
    petById: new Map([['boxer_r', makePet()]]),
    uniqueDwellers: { L_ConradKellogg: makeUnique() },
  };
}

// Reward ids per track.
const FREE = { caps: 101, lunchbox: 102, weapon: 103, theme: 104 };
const PREM = { stimpack: 201, outfit: 202, pet: 203, dweller: 204 };

function makeSpd(): SeasonSave {
  return {
    schemaVersion: 2,
    currentSeason: 'TestSeason',
    currentLevel: 1,
    currentTokens: 0,
    battlepassWindowLastObservedLevel: 1,
    seasonsData: {
      TestSeason: {
        isPremium: false,
        isPremiumPlus: false,
        maxRankAchieved: 0,
        freeRewardsList: [
          makeReward({ id: FREE.caps, rewardType: 'caps', dataValInt: 700, levelRequired: 3 }),
          makeReward({
            id: FREE.lunchbox,
            rewardType: 'lunchbox',
            dataValString: 'regular',
            dataValInt: 1,
            levelRequired: 2,
          }),
          makeReward({
            id: FREE.weapon,
            rewardType: 'weapon',
            dataValString: 'TestWeapon',
            levelRequired: 8,
          }),
          makeReward({
            id: FREE.theme,
            rewardType: 'theme',
            dataValString: 'TestTheme',
            levelRequired: 4,
          }),
        ],
        premiumRewardsList: [
          makeReward({
            id: PREM.stimpack,
            rewardType: 'stimpack',
            dataValInt: 3,
            levelRequired: 1,
          }),
          makeReward({
            id: PREM.outfit,
            rewardType: 'outfit',
            dataValString: 'TestOutfit',
            levelRequired: 6,
          }),
          makeReward({
            id: PREM.pet,
            rewardType: 'pet',
            dataValString: 'boxer_r',
            levelRequired: 5,
          }),
          makeReward({
            id: PREM.dweller,
            rewardType: 'dweller',
            dataValString: 'Conrad Kellogg',
            levelRequired: 10,
          }),
        ],
      },
      OtherSeason: { freeRewardsList: [], premiumRewardsList: [] },
    },
  };
}

function makeSave(): SaveData {
  return {
    dwellers: {
      // Pre-owned Conrad Kellogg, to prove a claimed duplicate's unclaim leaves it untouched.
      dwellers: [
        { serializeId: 1, name: 'Conrad', lastName: 'Kellogg', uniqueData: 'L_ConradKellogg' },
      ],
      id: 1,
    },
    vault: {
      VaultName: '001',
      storage: { resources: { Nuka: 100, StimPack: 5 } },
      inventory: { items: [] },
      LunchBoxesByType: [],
      LunchBoxesCount: 0,
    },
    survivalW: { recipes: ['OwnedTheme'] },
    appVersion: '2.4.1',
  };
}

function makeWorkspace(): SeasonWorkspace {
  const nvf: NvfData = { season: { id: 'TestSeason', type: 2 } };
  return { save: makeSave(), spd: makeSpd(), nvf, handles: {} };
}

function rewardOf(ws: SeasonWorkspace, track: 'free' | 'premium', id: number): SeasonReward {
  const record = ws.spd.seasonsData!.TestSeason;
  const list = track === 'free' ? record.freeRewardsList! : record.premiumRewardsList!;
  return list.find((r) => r.id === id)!;
}

function items(ws: SeasonWorkspace) {
  return ws.save.vault?.inventory?.items ?? [];
}

// --- claim / unclaim by reward type ---------------------------------------------

describe('seasonOps claim/unclaim - resource rewards', () => {
  it('caps: claim adds dataValInt to Nuka and flags claimed; unclaim reverts', () => {
    const data = makeData();
    const claimed = claimReward(makeWorkspace(), data, 'TestSeason', 'free', FREE.caps);
    expect(claimed.save.vault?.storage?.resources?.Nuka).toBe(800);
    expect(isRewardClaimed(rewardOf(claimed, 'free', FREE.caps))).toBe(true);

    const back = unclaimReward(claimed, 'TestSeason', 'free', FREE.caps);
    expect(back.save.vault?.storage?.resources?.Nuka).toBe(100);
    expect(isRewardClaimed(rewardOf(back, 'free', FREE.caps))).toBe(false);
  });

  it('stimpack: claim adds to StimPack; unclaim reverts (clamped ≥0)', () => {
    const data = makeData();
    const claimed = claimReward(makeWorkspace(), data, 'TestSeason', 'premium', PREM.stimpack);
    expect(claimed.save.vault?.storage?.resources?.StimPack).toBe(8);
    const back = unclaimReward(claimed, 'TestSeason', 'premium', PREM.stimpack);
    expect(back.save.vault?.storage?.resources?.StimPack).toBe(5);
  });

  it('lunchbox: claim adds a consumable; unclaim removes it', () => {
    const data = makeData();
    const claimed = claimReward(makeWorkspace(), data, 'TestSeason', 'free', FREE.lunchbox);
    expect(claimed.save.vault?.LunchBoxesByType).toEqual([0]);
    const back = unclaimReward(claimed, 'TestSeason', 'free', FREE.lunchbox);
    expect(back.save.vault?.LunchBoxesByType).toEqual([]);
  });
});

describe('seasonOps claim/unclaim - item rewards', () => {
  it('weapon: claim grants one stored weapon; unclaim removes exactly one', () => {
    const data = makeData();
    const claimed = claimReward(makeWorkspace(), data, 'TestSeason', 'free', FREE.weapon);
    expect(items(claimed).filter((i) => i.type === 'Weapon' && i.id === 'TestWeapon')).toHaveLength(
      1,
    );
    const back = unclaimReward(claimed, 'TestSeason', 'free', FREE.weapon);
    expect(items(back)).toHaveLength(0);
  });

  it('outfit: claim grants one stored outfit; unclaim removes it', () => {
    const data = makeData();
    const claimed = claimReward(makeWorkspace(), data, 'TestSeason', 'premium', PREM.outfit);
    expect(items(claimed)).toHaveLength(1);
    const back = unclaimReward(claimed, 'TestSeason', 'premium', PREM.outfit);
    expect(items(back)).toHaveLength(0);
  });

  it('pet: claim grants a pet instance (best roll); unclaim removes it', () => {
    const data = makeData();
    const claimed = claimReward(makeWorkspace(), data, 'TestSeason', 'premium', PREM.pet);
    const pet = items(claimed).find((i) => i.type === 'Pet');
    expect(pet?.id).toBe('boxer_r');
    expect(pet?.extraData?.bonusValue).toBe(5); // bonusMax
    const back = unclaimReward(claimed, 'TestSeason', 'premium', PREM.pet);
    expect(items(back).some((i) => i.type === 'Pet')).toBe(false);
  });
});

describe('seasonOps claim/unclaim - dweller (exact-instance reversal)', () => {
  it('claim adds a duplicate dweller; unclaim removes only the added one', () => {
    const data = makeData();
    const ws = makeWorkspace();
    expect(ws.save.dwellers?.dwellers).toHaveLength(1);

    const claimed = claimReward(ws, data, 'TestSeason', 'premium', PREM.dweller);
    const after = claimed.save.dwellers?.dwellers ?? [];
    expect(after).toHaveLength(2);
    const addedId = claimed.save.dwellers?.id;
    expect(addedId).toBe(2);

    const back = unclaimReward(claimed, 'TestSeason', 'premium', PREM.dweller);
    const left = back.save.dwellers?.dwellers ?? [];
    expect(left).toHaveLength(1);
    // The ORIGINAL (serializeId 1) survives; only the claimed instance (2) is removed.
    expect(left[0].serializeId).toBe(1);
  });
});

describe('seasonOps dweller resolution (name nuances)', () => {
  it('resolves a dweller whose whole display name lives in `name` alone (no lastName)', () => {
    // "Ghoul King" / "Scribe Valdez" / "76 Overseer" carry the full name in `name`; the
    // resolver must fall back to a whole-name-in-`name` match when "name + lastName" misses.
    const data: RewardResolverData = {
      weaponById: new Map(),
      outfitById: new Map(),
      petById: new Map(),
      uniqueDwellers: { L_GhoulKing: makeUnique({ name: 'Ghoul King', lastName: '' }) },
    };
    const ws = makeWorkspace();
    ws.spd.seasonsData!.TestSeason.premiumRewardsList![3] = makeReward({
      id: PREM.dweller,
      rewardType: 'dweller',
      dataValString: 'Ghoul King',
      levelRequired: 10,
    });

    const claimed = claimReward(ws, data, 'TestSeason', 'premium', PREM.dweller);
    const added = claimed.save.dwellers?.dwellers ?? [];
    expect(added.some((d) => d.name === 'Ghoul King')).toBe(true);
  });

  it('an unresolved dweller name claims as a flag-only flip (no .sav change, exact unclaim)', () => {
    const data = makeData(); // only knows Conrad Kellogg
    const ws = makeWorkspace();
    ws.spd.seasonsData!.TestSeason.premiumRewardsList![3] = makeReward({
      id: PREM.dweller,
      rewardType: 'dweller',
      dataValString: 'Nobody Here',
      levelRequired: 10,
    });
    const startCount = ws.save.dwellers?.dwellers?.length;

    const claimed = claimReward(ws, data, 'TestSeason', 'premium', PREM.dweller);
    expect(claimed.save.dwellers?.dwellers).toHaveLength(startCount!); // nothing granted
    expect(isRewardClaimed(rewardOf(claimed, 'premium', PREM.dweller))).toBe(true); // but claimed

    const back = unclaimReward(claimed, 'TestSeason', 'premium', PREM.dweller);
    expect(back.save.dwellers?.dwellers).toHaveLength(startCount!); // still untouched
    expect(isRewardClaimed(rewardOf(back, 'premium', PREM.dweller))).toBe(false);
  });
});

describe('seasonOps claim/unclaim - theme (added vs already-owned)', () => {
  it('theme not yet known: claim adds the recipe; unclaim removes it', () => {
    const data = makeData();
    const claimed = claimReward(makeWorkspace(), data, 'TestSeason', 'free', FREE.theme);
    expect(claimed.save.survivalW?.recipes).toContain('TestTheme');
    const back = unclaimReward(claimed, 'TestSeason', 'free', FREE.theme);
    expect(back.save.survivalW?.recipes).not.toContain('TestTheme');
  });

  it('theme already owned: unclaim leaves the user-owned recipe in place', () => {
    const data = makeData();
    const ws = makeWorkspace();
    // Re-point the theme reward at the already-owned recipe.
    ws.spd.seasonsData!.TestSeason.freeRewardsList![3] = makeReward({
      id: FREE.theme,
      rewardType: 'theme',
      dataValString: 'OwnedTheme',
      levelRequired: 4,
    });
    const claimed = claimReward(ws, data, 'TestSeason', 'free', FREE.theme);
    const back = unclaimReward(claimed, 'TestSeason', 'free', FREE.theme);
    expect(back.save.survivalW?.recipes).toContain('OwnedTheme');
  });
});

describe('seasonOps unclaim - pre-claimed import without a handle', () => {
  it('only clears the flag, never touching the user .sav', () => {
    const ws = makeWorkspace();
    // Simulate an uploaded file where the reward was already claimed by the game.
    ws.spd.seasonsData!.TestSeason.freeRewardsList![0].claimedList = [0];
    const startNuka = ws.save.vault?.storage?.resources?.Nuka;

    const back = unclaimReward(ws, 'TestSeason', 'free', FREE.caps);
    expect(isRewardClaimed(rewardOf(back, 'free', FREE.caps))).toBe(false);
    expect(back.save.vault?.storage?.resources?.Nuka).toBe(startNuka); // untouched
  });
});

// --- no-op / idempotence --------------------------------------------------------

describe('seasonOps no-op contract', () => {
  it('claiming an already-claimed reward returns the same workspace reference', () => {
    const data = makeData();
    const claimed = claimReward(makeWorkspace(), data, 'TestSeason', 'free', FREE.caps);
    expect(claimReward(claimed, data, 'TestSeason', 'free', FREE.caps)).toBe(claimed);
  });

  it('unclaiming an unclaimed reward returns the same workspace reference', () => {
    const ws = makeWorkspace();
    expect(unclaimReward(ws, 'TestSeason', 'free', FREE.caps)).toBe(ws);
  });

  it('toggle flips claim state', () => {
    const data = makeData();
    const on = toggleReward(makeWorkspace(), data, 'TestSeason', 'free', FREE.caps);
    expect(isRewardClaimed(rewardOf(on, 'free', FREE.caps))).toBe(true);
    const off = toggleReward(on, data, 'TestSeason', 'free', FREE.caps);
    expect(isRewardClaimed(rewardOf(off, 'free', FREE.caps))).toBe(false);
  });
});

// --- batch helpers --------------------------------------------------------------

describe('seasonOps batch', () => {
  it('claimUnclaimed claims only the free track while premium is locked', () => {
    const data = makeData();
    const ws = claimUnclaimed(makeWorkspace(), data, 'TestSeason');
    const free = ws.spd.seasonsData!.TestSeason.freeRewardsList!;
    const prem = ws.spd.seasonsData!.TestSeason.premiumRewardsList!;
    expect(free.every(isRewardClaimed)).toBe(true);
    expect(prem.every((r) => !isRewardClaimed(r))).toBe(true);
  });

  it('claimUnclaimed claims premium too once premium is unlocked', () => {
    const data = makeData();
    let ws = setPremium(makeWorkspace(), 'TestSeason', true);
    ws = claimUnclaimed(ws, data, 'TestSeason');
    const prem = ws.spd.seasonsData!.TestSeason.premiumRewardsList!;
    expect(prem.every(isRewardClaimed)).toBe(true);
  });

  it('claimAll unlocks premium+plus and claims both tracks', () => {
    const data = makeData();
    const ws = claimAll(makeWorkspace(), data, 'TestSeason');
    const record = ws.spd.seasonsData!.TestSeason;
    expect(record.isPremium).toBe(true);
    expect(record.isPremiumPlus).toBe(true);
    expect(record.freeRewardsList!.every(isRewardClaimed)).toBe(true);
    expect(record.premiumRewardsList!.every(isRewardClaimed)).toBe(true);
  });

  it('maxSeason claims all, sets maxRankAchieved + active-season level to the cap', () => {
    const data = makeData();
    const ws = maxSeason(makeWorkspace(), data, 'TestSeason');
    const record = ws.spd.seasonsData!.TestSeason;
    expect(record.maxRankAchieved).toBe(10); // highest levelRequired
    expect(ws.spd.currentLevel).toBe(10);
    expect(ws.spd.battlepassWindowLastObservedLevel).toBe(10);
    expect(record.premiumRewardsList!.every(isRewardClaimed)).toBe(true);
  });
});

// --- status setters / season switch ---------------------------------------------

describe('seasonOps status + switch', () => {
  it('setLevel keeps battlepassWindowLastObservedLevel in lock-step', () => {
    const ws = setLevel(makeWorkspace(), 12);
    expect(ws.spd.currentLevel).toBe(12);
    expect(ws.spd.battlepassWindowLastObservedLevel).toBe(12);
  });

  it('setPremiumPlus(true) also unlocks premium', () => {
    const ws = setPremiumPlus(makeWorkspace(), 'TestSeason', true);
    expect(ws.spd.seasonsData!.TestSeason.isPremium).toBe(true);
    expect(ws.spd.seasonsData!.TestSeason.isPremiumPlus).toBe(true);
  });

  it('setPremium(false) clears premium-plus too', () => {
    let ws = setPremiumPlus(makeWorkspace(), 'TestSeason', true);
    ws = setPremium(ws, 'TestSeason', false);
    expect(ws.spd.seasonsData!.TestSeason.isPremium).toBe(false);
    expect(ws.spd.seasonsData!.TestSeason.isPremiumPlus).toBe(false);
  });

  it('switchSeason syncs spd.currentSeason and nvf.season.id, preserving nvf type', () => {
    const ws = switchSeason(makeWorkspace(), 'OtherSeason');
    expect(ws.spd.currentSeason).toBe('OtherSeason');
    expect(ws.nvf.season?.id).toBe('OtherSeason');
    expect(ws.nvf.season?.type).toBe(2); // preserved
  });
});

// --- pass purchase semantics (verified v2.4.1: ShopWindow / SeasonPassTokenManager /
// Vault.GrantEligibleSeasonalLunchboxes) ------------------------------------------

const claimsOf = (ws: SeasonWorkspace) => ws.spd.purchaseHistory?.SeasonPassLunchboxClaims ?? [];

describe('seasonOps purchase history (goodie-box delivery record)', () => {
  it('setPremium(true) records the purchase so the game grants the goodie box on load', () => {
    const ws = setPremium(makeWorkspace(), 'TestSeason', true);
    expect(claimsOf(ws)).toEqual([{ ID: 'TestSeason', Premium: true, PremiumPlus: false }]);
  });

  it('setPremiumPlus(true) records both tiers; toggling premium off removes the entry', () => {
    let ws = setPremiumPlus(makeWorkspace(), 'TestSeason', true);
    expect(claimsOf(ws)).toEqual([{ ID: 'TestSeason', Premium: true, PremiumPlus: true }]);
    ws = setPremium(ws, 'TestSeason', false);
    expect(claimsOf(ws)).toEqual([]);
  });

  it('downgrading plus to premium keeps the entry with PremiumPlus cleared', () => {
    let ws = setPremiumPlus(makeWorkspace(), 'TestSeason', true);
    ws = setPremiumPlus(ws, 'TestSeason', false);
    expect(claimsOf(ws)).toEqual([{ ID: 'TestSeason', Premium: true, PremiumPlus: false }]);
    expect(ws.spd.seasonsData!.TestSeason.isPremium).toBe(true);
  });

  it('leaves other seasons’ entries alone', () => {
    let ws = setPremium(makeWorkspace(), 'OtherSeason', true);
    ws = setPremiumPlus(ws, 'TestSeason', true);
    ws = setPremium(ws, 'TestSeason', false);
    expect(claimsOf(ws)).toEqual([{ ID: 'OtherSeason', Premium: true, PremiumPlus: false }]);
  });
});

describe('seasonOps grantPassTokens (the Premium Plus level skip)', () => {
  // The shipped per-level costs: level 1→2 costs 3, then 5, 6, 6, 10, …
  const REQS = [0, 3, 5, 6, 6, 10, 10, 10, 10, 10];

  it('25 tokens walk a fresh pass from level 1 to rank 5 with 5 tokens left', () => {
    const ws = grantPassTokens(makeWorkspace(), 'TestSeason', 25, REQS);
    expect(ws.spd.currentLevel).toBe(5);
    expect(ws.spd.currentTokens).toBe(5); // 25 - (3 + 5 + 6 + 6)
    expect(ws.spd.battlepassWindowLastObservedLevel).toBe(5);
    expect(ws.spd.seasonsData!.TestSeason.maxRankAchieved).toBe(5);
  });

  it('starts from the current level/tokens and never lowers maxRankAchieved', () => {
    let ws = setLevel(makeWorkspace(), 4);
    ws = {
      ...ws,
      spd: {
        ...ws.spd,
        seasonsData: {
          ...ws.spd.seasonsData,
          TestSeason: { ...ws.spd.seasonsData!.TestSeason, maxRankAchieved: 9 },
        },
      },
    };
    ws = grantPassTokens(ws, 'TestSeason', 6, REQS);
    expect(ws.spd.currentLevel).toBe(5); // 6 tokens cover the 6-token cost of level 4→5
    expect(ws.spd.currentTokens).toBe(0);
    expect(ws.spd.seasonsData!.TestSeason.maxRankAchieved).toBe(9);
  });

  it('is a no-op for a non-active season, at the rank cap, or without requirements', () => {
    const ws = makeWorkspace();
    expect(grantPassTokens(ws, 'OtherSeason', 25, REQS)).toBe(ws);
    expect(grantPassTokens(ws, 'TestSeason', 25, [])).toBe(ws);
    const capped = setLevel(ws, REQS.length);
    expect(grantPassTokens(capped, 'TestSeason', 25, REQS)).toBe(capped);
  });
});

// --- fresh model construction ---------------------------------------------------

describe('seasonOps fresh model', () => {
  const rawCatalog = {
    ncqReward: {
      id: 0,
      isPrestige: false,
      rewardType: '[Type]',
      dataValInt: 0,
      dataValString: '[Data]',
      icon: '[Icon]',
      levelRequired: 0,
    },
    seasons: [
      {
        id: 'S1',
        maxRank: 25,
        freeRewards: [
          {
            id: 11,
            isPrestige: false,
            rewardType: 'caps',
            dataValInt: 700,
            dataValString: 'none',
            icon: 'BP_Caps',
            levelRequired: 3,
          },
        ],
        premiumRewards: [
          {
            id: 21,
            isPrestige: false,
            rewardType: 'weapon',
            dataValInt: 0,
            dataValString: 'TestWeapon',
            icon: 'BP_W',
            levelRequired: 2,
          },
        ],
      },
    ],
  };

  it('buildFreshSeasonSave builds an unclaimed, level-1, no-premium model from the catalog', () => {
    const catalog = parseSeasonCatalog(rawCatalog);
    const spd = buildFreshSeasonSave(catalog);
    expect(spd.schemaVersion).toBe(2);
    expect(spd.currentSeason).toBe('S1');
    expect(spd.currentLevel).toBe(1);
    const record = spd.seasonsData!.S1;
    expect(record.isPremium).toBe(false);
    expect(record.freeRewardsList).toHaveLength(1);
    expect(record.freeRewardsList![0].claimedList).toEqual([]);
    expect(record.freeRewardsList![0].id).toBe(11); // ids verbatim from catalog
  });

  it('buildFreshNvf points at the catalog default season', () => {
    const catalog = parseSeasonCatalog(rawCatalog);
    expect(buildFreshNvf(catalog).season?.id).toBe('S1');
  });

  it('a fresh model is fully claimable end-to-end', () => {
    const data = makeData();
    const catalog = parseSeasonCatalog(rawCatalog);
    const ws: SeasonWorkspace = {
      save: makeSave(),
      spd: buildFreshSeasonSave(catalog),
      nvf: buildFreshNvf(catalog),
      handles: {},
    };
    const maxed = maxSeason(ws, data, 'S1');
    expect(maxed.spd.seasonsData!.S1.freeRewardsList!.every(isRewardClaimed)).toBe(true);
    expect(maxed.save.vault?.storage?.resources?.Nuka).toBe(800);
  });
});

describe('seasonOps - season clock (debugTimeOffset)', () => {
  const TICKS_PER_DAY = 86_400 * 10_000_000;

  it('advanceSeasonClock adds whole days of ticks + 1 (game AddGlobalTimeOffsetDays)', () => {
    const ws = makeWorkspace();
    const next = advanceSeasonClock(ws, 7);
    expect(next.spd.debugTimeOffset).toBe(7 * TICKS_PER_DAY + 1);
    const again = advanceSeasonClock(next, 1);
    expect(again.spd.debugTimeOffset).toBe(8 * TICKS_PER_DAY + 2);
    // Untouched subtrees shared; non-positive days is a no-op.
    expect(next.save).toBe(ws.save);
    expect(advanceSeasonClock(ws, 0)).toBe(ws);
    expect(advanceSeasonClock(ws, -3)).toBe(ws);
  });

  it('resetSeasonClock zeroes the offset and no-ops at zero', () => {
    const ws = makeWorkspace();
    expect(resetSeasonClock(ws)).toBe(ws);
    const moved = advanceSeasonClock(ws, 2);
    const reset = resetSeasonClock(moved);
    expect(reset.spd.debugTimeOffset).toBe(0);
    expect(seasonClockOffsetDays(reset.spd)).toBe(0);
  });

  it('skipToSeasonEnd sets offset = end - now + 1 and refuses past/absurd inputs', () => {
    const ws = makeWorkspace();
    const now = 638_000_000_000_000_000n;
    const end = now + 5n * BigInt(TICKS_PER_DAY);
    const next = skipToSeasonEnd(ws, end, now);
    expect(next.spd.debugTimeOffset).toBe(Number(5n * BigInt(TICKS_PER_DAY) + 1n));
    expect(seasonClockOffsetDays(next.spd)).toBe(5);
    expect(skipToSeasonEnd(ws, now - 1n, now)).toBe(ws); // season already over
    expect(skipToSeasonEnd(ws, now + 40n * 365n * 24n * 3_600n * 10_000_000n, now)).toBe(ws); // unsafe range
  });

  it('seasonClockOffsetDays floors partial days', () => {
    const ws = advanceSeasonClock(makeWorkspace(), 1);
    expect(seasonClockOffsetDays(ws.spd)).toBe(1);
    expect(seasonClockOffsetDays({} as SeasonSave)).toBe(0);
  });
});
