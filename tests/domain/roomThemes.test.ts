import { describe, expect, it } from 'vitest';
import {
  NO_THEME,
  isThemeValidFor,
  roomTypeHasThemes,
  themeLabel,
  themeOptionsFor,
  themeRecipeIdFor,
} from '../../src/domain/rooms/themes.ts';

// The room-theme catalog mirrors the game's GameParameters.SpecialThemeRooms (decompiled
// Assembly-CSharp). Only Cafeteria / LivingQuarters / FakeWasteland (exterior) /
// WeaponFactory / NukaCola carry themes; every other type has none.

describe('room theme catalog', () => {
  it('reports which room types support themes', () => {
    expect(roomTypeHasThemes('Cafeteria')).toBe(true);
    expect(roomTypeHasThemes('FakeWasteland')).toBe(true);
    expect(roomTypeHasThemes('NukaCola')).toBe(true);
    expect(roomTypeHasThemes('Storage')).toBe(false);
    expect(roomTypeHasThemes('Entrance')).toBe(false);
  });

  it('returns [] for unthemed types and a None-led list for themed types', () => {
    expect(themeOptionsFor('Storage')).toEqual([]);
    const cafeteria = themeOptionsFor('Cafeteria');
    expect(cafeteria[0]).toEqual({ value: NO_THEME, label: 'None' });
    expect(cafeteria.map((t) => t.value)).toContain('Institute');
    // LivingQuarters has the exclusive Lucky 38 Penthouse theme; Cafeteria does not.
    expect(themeOptionsFor('LivingQuarters').map((t) => t.value)).toContain('Lucky38Penthouse');
    expect(cafeteria.map((t) => t.value)).not.toContain('Lucky38Penthouse');
  });

  it('validates a theme against its room type (None always allowed for themed types)', () => {
    expect(isThemeValidFor('Cafeteria', 'Institute')).toBe(true);
    expect(isThemeValidFor('Cafeteria', NO_THEME)).toBe(true);
    expect(isThemeValidFor('Cafeteria', 'Concord')).toBe(false); // exterior-only
    expect(isThemeValidFor('FakeWasteland', 'Concord')).toBe(true);
    expect(isThemeValidFor('Storage', NO_THEME)).toBe(false); // type has no themes
  });

  it('humanizes theme enum names', () => {
    expect(themeLabel('BrotherOfSteel')).toBe('Brotherhood of Steel');
    expect(themeLabel('Lucky38Penthouse')).toBe('Lucky 38 Penthouse');
    expect(themeLabel('Unknown')).toBe('Unknown'); // falls back to raw value
  });

  it('maps (roomType, theme) to the game recipe id, including irregular ones', () => {
    expect(themeRecipeIdFor('Cafeteria', 'Institute')).toBe('CafeteriaInstitute');
    // Irregular: exterior themes, the BrotherOfStell typo, the underscored factory id.
    expect(themeRecipeIdFor('FakeWasteland', 'Concord')).toBe('ConcordExterior');
    expect(themeRecipeIdFor('LivingQuarters', 'BrotherOfSteel')).toBe(
      'LivingQuartersBrotherOfStell',
    );
    expect(themeRecipeIdFor('WeaponFactory', 'Ultracite')).toBe('WeaponFactory_Ultracite');
    expect(themeRecipeIdFor('NukaCola', 'SunsetSarsaparilla')).toBe('SunsetSarsaparilla');
    // No recipe for None or an invalid pair.
    expect(themeRecipeIdFor('Cafeteria', NO_THEME)).toBeNull();
    expect(themeRecipeIdFor('Cafeteria', 'Concord')).toBeNull();
  });
});
