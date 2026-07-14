// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  buildGuideCodeIndex,
  type CollectionCatalogSource,
} from '../../src/domain/items/collectionCatalog.ts';
import { autoCollectNewObjects } from '../../src/domain/ops/guideAutoCollect.ts';
import { collectionStatus } from '../../src/domain/ops/collectionOps.ts';

// Auto-collect maps objects an edit INTRODUCED (storage items, equipped gear, pets,
// special dwellers) to their guide entries, mirroring the game's OnNewItem/
// OnNewUniqueDweller. Uses the same catalog source shape as collectionCatalog.

const source: CollectionCatalogSource = {
  weapons: [
    { id: 'Fist', name: 'Fist', rarity: 'Normal', codeId: '117' }, // vault default → no code
    { id: 'LaserPistol', name: 'Laser Pistol', rarity: 'Rare', codeId: '24' },
  ],
  outfits: [
    { id: 'BOSUniform', name: 'BOS Uniform', rarity: 'Rare', category: 2, codeId: '103' },
    { id: 'JobOutfit', name: 'Handyman', rarity: 'Normal', category: 1, codeId: '9' }, // casual → no code
  ],
  junk: [{ id: 'AlarmClock', name: 'Alarm Clock', rarity: 'Normal', codeId: 'AlarmClock' }],
  pets: [
    {
      id: 'cx404_l',
      name: 'German Shepherd',
      baseName: 'Dogmeat',
      breedCode: 5,
      rarity: 'Legendary',
      rarityCode: 4,
      codeId: 77,
    },
    {
      id: 'husky_c',
      name: 'Husky',
      baseName: 'Husky',
      breedCode: 7,
      rarity: 'Normal',
      rarityCode: 2,
      codeId: 12,
    },
  ],
  uniqueDwellers: {
    L_NickValentine: { name: 'Nick', lastName: 'Valentine' },
    L_SnipSnip: { name: 'Snip Snip', lastName: '' },
  },
  enums: { EPetBreed: { GermanShepherd: 5, Husky: 7, DefaultRollerbrain: 43, Count: 44 } },
};

const index = buildGuideCodeIndex(source);

const emptySave = (): SaveData =>
  ({ dwellers: { dwellers: [] }, vault: { inventory: { items: [] } } }) as SaveData;

const withItems = (items: Array<{ id: string; type: string }>): SaveData =>
  ({ dwellers: { dwellers: [] }, vault: { inventory: { items } } }) as SaveData;

describe('buildGuideCodeIndex', () => {
  it('indexes only collectible ids (excludes Fist, casual outfits)', () => {
    expect(index.weapons.get('LaserPistol')).toBe('24');
    expect(index.weapons.has('Fist')).toBe(false);
    expect(index.outfits.get('BOSUniform')).toBe('103');
    expect(index.outfits.has('JobOutfit')).toBe(false);
    expect(index.junk.get('AlarmClock')).toBe('AlarmClock');
    expect(index.dwellers.has('L_NickValentine')).toBe(true);
    expect(index.dwellers.has('L_SnipSnip')).toBe(false);
  });

  it('legendary pet → pet code only; normal pet → breed code only', () => {
    expect(index.pets.get('cx404_l')).toEqual({ petCode: '77', breedCode: null });
    expect(index.pets.get('husky_c')).toEqual({ petCode: null, breedCode: '7' });
  });
});

describe('autoCollectNewObjects', () => {
  it('collects a weapon granted to storage', () => {
    const prev = emptySave();
    const next = withItems([{ id: 'LaserPistol', type: 'Weapon' }]);
    const out = autoCollectNewObjects(prev, next, index);
    expect(collectionStatus(out, 'weapons', '24')).toBe('new');
  });

  it('collects gear equipped onto a dweller (weapon + outfit + pet)', () => {
    const prev = emptySave();
    const next = {
      dwellers: {
        dwellers: [
          {
            serializeId: 1,
            equipedWeapon: { id: 'LaserPistol', type: 'Weapon' },
            equipedOutfit: { id: 'BOSUniform', type: 'Outfit' },
            equippedPet: { id: 'cx404_l', type: 'Pet' },
          },
        ],
      },
      vault: { inventory: { items: [] } },
    } as unknown as SaveData;
    const out = autoCollectNewObjects(prev, next, index);
    expect(collectionStatus(out, 'weapons', '24')).toBe('new');
    expect(collectionStatus(out, 'outfits', '103')).toBe('new');
    expect(collectionStatus(out, 'pets', '77')).toBe('new');
  });

  it('collects the breed for a normal pet, not a pet-code', () => {
    const prev = emptySave();
    const next = withItems([{ id: 'husky_c', type: 'Pet' }]);
    const out = autoCollectNewObjects(prev, next, index);
    expect(collectionStatus(out, 'breeds', '7')).toBe('new');
    expect(out.survivalW?.pets ?? []).toEqual([]);
  });

  it('collects a special dweller added to the roster', () => {
    const prev = emptySave();
    const next = {
      dwellers: { dwellers: [{ serializeId: 1, uniqueData: 'L_NickValentine' }] },
      vault: { inventory: { items: [] } },
    } as unknown as SaveData;
    const out = autoCollectNewObjects(prev, next, index);
    expect(collectionStatus(out, 'dwellers', 'L_NickValentine')).toBe('new');
  });

  it('ignores objects with no guide entry (Fist, casual outfit)', () => {
    const prev = emptySave();
    const next = withItems([
      { id: 'Fist', type: 'Weapon' },
      { id: 'JobOutfit', type: 'Outfit' },
    ]);
    expect(autoCollectNewObjects(prev, next, index)).toBe(next); // same ref, no survivalW written
  });

  it('does not fire when an item merely MOVES (equip from storage keeps counts flat)', () => {
    const prev = withItems([{ id: 'LaserPistol', type: 'Weapon' }]);
    const next = {
      dwellers: {
        dwellers: [{ serializeId: 1, equipedWeapon: { id: 'LaserPistol', type: 'Weapon' } }],
      },
      vault: { inventory: { items: [] } },
    } as unknown as SaveData;
    expect(autoCollectNewObjects(prev, next, index)).toBe(next);
  });

  it('never un-collects: removing an object leaves the guide untouched', () => {
    const prev = {
      survivalW: { weapons: ['N24'] },
      dwellers: { dwellers: [] },
      vault: { inventory: { items: [{ id: 'LaserPistol', type: 'Weapon' }] } },
    } as unknown as SaveData;
    const next = {
      survivalW: { weapons: ['N24'] },
      dwellers: { dwellers: [] },
      vault: { inventory: { items: [] } },
    } as unknown as SaveData;
    const out = autoCollectNewObjects(prev, next, index);
    expect(out).toBe(next); // guide entry stays; removal is not our concern
    expect(collectionStatus(out, 'weapons', '24')).toBe('new');
  });

  it('does not re-flag an already-collected (seen) entry back to new', () => {
    const prev = {
      survivalW: { weapons: ['O24'] },
      dwellers: { dwellers: [] },
      vault: { inventory: { items: [{ id: 'LaserPistol', type: 'Weapon' }] } },
    } as unknown as SaveData;
    // Grant a SECOND Laser Pistol - count grows, but the code is already collected.
    const next = {
      survivalW: { weapons: ['O24'] },
      dwellers: { dwellers: [] },
      vault: {
        inventory: {
          items: [
            { id: 'LaserPistol', type: 'Weapon' },
            { id: 'LaserPistol', type: 'Weapon' },
          ],
        },
      },
    } as unknown as SaveData;
    const out = autoCollectNewObjects(prev, next, index);
    expect(collectionStatus(out, 'weapons', '24')).toBe('seen'); // unchanged
  });
});
