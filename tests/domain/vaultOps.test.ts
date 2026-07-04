// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  acceptWaiting,
  clearEmergencies,
  consumableCounts,
  isMysteriousStrangerShown,
  isStarterPackPurchased,
  maxResources,
  addRockAt,
  addUltraciteAt,
  removeRockAt,
  removeUltraciteAt,
  removeRocks,
  resources,
  roomsInEmergency,
  setConsumableCount,
  setMysteriousStranger,
  setStrangerTimers,
  setResource,
  setStarterPackPurchased,
  setVaultMode,
  setVaultName,
  setVaultTheme,
  unlockRecipes,
  unlockRooms,
  unlockThemes,
} from '../../src/domain/ops/vaultOps.ts';

// A representative vault + the top-level managers the quick actions edit, plus an
// untouched sibling so every test can assert structural sharing + immutability.
function makeSave(): SaveData {
  return {
    vault: {
      VaultName: '042',
      VaultMode: 'Normal',
      VaultTheme: 0,
      storage: { resources: { Nuka: 100, Food: 50, Water: 50, Energy: 50, StimPack: 5 } },
      LunchBoxesByType: [0, 0, 1],
      LunchBoxesCount: 3,
      rocks: [{ row: 1 }, { row: 2 }],
      rooms: [
        {
          type: 'WaterPlant',
          deserializeID: 1,
          mergeLevel: 1,
          level: 2,
          currentStateName: 'Working',
        },
        { type: 'Cafeteria', deserializeID: 2, mergeLevel: 1, level: 1, currentStateName: 'Fire' },
        { type: 'Storage', deserializeID: 3, mergeLevel: 1, level: 1, currentStateName: 'Idle' },
      ],
    },
    dwellerSpawner: { dwellersWaiting: [{ x: 1 }, { x: 2 }] },
    survivalW: {
      recipes: ['OldRecipe'],
      collectedThemes: {
        themeList: [
          { id: 'A', extraData: { partsCollectedCount: 3 } },
          { id: 'B', extraData: { partsCollectedCount: 9 } },
        ],
      },
    },
    unlockableMgr: { claimed: ['StorageUnlock'], completed: ['x'], objectivesInProgress: ['y'] },
    MysteriousStranger: { currentState: 'Hiding', canAppear: true, remainingTimeToAppear: 90 },
    someManagerWeNeverTouch: { nested: { a: [1, 2, 3] } },
  } as SaveData;
}

const snap = (s: SaveData): string => JSON.stringify(s);

describe('vaultOps - resources', () => {
  it('sets a single resource, floors at 0, and shares untouched subtrees', () => {
    const save = makeSave();
    const next = setResource(save, 'Food', 1234);
    expect(resources(next).Food).toBe(1234);
    expect(resources(next).Nuka).toBe(100);
    expect(next.someManagerWeNeverTouch).toBe(save.someManagerWeNeverTouch);
    expect(snap(save)).toBe(snap(makeSave())); // original untouched

    expect(resources(setResource(save, 'Food', -10)).Food).toBe(0);
  });

  it('is a no-op (same ref) when the value is unchanged', () => {
    const save = makeSave();
    expect(setResource(save, 'Food', 50)).toBe(save);
  });

  it('maxResources raises to cap in one edit but never lowers a higher value', () => {
    const save = makeSave();
    // Nuka(100) cap is 50 → kept at 100 (never reduced); Food(50) raised to 1600.
    const next = maxResources(save, { Food: 1600, Water: 1600, Energy: 6400, Nuka: 50 });
    expect(resources(next)).toMatchObject({ Food: 1600, Water: 1600, Energy: 6400, Nuka: 100 });
    expect(maxResources(save, { Food: 50 })).toBe(save); // already at/above cap
  });
});

describe('vaultOps - consumables', () => {
  it('reads per-code counts', () => {
    expect(consumableCounts(makeSave())).toEqual({ 0: 2, 1: 1 });
  });

  it('rebuilds LunchBoxesByType + Count ascending by code', () => {
    const next = setConsumableCount(makeSave(), 2, 3); // 3 PetCarriers
    expect(next.vault?.LunchBoxesByType).toEqual([0, 0, 1, 2, 2, 2]);
    expect(next.vault?.LunchBoxesCount).toBe(6);
  });

  it('removing a code drops its entries', () => {
    const next = setConsumableCount(makeSave(), 0, 0);
    expect(next.vault?.LunchBoxesByType).toEqual([1]);
    expect(next.vault?.LunchBoxesCount).toBe(1);
  });

  it('is a no-op when the count is unchanged', () => {
    const save = makeSave();
    expect(setConsumableCount(save, 0, 2)).toBe(save);
  });
});

describe('vaultOps - config', () => {
  it('zero-pads + clamps the vault name', () => {
    expect(setVaultName(makeSave(), 7).vault?.VaultName).toBe('007');
    expect(setVaultName(makeSave(), 5000).vault?.VaultName).toBe('999');
  });

  it('sets mode + theme', () => {
    expect(setVaultMode(makeSave(), 'Survival').vault?.VaultMode).toBe('Survival');
    expect(setVaultTheme(makeSave(), 2).vault?.VaultTheme).toBe(2);
    expect(setVaultMode(makeSave(), 'Normal')).toEqual(makeSave());
  });
});

describe('vaultOps - quick actions', () => {
  it('removes rocks (no-op when already empty)', () => {
    expect(removeRocks(makeSave()).vault?.rocks).toEqual([]);
    const empty = { vault: { rocks: [] } } as SaveData;
    expect(removeRocks(empty)).toBe(empty);
  });

  it('removeRockAt drops only the matching {r,c} cell', () => {
    const save = {
      vault: {
        rocks: [
          { r: 18, c: 2 },
          { r: 18, c: 10 },
          { r: 19, c: 5 },
        ],
      },
    } as unknown as SaveData;
    const out = removeRockAt(save, 18, 10);
    expect(out.vault?.rocks).toEqual([
      { r: 18, c: 2 },
      { r: 19, c: 5 },
    ]);
  });

  it('removeRockAt is a no-op (same ref) when no rock occupies the cell', () => {
    const save = { vault: { rocks: [{ r: 18, c: 2 }] } } as unknown as SaveData;
    expect(removeRockAt(save, 5, 5)).toBe(save);
    const noRocks = { vault: {} } as SaveData;
    expect(removeRockAt(noRocks, 1, 1)).toBe(noRocks);
  });

  it('addRockAt appends a {r,c} cell; no-op when already a rock there', () => {
    const save = { vault: { rocks: [{ r: 18, c: 2 }] } } as unknown as SaveData;
    const out = addRockAt(save, 19, 5);
    expect(out.vault?.rocks).toEqual([
      { r: 18, c: 2 },
      { r: 19, c: 5 },
    ]);
    expect(addRockAt(out, 19, 5)).toBe(out);
    // Missing rocks array: created.
    const bare = { vault: {} } as SaveData;
    expect(addRockAt(bare, 3, 3).vault?.rocks).toEqual([{ r: 3, c: 3 }]);
  });

  it('addUltraciteAt / removeUltraciteAt manage vault.ultracite cells', () => {
    const bare = { vault: {} } as SaveData;
    const withDeposit = addUltraciteAt(bare, 6, 0);
    expect(withDeposit.vault?.ultracite).toEqual([{ r: 6, c: 0 }]);
    expect(addUltraciteAt(withDeposit, 6, 0)).toBe(withDeposit); // no dupes
    const cleared = removeUltraciteAt(withDeposit, 6, 0);
    expect(cleared.vault?.ultracite).toEqual([]);
    expect(removeUltraciteAt(cleared, 6, 0)).toBe(cleared); // no-op
  });

  it('clears only emergency rooms, leaving Idle/Working', () => {
    const save = makeSave();
    expect(roomsInEmergency(save).map((r) => r.type)).toEqual(['Cafeteria']);
    const next = clearEmergencies(save);
    expect(next.vault?.rooms?.map((r) => r.currentStateName)).toEqual(['Working', 'Idle', 'Idle']);
    // WaterPlant (Working) + Storage (Idle) rows kept by reference.
    expect(next.vault?.rooms?.[0]).toBe(save.vault?.rooms?.[0]);
    expect(clearEmergencies(next)).toBe(next); // no remaining emergencies
  });

  it('accepts waiting dwellers', () => {
    expect(acceptWaiting(makeSave()).dwellerSpawner?.dwellersWaiting).toEqual([]);
  });

  it('fully collects all themes (partsCollectedCount = 9)', () => {
    const next = unlockThemes(makeSave());
    expect(
      next.survivalW?.collectedThemes?.themeList?.map((t) => t.extraData?.partsCollectedCount),
    ).toEqual([9, 9]);
  });

  it('unlocks recipes + rooms from the supplied catalog', () => {
    const recipes = unlockRecipes(makeSave(), ['R1', 'R2']);
    expect(recipes.survivalW?.recipes).toEqual(['R1', 'R2']);

    const rooms = unlockRooms(makeSave(), ['AUnlock', 'BUnlock']);
    expect(rooms.unlockableMgr?.claimed).toEqual(['AUnlock', 'BUnlock']);
    expect(rooms.unlockableMgr?.completed).toEqual([]);
    expect(rooms.unlockableMgr?.objectivesInProgress).toEqual([]);
  });
});

describe('vaultOps - mysterious stranger', () => {
  it('shows + hides, preserving timing keys', () => {
    const save = makeSave();
    expect(isMysteriousStrangerShown(save)).toBe(false);
    const shown = setMysteriousStranger(save, true);
    expect(shown.MysteriousStranger?.currentState).toBe('Appearing');
    expect(shown.MysteriousStranger?.canAppear).toBe(true);
    expect((shown.MysteriousStranger as Record<string, unknown>).remainingTimeToAppear).toBe(90);
    expect(isMysteriousStrangerShown(shown)).toBe(true);

    expect(setMysteriousStranger(save, false)).toBe(save); // already hiding
    expect(setMysteriousStranger(shown, false).MysteriousStranger?.currentState).toBe('Hiding');
  });

  it('setStrangerTimers writes clamped timers, preserving other keys', () => {
    const save = makeSave();
    const out = setStrangerTimers(save, { timeToAppear: 300, remainingTimeToAppear: -5 });
    expect(out.MysteriousStranger?.timeToAppear).toBe(300);
    expect(out.MysteriousStranger?.remainingTimeToAppear).toBe(0);
    expect(out.MysteriousStranger?.currentState).toBe(save.MysteriousStranger?.currentState);
    expect(setStrangerTimers(out, { timeToAppear: 300 })).toBe(out); // no-op
  });
});

describe('vaultOps - starter pack', () => {
  it('toggles isStarterPackPurchased, preserving other ShopWindow keys', () => {
    const save = {
      ...makeSave(),
      ShopWindow: { isStarterPackPurchased: false, hasStarterPackPopupShown: true },
    } as SaveData;
    expect(isStarterPackPurchased(save)).toBe(false);

    const purchased = setStarterPackPurchased(save, true);
    expect(isStarterPackPurchased(purchased)).toBe(true);
    // The unrelated popup flag rides through untouched.
    expect((purchased.ShopWindow as Record<string, unknown>).hasStarterPackPopupShown).toBe(true);

    expect(setStarterPackPurchased(save, false)).toBe(save); // already false - same reference
    expect(isStarterPackPurchased(setStarterPackPurchased(purchased, false))).toBe(false);
  });

  it('creates ShopWindow when absent and reports false for a save without it', () => {
    const save = makeSave();
    expect(isStarterPackPurchased(save)).toBe(false);
    expect(setStarterPackPurchased(save, true).ShopWindow?.isStarterPackPurchased).toBe(true);
  });
});
