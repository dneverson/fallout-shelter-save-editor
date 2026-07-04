// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { Item, SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  addPet,
  grantItems,
  itemCount,
  removeStoredItemAt,
  setItemCount,
} from '../../src/domain/ops/storageOps.ts';

// A representative inventory: two junk ids (one with two copies), a weapon, an outfit,
// and a pet instance, plus an untouched sibling manager so every test can assert
// structural sharing (untouched subtrees kept by ref) and immutability.
function makeSave(): SaveData {
  return {
    vault: {
      inventory: {
        items: [
          { id: 'TeddyBear', type: 'Junk', hasBeenAssigned: false },
          { id: 'TeddyBear', type: 'Junk', hasBeenAssigned: false },
          { id: 'GoldWatch', type: 'Junk', hasBeenAssigned: false },
          { id: 'PlasmaRifle', type: 'Weapon', hasBeenAssigned: false },
          { id: 'BattleArmor', type: 'Outfit', hasBeenAssigned: false },
          {
            id: 'persian_l',
            type: 'Pet',
            extraData: { uniqueName: 'Mr. Pebbles', bonus: 'HappinessBoost', bonusValue: 95 },
          },
        ] as Item[],
      },
    },
    someManagerWeNeverTouch: { nested: { a: [1, 2, 3] } },
    appVersion: '1.0',
  } as SaveData;
}

const items = (s: SaveData): Item[] => s.vault?.inventory?.items ?? [];
const snap = (s: SaveData): string => JSON.stringify(s);

describe('storageOps - immutability & structural sharing', () => {
  it('never mutates the input and shares untouched top-level keys by reference', () => {
    const before = makeSave();
    const json = snap(before);
    const after = setItemCount(before, 'Junk', 'TeddyBear', 5);
    expect(snap(before)).toBe(json); // input untouched
    expect(after.someManagerWeNeverTouch).toBe(before.someManagerWeNeverTouch); // shared by ref
    expect(after).not.toBe(before);
  });

  it('keeps untouched items by reference when a different group changes', () => {
    const before = makeSave();
    const after = grantItems(before, 'Junk', 'GoldWatch', 1);
    // The PlasmaRifle / persian_l entries are untouched → same object identity.
    expect(items(after)[3]).toBe(items(before)[3]);
    expect(items(after)[5]).toBe(items(before)[5]);
  });
});

describe('storageOps - itemCount', () => {
  it('counts entries of a (type, id) group', () => {
    const s = makeSave();
    expect(itemCount(s, 'Junk', 'TeddyBear')).toBe(2);
    expect(itemCount(s, 'Junk', 'GoldWatch')).toBe(1);
    expect(itemCount(s, 'Weapon', 'PlasmaRifle')).toBe(1);
    expect(itemCount(s, 'Junk', 'Nonexistent')).toBe(0);
  });
});

describe('storageOps - setItemCount', () => {
  it('grows a group by appending plain items for the delta', () => {
    const after = setItemCount(makeSave(), 'Junk', 'TeddyBear', 5);
    expect(itemCount(after, 'Junk', 'TeddyBear')).toBe(5);
    const teddies = items(after).filter((i) => i.id === 'TeddyBear');
    expect(teddies.every((i) => i.type === 'Junk')).toBe(true);
    expect((teddies[4] as Record<string, unknown>).hasBeenAssigned).toBe(false); // fresh-slot flags
  });

  it('shrinks a group by dropping the surplus, keeping the first N by reference', () => {
    const before = makeSave();
    const firstTeddy = items(before).find((i) => i.id === 'TeddyBear');
    const after = setItemCount(before, 'Junk', 'TeddyBear', 1);
    expect(itemCount(after, 'Junk', 'TeddyBear')).toBe(1);
    expect(items(after).find((i) => i.id === 'TeddyBear')).toBe(firstTeddy); // kept object identity
  });

  it('count 0 removes the whole group but leaves other items', () => {
    const after = setItemCount(makeSave(), 'Junk', 'TeddyBear', 0);
    expect(itemCount(after, 'Junk', 'TeddyBear')).toBe(0);
    expect(itemCount(after, 'Junk', 'GoldWatch')).toBe(1);
    expect(itemCount(after, 'Weapon', 'PlasmaRifle')).toBe(1);
  });

  it('clamps negative / fractional counts to a non-negative integer', () => {
    expect(itemCount(setItemCount(makeSave(), 'Junk', 'TeddyBear', -3), 'Junk', 'TeddyBear')).toBe(
      0,
    );
    expect(itemCount(setItemCount(makeSave(), 'Junk', 'TeddyBear', 4.9), 'Junk', 'TeddyBear')).toBe(
      4,
    );
  });

  it('grants a brand-new id not previously in storage', () => {
    const after = setItemCount(makeSave(), 'Weapon', 'MissileLauncher', 3);
    expect(itemCount(after, 'Weapon', 'MissileLauncher')).toBe(3);
  });

  it('is a no-op (same ref) when already at the target count', () => {
    const before = makeSave();
    expect(setItemCount(before, 'Junk', 'TeddyBear', 2)).toBe(before);
  });
});

describe('storageOps - grantItems', () => {
  it('adds to the existing count (additive, not absolute)', () => {
    const after = grantItems(makeSave(), 'Junk', 'TeddyBear', 3);
    expect(itemCount(after, 'Junk', 'TeddyBear')).toBe(5);
  });

  it('is a no-op (same ref) for count <= 0', () => {
    const before = makeSave();
    expect(grantItems(before, 'Junk', 'TeddyBear', 0)).toBe(before);
    expect(grantItems(before, 'Junk', 'TeddyBear', -2)).toBe(before);
  });
});

describe('storageOps - pets', () => {
  it('removeStoredItemAt removes the instance at that index', () => {
    const before = makeSave();
    const petIndex = items(before).findIndex((i) => i.type === 'Pet');
    const after = removeStoredItemAt(before, petIndex);
    expect(items(after).some((i) => i.type === 'Pet')).toBe(false);
    expect(items(after).length).toBe(items(before).length - 1);
  });

  it('removeStoredItemAt is a no-op (same ref) for an out-of-range index', () => {
    const before = makeSave();
    expect(removeStoredItemAt(before, 99)).toBe(before);
    expect(removeStoredItemAt(before, -1)).toBe(before);
  });

  it('addPet appends a finished pet instance with its extraData', () => {
    const after = addPet(makeSave(), {
      petId: 'lykoi_l',
      uniqueName: 'Shadow',
      bonus: 'DamageBoost',
      bonusValue: 6,
    });
    const added = items(after).find((i) => i.id === 'lykoi_l');
    expect(added?.type).toBe('Pet');
    expect(added?.extraData).toEqual({ uniqueName: 'Shadow', bonus: 'DamageBoost', bonusValue: 6 });
  });
});
