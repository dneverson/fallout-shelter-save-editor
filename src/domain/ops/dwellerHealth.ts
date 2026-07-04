// Dweller HP scaling (game-data-free, pure). Fallout Shelter computes a dweller's
// max HP from its Endurance AT THE MOMENT OF EACH LEVEL-UP and then freezes the value
// - the game never recomputes maxHealth on load, which is why a level bumped without
// rescaling HP stays stuck at the level-1 value of 105 (an impossible in-game state).
//
// Formula (confirmed against real saves and the Fallout wiki):
//   maxHP = 105 + (level - 1) * (2.5 + 0.5 * totalEndurance)
// where totalEndurance = base SPECIAL Endurance (1..10) + the equipped outfit's
// Endurance bonus, evaluated at each level. The +0.5 per Endurance point means:
//   END 1  -> +3   HP/level -> 252   HP at lvl 50
//   END 10 -> +7.5 HP/level -> 472.5 HP at lvl 50 (base stat cap, no gear)
//   END 17 -> +11  HP/level -> 644   HP at lvl 50 (base 10 + a +7 END outfit)
//
// 644 is the absolute in-game maximum. Callers keep this module game-data-free by
// resolving the outfit Endurance bonus themselves (game data lives in the UI layer)
// and passing the total in.

/** Max HP of a brand-new level-1 dweller (Endurance is irrelevant at level 1). */
export const BASE_HP = 105;

/** The highest max HP obtainable in-game: level 50 leveled the whole way at END 17. */
export const MAX_DWELLER_HP = 644;

/** HP gained per level for a given (total) Endurance: `2.5 + 0.5 * endurance`. */
const hpPerLevel = (endurance: number): number => 2.5 + 0.5 * endurance;

/**
 * Max HP for a dweller at `level` with a constant total `endurance`. Models the editor's
 * assumption that the dweller reached `level` at its current Endurance (the game's true
 * value depends on the Endurance history, which a save can't reconstruct). Levels below 1
 * clamp to the level-1 base; the result is NOT capped here - callers apply the 644 cap.
 */
export function maxHpForLevel(level: number, endurance: number): number {
  const levels = Math.max(0, Math.trunc(level) - 1);
  return BASE_HP + levels * hpPerLevel(endurance);
}
