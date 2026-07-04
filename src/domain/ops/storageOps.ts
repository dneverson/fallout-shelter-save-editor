import type { Item, SaveData } from '../model/saveSchema.ts';
import { newPetSlot, type NewPet } from './dwellerOps.ts';

// Pure, immutable STORAGE edit operations on
// `vault.inventory.items[]`. Like dwellerOps, every op is `(save, …args) => SaveData`
// with no mutation: it returns a new save that shares every untouched item and
// top-level key by reference (structural sharing), so the store records one edit as
// one cheap undo snapshot via a single applyEdit.
//
// Weapons / outfits / junk are FUNGIBLE - grouped by id with a count. They are
// written as plain `{id, type, …flags}` items; the count is just how many such entries
// the array holds. When a group shrinks we drop the SURPLUS entries (keeping the first
// N by reference) rather than rebuilding the group, so any existing item objects - and
// the unknown keys they carry (crafted/legendary extraData) - round-trip unchanged.
//
// Pets are INSTANCES and are never grouped: each is a distinct
// entry with its own rolled bonus value + unique name. They are removed individually by
// array index and granted as fresh instances. The id guard (only real catalog ids
// are writable) is applied by the UI call site, which surfaces ids from game data.

/** Stored item types that group by id with a fungible count (pets are instanced - excluded). */
export type StackableType = 'Weapon' | 'Outfit' | 'Junk';

// The flags the game writes on a fresh stored-item slot (mirrors dwellerOps' SLOT_FLAGS).
const SLOT_FLAGS = { hasBeenAssigned: false, hasRandonWeaponBeenAssigned: false } as const;

/** A plain stored item (weapon/outfit/junk) - the game's fresh-slot flags, no extraData. */
const plainItem = (id: string, type: StackableType): Item => ({ id, type, ...SLOT_FLAGS });

/** Current `vault.inventory.items` as an array (empty if absent). */
function inventoryItems(save: SaveData): Item[] {
  const items = save.vault?.inventory?.items;
  return Array.isArray(items) ? items : [];
}

/** Return a new save whose `vault.inventory.items` is `items`, sharing other vault keys. */
function withInventoryItems(save: SaveData, items: Item[]): SaveData {
  const vault = save.vault ?? {};
  const inventory = vault.inventory ?? {};
  return { ...save, vault: { ...vault, inventory: { ...inventory, items } } };
}

/** Number of stored items of (type, id). */
export function itemCount(save: SaveData, type: StackableType, id: string): number {
  return inventoryItems(save).filter((i) => i.type === type && i.id === id).length;
}

/**
 * Set the stored count of a grouped (type, id) to exactly `count` (clamped to a
 * non-negative integer). Shrinking drops the surplus entries beyond the first `count`
 * (existing objects kept by reference); growing appends plain items for the delta;
 * `count = 0` removes the group. No-op (returns the same save) if already at `count`.
 */
export function setItemCount(
  save: SaveData,
  type: StackableType,
  id: string,
  count: number,
): SaveData {
  const target = Math.max(0, Math.trunc(count));
  const items = inventoryItems(save);
  const current = items.filter((i) => i.type === type && i.id === id).length;
  if (current === target) return save;

  if (target < current) {
    let kept = 0;
    const next = items.filter((i) => {
      if (i.type !== type || i.id !== id) return true;
      if (kept < target) {
        kept += 1;
        return true;
      }
      return false;
    });
    return withInventoryItems(save, next);
  }

  const additions = Array.from({ length: target - current }, () => plainItem(id, type));
  return withInventoryItems(save, items.concat(additions));
}

/**
 * Add `count` plain items of (type, id) to storage (additive - the add-flow / grant
 * write path, including "grant legendary"). No-op if `count <= 0`.
 */
export function grantItems(
  save: SaveData,
  type: StackableType,
  id: string,
  count: number,
): SaveData {
  const n = Math.max(0, Math.trunc(count));
  if (n === 0) return save;
  const additions = Array.from({ length: n }, () => plainItem(id, type));
  return withInventoryItems(save, inventoryItems(save).concat(additions));
}

/**
 * Remove the stored item at `index` (used for pet instances, which are listed and
 * removed individually). No-op (returns the same save) if the index is out of range.
 */
export function removeStoredItemAt(save: SaveData, index: number): SaveData {
  const items = inventoryItems(save);
  if (index < 0 || index >= items.length) return save;
  return withInventoryItems(
    save,
    items.filter((_, i) => i !== index),
  );
}

/**
 * Grant a newly-created pet instance directly into storage (unequipped). The locked
 * bonus + value-range clamp are applied by the UI call site, same as the
 * equip-from-create flow; storage just receives the finished instance.
 */
export function addPet(save: SaveData, pet: NewPet): SaveData {
  return withInventoryItems(save, inventoryItems(save).concat(newPetSlot(pet)));
}
