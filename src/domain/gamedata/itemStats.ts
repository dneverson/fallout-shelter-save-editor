import type { Special } from './schemas.ts';

// Shared, pure item-stat helpers used by every surface that lists catalog items
// (the equip pickers, the storage add-items picker, the standalone catalog sections,
// and the dweller roster). Centralizing the definitions here means "average damage"
// and "total SPECIAL" mean exactly one thing everywhere and stay sortable. Node-testable
// (no React / no DOM).

export const SPECIAL_KEYS = ['S', 'P', 'E', 'C', 'I', 'A', 'L'] as const;

/** Canonical weapon "average damage" = the midpoint of its min–max range. */
export function weaponAvgDamage(w: { damageMin: number; damageMax: number }): number {
  return (w.damageMin + w.damageMax) / 2;
}

/** Compact display for an average that may be a half-integer (e.g. 3.5). */
export function formatAvgDamage(avg: number): string {
  return Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
}

/** Sum of all SPECIAL bonuses an outfit grants (Σ S+P+E+C+I+A+L). */
export function outfitSpecialTotal(special: Special): number {
  return SPECIAL_KEYS.reduce((sum, k) => sum + special[k], 0);
}

// Dweller gender codes as stored in the save (see dwellerSchema): 1 = female, 2 = male.
const FEMALE_GENDER = 1;
const MALE_GENDER = 2;

/**
 * Whether `outfit` may be equipped on a dweller of the given gender code. Gender-locked
 * outfits (dresses are `gender: 'female'`, male-cut suits `gender: 'male'`; see
 * build-outfits.mjs) only fit that gender; unisex outfits (and an unknown dweller gender)
 * are always allowed.
 */
export function outfitAllowedForGender(
  outfit: { gender: 'male' | 'female' | null },
  gender: number | null | undefined,
): boolean {
  if (outfit.gender == null || gender == null) return true;
  const required = outfit.gender === 'female' ? FEMALE_GENDER : MALE_GENDER;
  return required === gender;
}
