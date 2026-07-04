import { describe, expect, it } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import { selectAllDwellerIds } from '../../src/domain/selectors/dwellerScope.ts';

function makeSave(): SaveData {
  return {
    dwellers: {
      dwellers: [
        {
          serializeId: 1,
          name: 'Alice',
          lastName: 'Cox',
          health: { healthValue: 100, maxHealth: 100 },
          equipedWeapon: { id: 'Laser', type: 'Weapon' },
        },
        {
          serializeId: 2,
          name: 'Bob',
          lastName: 'Reed',
          health: { healthValue: 0, maxHealth: 80 },
          equipedWeapon: { id: 'Fist', type: 'Weapon' },
        },
        {
          serializeId: 3,
          name: 'Carol',
          lastName: 'Vance',
          health: { healthValue: 50, maxHealth: 100 },
          equipedWeapon: { id: 'Fist', type: 'Weapon' },
        },
      ],
    },
  } as unknown as SaveData;
}

describe('selectAllDwellerIds', () => {
  it('returns every dweller serializeId', () => {
    expect(selectAllDwellerIds(makeSave(), null)).toEqual([1, 2, 3]);
  });

  it('returns an empty array when there are no dwellers', () => {
    const empty = { dwellers: { dwellers: [] } } as unknown as SaveData;
    expect(selectAllDwellerIds(empty, null)).toEqual([]);
  });
});
