import type { SaveData } from '../model/saveSchema.ts';
import { createPet, equipOutfit, equipWeapon, hasDweller, type NewPet } from './dwellerOps.ts';

// Location-based loadouts: equip a default outfit + weapon
// (and optionally a pet) onto a set of dwellers in one undo step. Pure + structural-sharing.
// Equipping writes ids DIRECTLY - no storage consumption (it's an editor, not the game).
// Ids are validated by the caller (the pickers only surface real catalog ids).

export interface LoadoutSpec {
  /** Weapon id to equip (omit to leave weapons unchanged). */
  weaponId?: string;
  /** Outfit id to equip (omit to leave outfits unchanged). */
  outfitId?: string;
  /** Optional pet to create + attach per dweller (each gets its own instance). */
  pet?: NewPet;
}

/**
 * Apply a loadout to every listed dweller, folding the per-dweller equips into ONE new save
 * (one undo step). Ids that no longer resolve are skipped. A loadout with a pet creates a
 * fresh pet instance on each dweller (any worn pet is swapped back to storage by createPet).
 */
export function applyLoadout(save: SaveData, ids: readonly number[], spec: LoadoutSpec): SaveData {
  return ids.reduce((acc, id) => {
    if (!hasDweller(acc, id)) return acc;
    let next = acc;
    if (spec.weaponId) next = equipWeapon(next, id, spec.weaponId);
    if (spec.outfitId) next = equipOutfit(next, id, spec.outfitId);
    if (spec.pet) next = createPet(next, id, spec.pet);
    return next;
  }, save);
}
