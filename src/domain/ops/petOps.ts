import type { Dweller, Item, SaveData } from '../model/saveSchema.ts';
import type { PetLocation } from '../selectors/petSelectors.ts';
import {
  attachPetFromStorage,
  deleteEquippedPet,
  detachPet,
  editEquippedPet,
} from './dwellerOps.ts';
import { removeStoredItemAt } from './storageOps.ts';

// Location-aware pet-instance edits for the Pets section. A pet
// instance lives either equipped on a dweller or loose in storage (petSelectors), so
// these ops dispatch on a `PetLocation` and delegate to the existing equipped-pet
// primitives (dwellerOps) or the stored-item primitives (storageOps), implementing
// only the genuinely new stored-instance edit. Every op is pure + structural-sharing
// + one `applyEdit` = one undo (mirrors dwellerOps/storageOps); the locked bonus
// EFFECT is never changed and value/id guards stay at the UI call site.

/** Edits the detail sheet applies to one pet instance. */
export interface PetEdit {
  uniqueName?: string;
  bonusValue?: number;
}

/** Current `vault.inventory.items` as an array (empty if absent). */
function inventoryItems(save: SaveData): Item[] {
  const items = save.vault?.inventory?.items;
  return Array.isArray(items) ? items : [];
}

/** Current `dwellers.dwellers` as an array (empty if absent). */
function dwellerList(save: SaveData): Dweller[] {
  const list = save.dwellers?.dwellers;
  return Array.isArray(list) ? list : [];
}

/** Return a new save whose `vault.inventory.items` is `items`, sharing other vault keys. */
function withInventoryItems(save: SaveData, items: Item[]): SaveData {
  const vault = save.vault ?? {};
  const inventory = vault.inventory ?? {};
  return { ...save, vault: { ...vault, inventory: { ...inventory, items } } };
}

/** Edit a STORED pet's unique name and/or rolled value (bonus EFFECT untouched). */
function editStoredPet(save: SaveData, index: number, changes: PetEdit): SaveData {
  const items = inventoryItems(save);
  const item = items[index];
  if (!item || item.type !== 'Pet') return save;
  const extraData = { ...item.extraData };
  if (changes.uniqueName !== undefined) extraData.uniqueName = changes.uniqueName;
  if (changes.bonusValue !== undefined) extraData.bonusValue = changes.bonusValue;
  const next = items.slice();
  next[index] = { ...item, extraData };
  return withInventoryItems(save, next);
}

/**
 * Edit a pet instance's unique name and/or rolled bonus value, wherever it lives. The
 * bonus EFFECT stays locked. No-op if the location no longer resolves to a pet.
 */
export function editPet(save: SaveData, location: PetLocation, changes: PetEdit): SaveData {
  return location.kind === 'equipped'
    ? editEquippedPet(save, location.dwellerId, changes)
    : editStoredPet(save, location.index, changes);
}

/**
 * Set every owned pet instance's rolled bonus value to its legal maximum, in one pass
 * (one applyEdit = one undo). Covers both equipped pets (each dweller's `equippedPet`) and
 * loose pets in storage. `maxFor` resolves a pet catalog id to its legal max bonus value,
 * returning null for ids it can't resolve (those instances are left untouched). Delegates to
 * `editPet` per instance; stored indexes stay valid because a value edit never reorders the
 * inventory array.
 */
export function maxPetStats(save: SaveData, maxFor: (petId: string) => number | null): SaveData {
  let next = save;

  for (const dweller of dwellerList(save)) {
    const pet = dweller.equippedPet;
    if (!pet || pet.type !== 'Pet') continue;
    const max = maxFor(pet.id);
    if (max == null) continue;
    next = editPet(next, { kind: 'equipped', dwellerId: dweller.serializeId }, { bonusValue: max });
  }

  inventoryItems(save).forEach((item, index) => {
    if (item.type !== 'Pet') return;
    const max = maxFor(item.id);
    if (max == null) return;
    next = editPet(next, { kind: 'stored', index }, { bonusValue: max });
  });

  return next;
}

/**
 * Equip the pet instance at `location` onto `dwellerId`, swapping any pet that dweller
 * already wears back to storage. A stored instance is attached directly; an instance
 * equipped on a DIFFERENT dweller is first detached to storage, then attached from
 * there; re-assigning an instance to the dweller already wearing it is a no-op.
 */
export function assignPet(save: SaveData, location: PetLocation, dwellerId: number): SaveData {
  if (location.kind === 'stored') {
    return attachPetFromStorage(save, dwellerId, location.index);
  }
  if (location.dwellerId === dwellerId) return save;
  // Detach from the current owner (appends to the end of inventory), then attach
  // that just-stored instance onto the target dweller.
  const detached = detachPet(save, location.dwellerId);
  return attachPetFromStorage(detached, dwellerId, inventoryItems(detached).length - 1);
}

/** Send an equipped pet back to storage; a stored instance is already there (no-op). */
export function sendPetToStorage(save: SaveData, location: PetLocation): SaveData {
  return location.kind === 'equipped' ? detachPet(save, location.dwellerId) : save;
}

/** Delete the pet instance outright (not returned to storage) wherever it lives. */
export function deletePet(save: SaveData, location: PetLocation): SaveData {
  return location.kind === 'equipped'
    ? deleteEquippedPet(save, location.dwellerId)
    : removeStoredItemAt(save, location.index);
}

/**
 * Delete several pet instances in one pass (one applyEdit = one undo step). Equipped
 * deletes are keyed by dwellerId (stable), but stored deletes shift the inventory array,
 * so stored indexes are removed in DESCENDING order to keep the remaining ones valid.
 */
export function deletePets(save: SaveData, locations: PetLocation[]): SaveData {
  const stored = locations
    .filter((l): l is Extract<PetLocation, { kind: 'stored' }> => l.kind === 'stored')
    .sort((a, b) => b.index - a.index);
  let next = save;
  for (const loc of locations) {
    if (loc.kind === 'equipped') next = deleteEquippedPet(next, loc.dwellerId);
  }
  for (const loc of stored) next = removeStoredItemAt(next, loc.index);
  return next;
}
