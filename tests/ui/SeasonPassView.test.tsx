import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeasonPassView } from '../../src/ui/views/SeasonPassView.tsx';
import { useSaveStore } from '../../src/state/saveStore.ts';
import { useToastStore } from '../../src/state/toastStore.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import { isRewardClaimed } from '../../src/domain/ops/seasonOps.ts';

// Integration test for the Season tab orchestrator. Game data + the season catalog are mocked
// (the lazy hooks): the catalog is a hand-built two-season model, and game data is a minimal
// resolver stand-in - every reward used here is a resource type (caps/stimpack), which the
// resolver grants without touching the item maps, so no atlas/ItemIcon is needed.
const { catalog, fakeGameData } = vi.hoisted(() => {
  const reward = (
    id: number,
    rewardType: string,
    levelRequired: number,
    dataValInt = 0,
    dataValString = 'none',
  ) => ({ id, isPrestige: false, rewardType, dataValInt, dataValString, icon: 'X', levelRequired });
  const seasons = [
    {
      id: 'NewVegasA',
      maxRank: 3,
      tokenRequirements: [0, 3, 5, 6],
      basePassTokens: 0,
      premiumPassTokens: 25,
      freeRewards: [reward(101, 'caps', 1, 300), reward(102, 'caps', 2, 400)],
      premiumRewards: [reward(201, 'stimpack', 1, 3), reward(202, 'caps', 3, 700)],
    },
    {
      id: 'Institute',
      maxRank: 3,
      tokenRequirements: [0, 3, 5, 6],
      basePassTokens: 0,
      premiumPassTokens: 25,
      freeRewards: [reward(301, 'caps', 1, 500), reward(302, 'caps', 2, 600)],
      premiumRewards: [reward(401, 'caps', 2, 700)],
    },
  ];
  return {
    catalog: {
      ncqReward: null,
      seasons,
      seasonIds: seasons.map((s) => s.id),
      seasonById: new Map(seasons.map((s) => [s.id, s])),
    },
    fakeGameData: {
      weaponById: new Map(),
      outfitById: new Map(),
      petById: new Map(),
      uniqueDwellers: {},
    },
  };
});

vi.mock('../../src/ui/hooks/useGameData.ts', () => ({
  useGameData: () => ({ data: fakeGameData, status: 'ready', error: null }),
}));
vi.mock('../../src/ui/hooks/useSeasonCatalog.ts', () => ({
  useSeasonCatalog: () => ({ data: catalog, status: 'ready', error: null }),
}));

function makeSave(): SaveData {
  return {
    dwellers: { dwellers: [{ serializeId: 1, name: 'A' }], id: 1 },
    vault: { VaultName: '001', storage: { resources: { Nuka: 100 } }, inventory: { items: [] } },
    appVersion: '2.4.1',
  } as SaveData;
}

/** Reset the store, load a save, and (unless onboarding) build the catalog season model. */
function setup({ withSeason = true }: { withSeason?: boolean } = {}) {
  useSaveStore.getState().clear();
  useToastStore.setState({ toasts: [] });
  useSaveStore.setState({ save: makeSave(), fileName: 'Vault1.sav', status: 'loaded' });
  if (withSeason) useSaveStore.getState().startSeasonFromCatalog(catalog);
}

beforeEach(() => setup());

describe('SeasonPassView - onboarding', () => {
  it('"Continue" builds a catalog model and flips the source to catalog', async () => {
    setup({ withSeason: false });
    const user = userEvent.setup();
    render(<SeasonPassView />);

    // Onboarding is shown until a source is chosen.
    expect(screen.getByRole('heading', { name: 'Season Pass' })).toBeInTheDocument();
    expect(useSaveStore.getState().seasonSource).toBe('none');

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const s = useSaveStore.getState();
    expect(s.seasonSource).toBe('catalog');
    expect(s.seasonSave?.currentSeason).toBe('Institute'); // last catalog season
    // The workspace replaces onboarding: the export bar + season switcher appear.
    expect(screen.getByText(/New season pass/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Institute/ })).toBeInTheDocument();
  });
});

describe('SeasonPassView - claiming on the board', () => {
  it('clicking an unclaimed free cell claims it in one undo step and sets seasonEdited', async () => {
    const user = userEvent.setup();
    render(<SeasonPassView />);

    // Active season is Institute; its free rank-1 reward is 500 caps (id 301).
    await user.click(screen.getByRole('button', { name: /^Rank 1 free/ }));

    const s = useSaveStore.getState();
    expect(s.past).toHaveLength(1); // ONE combined undo entry
    expect(s.seasonEdited).toBe(true);
    expect(s.save?.vault?.storage?.resources?.Nuka).toBe(600); // 100 + 500 granted
    expect(isRewardClaimed(s.seasonSave!.seasonsData!.Institute.freeRewardsList![0])).toBe(true);
  });

  it('clicking a premium-locked cell does not claim (toast path, no undo step)', async () => {
    const user = userEvent.setup();
    render(<SeasonPassView />);

    await user.click(screen.getByRole('button', { name: /^Rank 2 premium/ }));

    const s = useSaveStore.getState();
    expect(s.past).toHaveLength(0); // nothing claimed
    expect(s.seasonEdited).toBe(false);
    expect(isRewardClaimed(s.seasonSave!.seasonsData!.Institute.premiumRewardsList![0])).toBe(
      false,
    );
    // A guidance toast was raised instead.
    expect(useToastStore.getState().toasts.some((t) => /premium/i.test(t.message))).toBe(true);
  });
});

describe('SeasonPassView - viewed vs active season', () => {
  it('switching the viewed season via a pill does not push an undo step', async () => {
    const user = userEvent.setup();
    render(<SeasonPassView />);

    await user.click(screen.getByRole('button', { name: 'New Vegas A' }));

    expect(useSaveStore.getState().past).toHaveLength(0);
    // Viewing a non-active season reveals the "Make active" affordance.
    expect(screen.getByRole('button', { name: 'Make active' })).toBeInTheDocument();
  });

  it('"Make active" runs switchSeason, syncing spd.currentSeason and nvf', async () => {
    const user = userEvent.setup();
    render(<SeasonPassView />);

    await user.click(screen.getByRole('button', { name: 'New Vegas A' }));
    await user.click(screen.getByRole('button', { name: 'Make active' }));

    const s = useSaveStore.getState();
    expect(s.past).toHaveLength(1);
    expect(s.seasonSave?.currentSeason).toBe('NewVegasA');
    expect(s.nvf?.season?.id).toBe('NewVegasA');
  });
});
