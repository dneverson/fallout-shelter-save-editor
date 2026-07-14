import type { SaveData } from '../model/saveSchema.ts';
import type { GuideCodeIndex } from '../items/collectionCatalog.ts';
import { addCollectionEntries, type CollectionKey } from './collectionOps.ts';

// Survival Guide AUTO-COLLECT: when an edit introduces a new object into the save -
// an item granted to storage, gear equipped from a picker/loadout, a pet created, a
// special dweller added - its guide entry is marked collected in the same edit,
// mirroring the game's SurvivalWindow.OnNewItem / OnNewUniqueDweller (which fire on
// every in-game acquisition). Wired centrally into saveStore.applyEdit so EVERY add
// path is covered without threading game data through each op.
//
// Deliberately one-directional: removing objects (or guide entries) never touches the
// guide - un-collecting is a manual, explicit action on the Survival Guide tab.
//
// "Introduced" = the per-id object count grew between the previous and next save,
// counting storage (`vault.inventory.items`) plus every dweller's equipped
// weapon/outfit/pet. Moves between those places keep counts flat, so equip/unequip/
// store shuffles never trigger a collect.

/** Multiset of collectible object ids, keyed "«type»:«id»" (types: Weapon/Outfit/Junk/Pet). */
function objectCounts(save: SaveData): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (type: string | undefined, id: string | undefined): void => {
    if (!type || !id) return;
    const key = `${type}:${id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  const items = save.vault?.inventory?.items;
  if (Array.isArray(items)) for (const item of items) bump(item.type, item.id);
  for (const d of save.dwellers?.dwellers ?? []) {
    bump(d.equipedWeapon?.type, d.equipedWeapon?.id);
    bump(d.equipedOutfit?.type, d.equipedOutfit?.id);
    bump(d.equippedPet?.type, d.equippedPet?.id);
  }
  return counts;
}

/** The set of unique-character ids (`uniqueData`) present on the roster. */
function uniqueDwellerIds(save: SaveData): Set<string> {
  const ids = new Set<string>();
  for (const d of save.dwellers?.dwellers ?? []) {
    if (typeof d.uniqueData === 'string' && d.uniqueData) ids.add(d.uniqueData);
  }
  return ids;
}

/**
 * Mark the guide entry of every object `next` gained over `prev` as collected ("N",
 * the game's new-acquisition state). Objects with no guide entry (casual outfits, the
 * default Fist, unknown ids) are ignored. Returns `next` unchanged (same ref) when
 * nothing qualifies - already-collected entries are left as they are.
 */
export function autoCollectNewObjects(
  prev: SaveData,
  next: SaveData,
  index: GuideCodeIndex,
): SaveData {
  const adds = new Map<CollectionKey, string[]>();
  const add = (key: CollectionKey, code: string | null | undefined): void => {
    if (!code) return;
    const codes = adds.get(key) ?? [];
    codes.push(code);
    adds.set(key, codes);
  };

  const before = objectCounts(prev);
  for (const [key, count] of objectCounts(next)) {
    if (count <= (before.get(key) ?? 0)) continue;
    const sep = key.indexOf(':');
    const type = key.slice(0, sep);
    const id = key.slice(sep + 1);
    if (type === 'Weapon') add('weapons', index.weapons.get(id));
    else if (type === 'Outfit') add('outfits', index.outfits.get(id));
    else if (type === 'Junk') add('junk', index.junk.get(id));
    else if (type === 'Pet') {
      const pet = index.pets.get(id);
      add('pets', pet?.petCode);
      add('breeds', pet?.breedCode);
    }
  }

  const knownBefore = uniqueDwellerIds(prev);
  for (const id of uniqueDwellerIds(next)) {
    if (!knownBefore.has(id) && index.dwellers.has(id)) add('dwellers', id);
  }

  let out = next;
  for (const [key, codes] of adds) out = addCollectionEntries(out, key, codes);
  return out;
}
