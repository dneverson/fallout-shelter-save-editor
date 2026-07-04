import type { Gender } from '../../domain/model/saveSchema.ts';
import { randomDwellerName } from '../../domain/ops/dwellerNames.ts';

// Thin UI re-export of the domain name generator - kept so existing
// callers (the add-dweller dialog) don't need to reach into the domain layer directly.

/** A random first/last name appropriate to the given gender (1 = female, 2 = male). */
export function randomName(gender: Gender): { name: string; lastName: string } {
  return randomDwellerName(gender);
}
