import { VAULT_HELPER_CHARACTER_TYPES, type Actor, type SaveData } from '../model/saveSchema.ts';
import { maxResources } from './vaultOps.ts';
import { maxRoomLevel, repairRoom } from './roomOps.ts';
import {
  maxHappinessAll,
  maxHpAll,
  maxSpecialAll,
  setLevelAll,
  setRadiationAll,
  type EnduranceBonusFor,
} from './bulkOps.ts';

// Vault-wide bulk PRESETS. Pure + structural-sharing
// like the other ops; each preset folds many primitives into ONE new save so the store
// records it as a single undo step. Catalog-derived numbers (resource caps, Mr. Handy max
// health, per-room max levels) are passed IN so the presets stay game-data-free, matching
// the vaultOps convention.

/** Maximum dweller level (game cap). */
const MAX_DWELLER_LEVEL = 50;

function dwellerIds(save: SaveData): number[] {
  return (save.dwellers?.dwellers ?? []).map((d) => d.serializeId);
}

/**
 * Restore every vault-helper robot (Mr. Handy / Snip Snip / Victor / Curie) to
 * `fullHealth` and clear death. No-op (same ref) when there are no actors.
 * Pets/specials are left untouched.
 */
export function healMrHandies(save: SaveData, fullHealth: number): SaveData {
  const actors = save.dwellers?.actors;
  if (!Array.isArray(actors) || actors.length === 0) return save;
  let changed = false;
  const next = actors.map((a: Actor) => {
    if (typeof a.characterType !== 'number' || !VAULT_HELPER_CHARACTER_TYPES.has(a.characterType))
      return a;
    if (a.health === fullHealth && a.death !== true) return a;
    changed = true;
    return { ...a, health: fullHealth, death: false };
  });
  if (!changed) return save;
  return {
    ...save,
    dwellers: { ...save.dwellers, dwellers: save.dwellers?.dwellers ?? [], actors: next },
  };
}

/** Per-room-type maximum level (from room metadata); defaults to 3. */
export type RoomMaxLevel = (type: string) => number;

export interface MaxEverythingOptions {
  /** Legal resource caps (vaultSelectors.computeResourceCaps). */
  resourceCaps: Record<string, number>;
  /** Mr. Handy full health (roomCapacity.base.mrHandyHealth). */
  mrHandyHealth: number;
  /** Per-room-type max level lookup. */
  roomMaxLevel: RoomMaxLevel;
  /** Resolve each dweller's equipped-outfit Endurance bonus (for level HP scaling). */
  enduranceBonusFor?: EnduranceBonusFor;
}

/**
 * "Max Everything": max the current state of all EXISTING entities - never
 * unlock/add/remove. Resources → legal cap; every dweller → lvl 50, SPECIAL 10, 644 max
 * HP + 0 rad, happiness 100, dead revived; Mr. Handies → full health; every room → max
 * level + repaired. One applyEdit = one undo (it returns a single new save).
 */
export function maxEverything(save: SaveData, opts: MaxEverythingOptions): SaveData {
  const ids = dwellerIds(save);

  let out = maxResources(save, opts.resourceCaps);
  out = maxSpecialAll(out, ids); // END → 10 before leveling scales HP
  out = setLevelAll(out, ids, MAX_DWELLER_LEVEL, opts.enduranceBonusFor);
  out = maxHpAll(out, ids); // push to the 644 HP cap (also revives the dead)
  out = setRadiationAll(out, ids); // clear radiation
  out = maxHappinessAll(out, ids);
  out = healMrHandies(out, opts.mrHandyHealth);

  for (const room of out.vault?.rooms ?? []) {
    if (room.type === 'Elevator') continue;
    out = maxRoomLevel(out, room.deserializeID, opts.roomMaxLevel(room.type));
    out = repairRoom(out, room.deserializeID);
  }
  return out;
}
