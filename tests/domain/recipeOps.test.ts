// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  addRecipes,
  applyThemeRecipe,
  buildTheme,
  isThemeApplied,
  isThemeBuilt,
  recipeKnown,
  removeRecipes,
  unapplyThemeRecipe,
  unbuildTheme,
} from '../../src/domain/ops/recipeOps.ts';

// Recipe collection ops over the three save structures: `survivalW.recipes` (known),
// `survivalW.collectedThemes.themeList` (built), `specialTheme.themeByRoomType` (applied).
// "CafeteriaInstitute" is a real theme recipe → room type Cafeteria, theme Institute.

function makeSave(): SaveData {
  return {
    survivalW: { recipes: ['OldWeapon'] },
    dwellers: { dwellers: [] },
  } as SaveData;
}

describe('recipeOps - known recipes', () => {
  it('adds ids to the collection (union, structural sharing)', () => {
    const save = makeSave();
    const next = addRecipes(save, ['Laser', 'Plasma']);
    expect(next.survivalW?.recipes).toEqual(['OldWeapon', 'Laser', 'Plasma']);
    expect(next.dwellers).toBe(save.dwellers); // untouched subtree shared by reference
  });

  it('is a no-op (same ref) when every id is already known', () => {
    const save = makeSave();
    expect(addRecipes(save, ['OldWeapon'])).toBe(save);
    expect(addRecipes(save, [])).toBe(save);
  });

  it('removes ids from the collection, no-op when none present', () => {
    const save = makeSave();
    expect(removeRecipes(save, ['OldWeapon']).survivalW?.recipes).toEqual([]);
    expect(removeRecipes(save, ['Nope'])).toBe(save);
  });
});

describe('recipeOps - theme build', () => {
  it('build ensures the recipe is known and writes a fully-crafted themeList entry', () => {
    const next = buildTheme(makeSave(), 'CafeteriaInstitute');
    expect(recipeKnown(next, 'CafeteriaInstitute')).toBe(true);
    expect(isThemeBuilt(next, 'CafeteriaInstitute')).toBe(true);
    const entry = next.survivalW?.collectedThemes?.themeList?.find(
      (t) => t.id === 'CafeteriaInstitute',
    );
    expect(entry?.extraData?.partsCollectedCount).toBe(9);
    expect(entry?.extraData?.IsCrafted).toBe(true);
  });

  it('build is a no-op for a non-theme recipe id', () => {
    const save = makeSave();
    expect(buildTheme(save, 'OldWeapon')).toBe(save);
  });

  it('unbuild drops the themeList entry, no-op when absent', () => {
    const built = buildTheme(makeSave(), 'CafeteriaInstitute');
    const cleared = unbuildTheme(built, 'CafeteriaInstitute');
    expect(isThemeBuilt(cleared, 'CafeteriaInstitute')).toBe(false);
    const save = makeSave();
    expect(unbuildTheme(save, 'CafeteriaInstitute')).toBe(save); // nothing built → same ref
  });
});

describe('recipeOps - theme apply', () => {
  it('apply ensures known + built and sets themeByRoomType for the room type', () => {
    const next = applyThemeRecipe(makeSave(), 'CafeteriaInstitute');
    expect(recipeKnown(next, 'CafeteriaInstitute')).toBe(true);
    expect(isThemeBuilt(next, 'CafeteriaInstitute')).toBe(true);
    expect(isThemeApplied(next, 'CafeteriaInstitute')).toBe(true);
    expect(next.specialTheme?.themeByRoomType?.Cafeteria).toBe('Institute');
  });

  it('unapply clears the room type back to None, no-op when not applied', () => {
    const applied = applyThemeRecipe(makeSave(), 'CafeteriaInstitute');
    const cleared = unapplyThemeRecipe(applied, 'CafeteriaInstitute');
    expect(isThemeApplied(cleared, 'CafeteriaInstitute')).toBe(false);
    expect(cleared.specialTheme?.themeByRoomType?.Cafeteria).toBe('None');
    const save = makeSave();
    expect(unapplyThemeRecipe(save, 'CafeteriaInstitute')).toBe(save); // not applied → same ref
  });
});

describe('recipeOps - cascading removal', () => {
  it('removing a known theme recipe also un-applies and un-builds it', () => {
    const applied = applyThemeRecipe(makeSave(), 'CafeteriaInstitute');
    // Precondition: all three states set.
    expect(recipeKnown(applied, 'CafeteriaInstitute')).toBe(true);
    expect(isThemeBuilt(applied, 'CafeteriaInstitute')).toBe(true);
    expect(isThemeApplied(applied, 'CafeteriaInstitute')).toBe(true);

    const removed = removeRecipes(applied, ['CafeteriaInstitute']);
    expect(recipeKnown(removed, 'CafeteriaInstitute')).toBe(false);
    expect(isThemeBuilt(removed, 'CafeteriaInstitute')).toBe(false);
    expect(isThemeApplied(removed, 'CafeteriaInstitute')).toBe(false);
  });
});
