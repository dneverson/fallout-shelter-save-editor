// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  buildCollectionRows,
  type CollectionCatalogSource,
} from '../../src/domain/items/collectionCatalog.ts';

// Survival Guide catalog projection. The filters mirror SurvivalWindow.Initialize /
// Deserialize (decompiled game): default weapon + rarity-None excluded, premium outfits
// only, legendary "L_*" dwellers minus L_SnipSnip, legendary pets, breeds 0..43 minus
// DefaultRollerbrain (43), all junk.

const source: CollectionCatalogSource = {
  weapons: [
    { id: 'Fist', name: 'Fist', rarity: 'Normal', codeId: '117' }, // vault default → excluded
    { id: 'NoneRarity', name: 'Cut Weapon', rarity: 'None', codeId: '5' }, // → excluded
    { id: 'LaserPistol', name: 'Laser Pistol', rarity: 'Rare', codeId: '24' },
  ],
  outfits: [
    { id: 'BOSUniform', name: 'BOS Uniform', rarity: 'Rare', category: 2, codeId: '103' },
    { id: 'JobOutfit', name: 'Handyman', rarity: 'Normal', category: 1, codeId: '9' }, // casual → excluded
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
    L_SnipSnip: { name: 'Snip Snip', lastName: '' }, // Mr. Handy variant → excluded
    ClericMale: { name: 'Cleric', lastName: '' }, // rare, not legendary → excluded
  },
  enums: {
    EPetBreed: { GermanShepherd: 5, Husky: 7, DefaultRollerbrain: 43, Count: 44, None: 100 },
  },
};

describe('collectionCatalog', () => {
  const rows = buildCollectionRows(source);
  const byKey = new Map(rows.map((r) => [r.key, r]));

  it('returns [] without game data', () => {
    expect(buildCollectionRows(undefined)).toEqual([]);
  });

  it('lists weapons by codeId, excluding the vault default and rarity None', () => {
    const weapons = rows.filter((r) => r.category === 'weapons');
    expect(weapons.map((w) => w.code)).toEqual(['24']);
    expect(byKey.get('weapons:24')?.icon).toEqual({ type: 'weapons', id: 'LaserPistol' });
  });

  it('lists premium outfits only', () => {
    expect(rows.filter((r) => r.category === 'outfits').map((o) => o.code)).toEqual(['103']);
  });

  it('lists legendary L_* dwellers minus L_SnipSnip, coded by asset name', () => {
    const dwellers = rows.filter((r) => r.category === 'dwellers');
    expect(dwellers.map((d) => d.code)).toEqual(['L_NickValentine']);
    expect(dwellers[0].name).toBe('Nick Valentine');
    expect(dwellers[0].icon).toBeNull();
  });

  it('lists legendary pets with the special name kept searchable by breed', () => {
    const pets = rows.filter((r) => r.category === 'pets');
    expect(pets).toHaveLength(1);
    expect(pets[0].code).toBe('77');
    expect(pets[0].name).toBe('Dogmeat (German Shepherd)');
  });

  it('lists breeds by EPetBreed int, skipping DefaultRollerbrain/Count/None', () => {
    const breeds = rows.filter((r) => r.category === 'breeds');
    expect(breeds.map((b) => b.code).sort()).toEqual(['5', '7']);
    // Breed art/name come from that breed's lowest-rarity pet (fallback: enum name).
    expect(byKey.get('breeds:7')?.name).toBe('Husky');
    expect(byKey.get('breeds:7')?.icon).toEqual({ type: 'pets', id: 'husky_c' });
    expect(byKey.get('breeds:5')?.name).toBe('German Shepherd');
    expect(byKey.get('breeds:5')?.rarity).toBeNull();
  });

  it('lists junk with codeId == id', () => {
    expect(rows.filter((r) => r.category === 'junk').map((j) => j.code)).toEqual(['AlarmClock']);
  });
});
