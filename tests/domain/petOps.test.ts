// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { Item, SaveData } from '../../src/domain/model/saveSchema.ts';
import { assignPet, deletePet, editPet, sendPetToStorage } from '../../src/domain/ops/petOps.ts';
import type { PetLocation } from '../../src/domain/selectors/petSelectors.ts';

// A save with pets in both locations: dweller 1 wears lykoi_l, dweller 2 wears
// husky_r, dweller 3 has none; storage holds a junk item then a stored pet
// (persian_l) at index 1. An untouched sibling manager lets each test assert
// structural sharing + immutability, mirroring storageOps/dwellerOps tests.
function makeSave(): SaveData {
  return {
    dwellers: {
      dwellers: [
        {
          serializeId: 1,
          name: 'Alice',
          lastName: 'Cox',
          equippedPet: {
            id: 'lykoi_l',
            type: 'Pet',
            extraData: { uniqueName: 'Calypso', bonus: 'DamageBoost', bonusValue: 6 },
          },
        },
        {
          serializeId: 2,
          name: 'Bob',
          lastName: 'Vance',
          equippedPet: {
            id: 'husky_r',
            type: 'Pet',
            extraData: { uniqueName: 'Rex', bonus: 'XPBoost', bonusValue: 15 },
          },
        },
        { serializeId: 3, name: 'Carol', lastName: 'Dee' },
      ],
    },
    vault: {
      inventory: {
        items: [
          { id: 'TeddyBear', type: 'Junk' },
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
const petOf = (s: SaveData, i: number): Item | undefined => s.dwellers?.dwellers[i].equippedPet;
const snap = (s: SaveData): string => JSON.stringify(s);

const EQUIPPED_1: PetLocation = { kind: 'equipped', dwellerId: 1 };
const STORED_PERSIAN: PetLocation = { kind: 'stored', index: 1 };

describe('petOps - immutability & structural sharing', () => {
  it('never mutates the input and shares untouched top-level keys by reference', () => {
    const before = makeSave();
    const json = snap(before);
    const after = editPet(before, EQUIPPED_1, { bonusValue: 7 });
    expect(snap(before)).toBe(json);
    expect(after.someManagerWeNeverTouch).toBe(before.someManagerWeNeverTouch);
    expect(after).not.toBe(before);
  });
});

describe('petOps - editPet', () => {
  it('edits an EQUIPPED pet, keeping the bonus locked', () => {
    const after = editPet(makeSave(), EQUIPPED_1, { bonusValue: 9, uniqueName: 'Calypso II' });
    const extra = petOf(after, 0)?.extraData;
    expect(extra).toMatchObject({ bonusValue: 9, uniqueName: 'Calypso II', bonus: 'DamageBoost' });
  });

  it('edits a STORED pet in place, keeping the bonus locked', () => {
    const after = editPet(makeSave(), STORED_PERSIAN, { bonusValue: 80, uniqueName: 'Pebble' });
    const stored = items(after)[1];
    expect(stored.extraData).toMatchObject({
      bonusValue: 80,
      uniqueName: 'Pebble',
      bonus: 'HappinessBoost',
    });
  });

  it('is a no-op (same ref) when a stored location is not a pet', () => {
    const before = makeSave();
    expect(editPet(before, { kind: 'stored', index: 0 }, { bonusValue: 1 })).toBe(before);
  });
});

describe('petOps - assignPet', () => {
  it('assigns a STORED pet onto a dweller, swapping that dweller’s pet to storage', () => {
    const after = assignPet(makeSave(), STORED_PERSIAN, 1);
    expect(petOf(after, 0)?.id).toBe('persian_l'); // dweller 1 now wears persian_l
    expect(items(after).find((i) => i.id === 'persian_l')).toBeUndefined(); // left storage
    expect(items(after).find((i) => i.id === 'lykoi_l')).toBeDefined(); // old pet returned
  });

  it('moves an EQUIPPED pet onto another dweller, swapping the target’s pet to storage', () => {
    const after = assignPet(makeSave(), EQUIPPED_1, 2); // lykoi_l (dw1) → dweller 2
    expect(petOf(after, 1)?.id).toBe('lykoi_l');
    expect(petOf(after, 0)).toBeUndefined(); // dweller 1 no longer wears it
    expect(items(after).find((i) => i.id === 'husky_r')).toBeDefined(); // dweller 2's old pet stored
  });

  it('assigns an EQUIPPED pet onto a dweller with no pet', () => {
    const after = assignPet(makeSave(), EQUIPPED_1, 3);
    expect(petOf(after, 2)?.id).toBe('lykoi_l');
    expect(petOf(after, 0)).toBeUndefined();
  });

  it('is a no-op (same ref) when re-assigning to the same dweller', () => {
    const before = makeSave();
    expect(assignPet(before, EQUIPPED_1, 1)).toBe(before);
  });
});

describe('petOps - sendPetToStorage', () => {
  it('returns an equipped pet to storage and clears the slot', () => {
    const after = sendPetToStorage(makeSave(), EQUIPPED_1);
    expect(petOf(after, 0)).toBeUndefined();
    expect(items(after).find((i) => i.id === 'lykoi_l')).toBeDefined();
    expect(items(after).length).toBe(items(makeSave()).length + 1);
  });

  it('is a no-op (same ref) for an already-stored pet', () => {
    const before = makeSave();
    expect(sendPetToStorage(before, STORED_PERSIAN)).toBe(before);
  });
});

describe('petOps - deletePet', () => {
  it('deletes an EQUIPPED pet outright (not returned to storage)', () => {
    const before = makeSave();
    const after = deletePet(before, EQUIPPED_1);
    expect(petOf(after, 0)).toBeUndefined();
    expect(items(after).length).toBe(items(before).length); // inventory unchanged
    expect(items(after).find((i) => i.id === 'lykoi_l')).toBeUndefined();
  });

  it('deletes a STORED pet by index', () => {
    const before = makeSave();
    const after = deletePet(before, STORED_PERSIAN);
    expect(items(after).some((i) => i.type === 'Pet')).toBe(false);
    expect(items(after).length).toBe(items(before).length - 1);
  });

  it('is a no-op (same ref) deleting a stored out-of-range index', () => {
    const before = makeSave();
    expect(deletePet(before, { kind: 'stored', index: 99 })).toBe(before);
  });
});
