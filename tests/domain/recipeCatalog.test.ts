// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildRecipeRows, type RecipeCatalogSource } from '../../src/domain/items/recipeCatalog.ts';

// The catalog projects the flat recipe id list into typed rows: weapon/outfit recipes are
// joined to their catalog name; theme recipes (e.g. "CafeteriaInstitute") are classified
// and labelled via the theme reverse-map; unmatched ids (ESpecialTheme "None") are dropped.

const source: RecipeCatalogSource = {
  unlockables: { recipes: ['Laser', 'BOSUniform', 'CafeteriaInstitute', 'None'] },
  weaponById: new Map([['Laser', { name: 'Laser Pistol', rarity: 'Rare' }]]),
  outfitById: new Map([['BOSUniform', { name: 'BOS Uniform', rarity: 'Legendary' }]]),
};

describe('buildRecipeRows', () => {
  it('returns [] before game data is available', () => {
    expect(buildRecipeRows(undefined)).toEqual([]);
  });

  it('classifies weapon, outfit and theme recipes and drops unmatched ids', () => {
    const rows = buildRecipeRows(source);
    expect(rows).toHaveLength(3); // "None" dropped

    const laser = rows.find((r) => r.id === 'Laser');
    expect(laser).toMatchObject({ kind: 'Weapon', name: 'Laser Pistol', rarity: 'Rare' });

    const outfit = rows.find((r) => r.id === 'BOSUniform');
    expect(outfit).toMatchObject({ kind: 'Outfit', name: 'BOS Uniform', rarity: 'Legendary' });

    const theme = rows.find((r) => r.id === 'CafeteriaInstitute');
    expect(theme).toMatchObject({
      kind: 'Theme',
      name: 'Cafeteria: Institute',
      roomType: 'Cafeteria',
      themeValue: 'Institute',
    });
    // Theme recipes have no joined item, so no rarity.
    expect(theme?.rarity).toBeUndefined();
  });
});
