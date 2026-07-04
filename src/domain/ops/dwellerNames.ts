import type { Gender } from '../model/saveSchema.ts';

// Built-in name pools for one-click random naming and for auto-generated
// auto-staff recruits. Not a game catalog - just enough variety to fill the field. Lives in
// the domain layer so both the UI dialog and the pure dweller-generation op share one source;
// the rng is injectable so generation stays deterministic in tests.

const FEMALE_NAMES = [
  'Nora',
  'Alice',
  'Eve',
  'Cait',
  'Piper',
  'Cass',
  'Vera',
  'Lena',
  'Ruth',
  'Mona',
];

const MALE_NAMES = [
  'Max',
  'Sturges',
  'Hank',
  'Desmond',
  'Arthur',
  'Milo',
  'Vance',
  'Cody',
  'Reed',
  'Gus',
];

const LAST_NAMES = [
  'Cox',
  'Stone',
  'Vance',
  'Hale',
  'Reyes',
  'Boone',
  'Cross',
  'Webb',
  'Park',
  'Frost',
];

const pick = (pool: readonly string[], rng: () => number): string =>
  pool[Math.floor(rng() * pool.length)] ?? pool[0]!;

/** A random first/last name appropriate to the given gender (1 = female, 2 = male). */
export function randomDwellerName(
  gender: Gender,
  rng: () => number = Math.random,
): { name: string; lastName: string } {
  return {
    name: pick(gender === 1 ? FEMALE_NAMES : MALE_NAMES, rng),
    lastName: pick(LAST_NAMES, rng),
  };
}
