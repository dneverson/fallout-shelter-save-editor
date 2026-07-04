// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import type { GameData } from '../../src/domain/gamedata/gameData.ts';
import type { Pet } from '../../src/domain/gamedata/schemas.ts';
import { selectPetByLocation, selectPetRows } from '../../src/domain/selectors/petSelectors.ts';

// Pets in both locations: dweller 1 (Alice Cox) wears lykoi_l; dweller 2 (Bob) has
// none; storage holds a junk item then a stored pet (persian_l) at index 1.
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
        { serializeId: 2, name: 'Bob', lastName: 'Vance' },
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
        ],
      },
    },
  } as SaveData;
}

/** Minimal GameData stub exposing only the petById lookup the selector reads. */
function makeGameData(): GameData {
  const pets = new Map<string, Pet>([
    [
      'lykoi_l',
      {
        id: 'lykoi_l',
        name: 'Lykoi',
        type: 'Cat',
        rarity: 'Legendary',
        bonus: 'DamageBoost',
      } as Pet,
    ],
    [
      'persian_l',
      {
        id: 'persian_l',
        name: 'Persian',
        type: 'Cat',
        rarity: 'Legendary',
        bonus: 'HappinessBoost',
      } as Pet,
    ],
  ]);
  return { petById: pets } as unknown as GameData;
}

describe('petSelectors - selectPetRows', () => {
  it('projects equipped + stored instances with their locations', () => {
    const rows = selectPetRows(makeSave());
    expect(rows).toHaveLength(2);
    const byId = new Map(rows.map((r) => [r.id, r]));

    const lykoi = byId.get('lykoi_l');
    expect(lykoi?.location).toEqual({ kind: 'equipped', dwellerId: 1 });
    expect(lykoi?.rowId).toBe('e:1');
    expect(lykoi?.uniqueName).toBe('Calypso');
    expect(lykoi?.bonusValue).toBe(6);
    expect(lykoi?.assignedTo).toBe('Alice Cox');

    const persian = byId.get('persian_l');
    expect(persian?.location).toEqual({ kind: 'stored', index: 1 });
    expect(persian?.rowId).toBe('s:1');
    expect(persian?.assignedTo).toBe('Storage');
  });

  it('degrades to raw ids when no game data is supplied', () => {
    const lykoi = selectPetRows(makeSave()).find((r) => r.id === 'lykoi_l');
    expect(lykoi?.breed).toBe('lykoi_l');
    expect(lykoi?.type).toBe('–');
    expect(lykoi?.rarity).toBe('–');
    // bonus still comes from the instance's extraData even without a catalog.
    expect(lykoi?.bonus).toBe('DamageBoost');
  });

  it('enriches breed/type/rarity from game data when supplied', () => {
    const lykoi = selectPetRows(makeSave(), makeGameData()).find((r) => r.id === 'lykoi_l');
    expect(lykoi?.breed).toBe('Lykoi');
    expect(lykoi?.type).toBe('Cat');
    expect(lykoi?.rarity).toBe('Legendary');
  });

  it('sorts by unique name (Calypso before Mr. Pebbles)', () => {
    const rows = selectPetRows(makeSave());
    expect(rows.map((r) => r.uniqueName)).toEqual(['Calypso', 'Mr. Pebbles']);
  });
});

describe('petSelectors - selectPetByLocation', () => {
  it('resolves an equipped instance with its owner name', () => {
    const got = selectPetByLocation(makeSave(), { kind: 'equipped', dwellerId: 1 });
    expect(got?.item.id).toBe('lykoi_l');
    expect(got?.ownerName).toBe('Alice Cox');
  });

  it('resolves a stored instance (no owner name)', () => {
    const got = selectPetByLocation(makeSave(), { kind: 'stored', index: 1 });
    expect(got?.item.id).toBe('persian_l');
    expect(got?.ownerName).toBeUndefined();
  });

  it('returns null for a dweller without a pet, a missing dweller, or a non-pet index', () => {
    const s = makeSave();
    expect(selectPetByLocation(s, { kind: 'equipped', dwellerId: 2 })).toBeNull();
    expect(selectPetByLocation(s, { kind: 'equipped', dwellerId: 99 })).toBeNull();
    expect(selectPetByLocation(s, { kind: 'stored', index: 0 })).toBeNull(); // junk
    expect(selectPetByLocation(s, { kind: 'stored', index: 99 })).toBeNull();
  });
});
