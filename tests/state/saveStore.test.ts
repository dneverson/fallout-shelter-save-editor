// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HISTORY_LIMIT,
  IMPORT_LABEL,
  selectCanRedo,
  selectCanUndo,
  selectHistory,
  selectRedoLabel,
  selectUndoLabel,
  useSaveStore,
} from '../../src/state/saveStore.ts';
import { decode, encode, decodeSeason } from '../../src/domain/codec/saveCodec.ts';
import { remove, setName } from '../../src/domain/ops/dwellerOps.ts';
import {
  claimReward,
  isRewardClaimed,
  type RewardResolverData,
  type SeasonWorkspace,
} from '../../src/domain/ops/seasonOps.ts';
import { parseSeasonCatalog } from '../../src/domain/gamedata/seasonCatalog.ts';

const FIXTURE = resolve(process.cwd(), 'Vault1.sav');

describe('saveStore import → export wiring', () => {
  beforeEach(() => {
    useSaveStore.getState().clear();
  });

  it('imports a synthetic save, populates metadata, and exports an identity round-trip', async () => {
    const original = {
      dwellers: { dwellers: [{ serializeId: 1, name: 'Test' }] },
      vault: {
        VaultName: '111',
        inventory: { items: [{ id: 'TeddyBear', type: 'Junk' }] },
        storage: { resources: { Nuka: 10 } },
      },
      appVersion: '1.0',
    };
    const savText = await encode(original);

    await useSaveStore.getState().importFromText(savText, 'Vault1.sav');
    const state = useSaveStore.getState();
    expect(state.status).toBe('loaded');
    expect(state.health?.metadata.vaultName).toBe('111');
    expect(state.health?.metadata.dwellerCount).toBe(1);

    expect(await decode(await state.exportSavText())).toEqual(original);
  });

  it('reports an error for unreadable input without retaining a partial save', async () => {
    await useSaveStore.getState().importFromText('not-valid-base64-or-cipher!!', 'broken.sav');
    const state = useSaveStore.getState();
    expect(state.status).toBe('error');
    expect(state.save).toBeNull();
    expect(state.error).toBeTruthy();
  });

  it.skipIf(!existsSync(FIXTURE))('round-trips the real Vault1.sav through the store', async () => {
    const savText = readFileSync(FIXTURE, 'utf8');
    await useSaveStore.getState().importFromText(savText, 'Vault1.sav');
    const state = useSaveStore.getState();
    expect(state.status).toBe('loaded');
    expect(state.health?.metadata.dwellerCount).toBeGreaterThan(0);

    const exported = await state.exportSavText();
    expect(await decode(exported)).toEqual(await decode(savText));
  });
});

describe('saveStore "Start fresh / sandbox" baseline', () => {
  const BASELINE = resolve(process.cwd(), 'public/baseline/Vault2.sav');

  beforeEach(() => {
    useSaveStore.getState().clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.skipIf(!existsSync(BASELINE))(
    'loads the bundled baseline as a working sandbox save',
    async () => {
      const baselineText = readFileSync(BASELINE, 'utf8');
      vi.stubGlobal('fetch', () =>
        Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(baselineText) }),
      );

      await useSaveStore.getState().importBaseline();
      const state = useSaveStore.getState();

      expect(state.status).toBe('loaded');
      expect(state.isSandbox).toBe(true);
      expect(state.fileName).toBe('Vault2.sav');
      expect(state.health?.metadata.vaultName).toBe('1');
      expect(state.health?.metadata.dwellerCount).toBe(15);
    },
  );

  it('reports an error and retains no save when the baseline fetch fails', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 }));

    await useSaveStore.getState().importBaseline();
    const state = useSaveStore.getState();

    expect(state.status).toBe('error');
    expect(state.save).toBeNull();
    expect(state.error).toBeTruthy();
    expect(state.isSandbox).toBe(false);
  });
});

describe('saveStore undo/redo', () => {
  async function importTwoDwellers(): Promise<void> {
    const original = {
      dwellers: {
        dwellers: [
          { serializeId: 1, name: 'Alice' },
          { serializeId: 2, name: 'Bob' },
        ],
      },
      vault: { VaultName: '111' },
      appVersion: '1.0',
    };
    await useSaveStore.getState().importFromText(await encode(original), 'Vault1.sav');
  }

  beforeEach(() => {
    useSaveStore.getState().clear();
  });

  it('applyEdit runs the op, advances the save, and records history', async () => {
    await importTwoDwellers();
    const before = useSaveStore.getState().save;

    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'Renamed'));
    const state = useSaveStore.getState();

    expect(state.save).not.toBe(before);
    expect(selectCanUndo(state)).toBe(true);
    expect(selectCanRedo(state)).toBe(false);
    expect(state.past).toHaveLength(1);
    expect(state.past[0]).toBe(before); // prior save snapshotted by reference
  });

  it('undo restores the prior save and redo re-applies', async () => {
    await importTwoDwellers();
    const original = useSaveStore.getState().save;

    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'Renamed'));
    const edited = useSaveStore.getState().save;

    useSaveStore.getState().undo();
    expect(useSaveStore.getState().save).toBe(original);
    expect(selectCanRedo(useSaveStore.getState())).toBe(true);

    useSaveStore.getState().redo();
    expect(useSaveStore.getState().save).toBe(edited);
    expect(selectCanRedo(useSaveStore.getState())).toBe(false);
  });

  it('a no-op edit does not grow history', async () => {
    await importTwoDwellers();
    useSaveStore.getState().applyEdit((s) => s); // returns the same reference
    expect(useSaveStore.getState().past).toHaveLength(0);
  });

  it('a new edit clears the redo stack', async () => {
    await importTwoDwellers();
    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'A'));
    useSaveStore.getState().undo();
    expect(selectCanRedo(useSaveStore.getState())).toBe(true);

    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'B'));
    expect(useSaveStore.getState().future).toHaveLength(0);
  });

  it('caps history at HISTORY_LIMIT, dropping the oldest', async () => {
    await importTwoDwellers();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      useSaveStore.getState().applyEdit((s) => setName(s, 1, `n${i}`));
    }
    expect(useSaveStore.getState().past).toHaveLength(HISTORY_LIMIT);
  });

  it('recomputes health on edit - remove decrements the dweller count', async () => {
    await importTwoDwellers();
    expect(useSaveStore.getState().health?.metadata.dwellerCount).toBe(2);

    useSaveStore.getState().applyEdit((s) => remove(s, 1));
    expect(useSaveStore.getState().health?.metadata.dwellerCount).toBe(1);

    useSaveStore.getState().undo();
    expect(useSaveStore.getState().health?.metadata.dwellerCount).toBe(2);
  });

  it('import resets undo/redo history', async () => {
    await importTwoDwellers();
    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'X'));
    expect(useSaveStore.getState().past.length).toBeGreaterThan(0);

    await importTwoDwellers();
    expect(useSaveStore.getState().past).toHaveLength(0);
    expect(useSaveStore.getState().future).toHaveLength(0);
  });

  it('applyEdit/undo/redo are inert with no save loaded', () => {
    const store = useSaveStore.getState();
    store.applyEdit((s) => s);
    store.undo();
    store.redo();
    expect(useSaveStore.getState().save).toBeNull();
  });
});

describe('saveStore history timeline', () => {
  async function importTwo(): Promise<void> {
    await useSaveStore.getState().importFromText(
      await encode({
        dwellers: { dwellers: [{ serializeId: 1, name: 'A' }] },
        appVersion: '1.0',
      }),
      'Vault1.sav',
    );
  }

  beforeEach(() => {
    useSaveStore.getState().clear();
  });

  it('records action labels and exposes them via the undo/redo selectors', async () => {
    await importTwo();
    expect(selectUndoLabel(useSaveStore.getState())).toBe(IMPORT_LABEL);

    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'B'), 'Set name');
    expect(selectUndoLabel(useSaveStore.getState())).toBe('Set name');

    useSaveStore.getState().undo();
    expect(selectRedoLabel(useSaveStore.getState())).toBe('Set name');
    expect(selectUndoLabel(useSaveStore.getState())).toBe(IMPORT_LABEL);
  });

  it('defaults an unlabeled edit to "Edit"', async () => {
    await importTwo();
    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'B'));
    expect(selectUndoLabel(useSaveStore.getState())).toBe('Edit');
  });

  it('selectHistory lists the labeled timeline with the current index', async () => {
    await importTwo();
    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'B'), 'Edit 1');
    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'C'), 'Edit 2');

    const view = selectHistory(useSaveStore.getState());
    expect(view.entries.map((e) => e.label)).toEqual([IMPORT_LABEL, 'Edit 1', 'Edit 2']);
    expect(view.currentIndex).toBe(2);
  });

  it('jumpTo moves to any prior point and keeps the redo tail', async () => {
    await importTwo();
    const states: unknown[] = [useSaveStore.getState().save];
    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'B'), 'Edit 1');
    states.push(useSaveStore.getState().save);
    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'C'), 'Edit 2');
    states.push(useSaveStore.getState().save);

    // Jump back to the imported state (index 0).
    useSaveStore.getState().jumpTo(0);
    expect(useSaveStore.getState().save).toBe(states[0]);
    expect(selectCanUndo(useSaveStore.getState())).toBe(false);
    expect(useSaveStore.getState().future).toHaveLength(2); // both edits redoable

    // Jump forward to the last state (index 2).
    useSaveStore.getState().jumpTo(2);
    expect(useSaveStore.getState().save).toBe(states[2]);
    expect(selectCanRedo(useSaveStore.getState())).toBe(false);

    // Out-of-range index is a no-op.
    useSaveStore.getState().jumpTo(99);
    expect(useSaveStore.getState().save).toBe(states[2]);
  });

  it('editing after a jump-back discards the steps after the jump point', async () => {
    await importTwo();
    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'B'), 'Edit 1');
    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'C'), 'Edit 2');
    useSaveStore.getState().jumpTo(1); // back to after Edit 1

    useSaveStore.getState().applyEdit((s) => setName(s, 1, 'D'), 'Edit 3');
    const view = selectHistory(useSaveStore.getState());
    expect(view.entries.map((e) => e.label)).toEqual([IMPORT_LABEL, 'Edit 1', 'Edit 3']);
    expect(useSaveStore.getState().future).toHaveLength(0);
  });
});

describe('saveStore season integration', () => {
  const RESOLVER: RewardResolverData = {
    weaponById: new Map(),
    outfitById: new Map(),
    petById: new Map(),
    uniqueDwellers: {},
  };
  const CATALOG = parseSeasonCatalog({
    ncqReward: null,
    seasons: [
      {
        id: 'S1',
        maxRank: 25,
        freeRewards: [
          {
            id: 11,
            isPrestige: false,
            rewardType: 'caps',
            dataValInt: 500,
            dataValString: 'none',
            icon: 'BP_Caps',
            levelRequired: 3,
          },
        ],
        premiumRewards: [],
      },
    ],
  });

  const claimCaps = (ws: SeasonWorkspace): SeasonWorkspace =>
    claimReward(ws, RESOLVER, 'S1', 'free', 11);

  async function importVaultAndSeason(): Promise<void> {
    const savText = await encode({
      dwellers: { dwellers: [{ serializeId: 1, name: 'A' }], id: 1 },
      vault: { VaultName: '001', storage: { resources: { Nuka: 100 } } },
      appVersion: '2.4.1',
    });
    await useSaveStore.getState().importFromText(savText, 'Vault1.sav');
    useSaveStore.getState().startSeasonFromCatalog(CATALOG);
  }

  beforeEach(() => {
    useSaveStore.getState().clear();
  });

  it('startSeasonFromCatalog loads a fresh, unedited catalog model', async () => {
    await importVaultAndSeason();
    const s = useSaveStore.getState();
    expect(s.seasonSave?.currentSeason).toBe('S1');
    expect(s.seasonSource).toBe('catalog');
    expect(s.seasonEdited).toBe(false);
    expect(s.nvf?.season?.id).toBe('S1');
  });

  it('applySeasonEdit claims in ONE combined undo step mutating both save and season', async () => {
    await importVaultAndSeason();
    useSaveStore.getState().applySeasonEdit(claimCaps, 'Claim caps');

    const s = useSaveStore.getState();
    expect(s.past).toHaveLength(1); // a single undo step
    expect(s.seasonEdited).toBe(true);
    expect(s.save?.vault?.storage?.resources?.Nuka).toBe(600); // 100 + 500
    expect(isRewardClaimed(s.seasonSave!.seasonsData!.S1.freeRewardsList![0])).toBe(true);
  });

  it('undo reverts BOTH models together; redo reapplies both', async () => {
    await importVaultAndSeason();
    useSaveStore.getState().applySeasonEdit(claimCaps, 'Claim caps');

    useSaveStore.getState().undo();
    let s = useSaveStore.getState();
    expect(s.save?.vault?.storage?.resources?.Nuka).toBe(100); // grant reverted
    expect(isRewardClaimed(s.seasonSave!.seasonsData!.S1.freeRewardsList![0])).toBe(false);
    expect(s.seasonEdited).toBe(false);

    useSaveStore.getState().redo();
    s = useSaveStore.getState();
    expect(s.save?.vault?.storage?.resources?.Nuka).toBe(600);
    expect(isRewardClaimed(s.seasonSave!.seasonsData!.S1.freeRewardsList![0])).toBe(true);
    expect(s.seasonEdited).toBe(true);
  });

  it('a no-op season recipe does not grow history', async () => {
    await importVaultAndSeason();
    useSaveStore.getState().applySeasonEdit((ws) => ws, 'noop');
    expect(useSaveStore.getState().past).toHaveLength(0);
  });

  it('exportSeasonText round-trips the working spd.dat model', async () => {
    await importVaultAndSeason();
    useSaveStore.getState().applySeasonEdit(claimCaps, 'Claim caps');
    const text = await useSaveStore.getState().exportSeasonText();
    const decoded = await decodeSeason(text);
    expect(isRewardClaimed(decoded.seasonsData!.S1.freeRewardsList![0])).toBe(true);
  });
});
