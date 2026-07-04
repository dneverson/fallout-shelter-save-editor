import type { RoomCapacity } from '../gamedata/schemas.ts';
import type { SaveData } from '../model/saveSchema.ts';

// Pure capacity selectors for the vault. A resource/item cap
// is DERIVED, never stored: it's the game's base maximum plus each room's contribution
// at its current (mergeLevel, level), plus per-dweller scaling for consumables. The
// formula mirrors Vault.SetMaxResources / Inventory.SetMaxItems and is validated
// against a maxed Vault1.sav (computed Food/Water/Energy caps equal the in-save values).

/** Number of dwellers (per-dweller consumable caps scale with this). */
export function dwellerCount(save: SaveData): number {
  return save.dwellers?.dwellers?.length ?? 0;
}

/** The capacity contribution of one room at its current (mergeLevel, level), or null. */
function roomContribution(
  catalog: RoomCapacity,
  type: string,
  mergeLevel?: number,
  level?: number,
) {
  if (mergeLevel === undefined || level === undefined) return null;
  return catalog.rooms[type]?.[String(mergeLevel)]?.[String(level)] ?? null;
}

/**
 * Legal max for every resource: base maximum + Σ each room's `storage` contribution +
 * per-dweller scaling (StimPack/RadAway). Keyed by save resource key (Food/Energy/…).
 * This is the map the "Max resources" button writes (vaultOps.maxResources).
 */
export function computeResourceCaps(save: SaveData, catalog: RoomCapacity): Record<string, number> {
  const caps: Record<string, number> = { ...catalog.base.resources };

  for (const room of save.vault?.rooms ?? []) {
    const contribution = roomContribution(catalog, room.type, room.mergeLevel, room.level);
    if (!contribution) continue;
    for (const [key, value] of Object.entries(contribution.storage)) {
      caps[key] = (caps[key] ?? 0) + value;
    }
  }

  const dwellers = dwellerCount(save);
  for (const [key, perDweller] of Object.entries(catalog.perDweller)) {
    caps[key] = (caps[key] ?? 0) + perDweller * dwellers;
  }

  return caps;
}

/**
 * Legal max number of stored items (weapons/outfits/junk/pets) - base + Σ each
 * storage-bearing room's `storageItems` contribution. The capacity-meter denominator.
 */
export function computeItemCapacity(save: SaveData, catalog: RoomCapacity): number {
  let cap = catalog.base.items;
  for (const room of save.vault?.rooms ?? []) {
    const contribution = roomContribution(catalog, room.type, room.mergeLevel, room.level);
    if (contribution) cap += contribution.storageItems;
  }
  return cap;
}

/** In-game hard ceiling on living dwellers (Vault.MAX_DWELLERS); not stored in the save. */
const VAULT_DWELLER_CAP = 200;

/** At-a-glance vault metrics surfaced on the Vault overview tiles. Save-derivable only;
 *  vacant work slots (needs room capacity) are computed by the caller from the advisor. */
export interface VaultMetrics {
  /** Total rooms placed (includes elevators). */
  roomCount: number;
  /** Alive dwellers (the population that counts against the cap). */
  population: number;
  /** In-game dweller ceiling (200). */
  populationCap: number;
  /** Mean currentLevel of alive dwellers (0 when none). */
  avgLevel: number;
  /** Pets owned = stored pet items + pets equipped on dwellers. */
  petsOwned: number;
  /** Stored weapon items. */
  weapons: number;
  /** Stored outfit items. */
  outfits: number;
  /** Stored junk items. */
  junk: number;
}

const isAliveDweller = (h: number | undefined): boolean => (h ?? 1) > 0;

/** Compute the overview metric tiles from the save alone (no game data required). */
export function vaultMetrics(save: SaveData): VaultMetrics {
  const dwellers = save.dwellers?.dwellers ?? [];
  const alive = dwellers.filter((d) => isAliveDweller(d.health?.healthValue));
  const levelSum = alive.reduce((n, d) => n + (d.experience?.currentLevel ?? 1), 0);
  const equippedPets = dwellers.filter((d) => d.equippedPet?.id).length;

  const items = save.vault?.inventory?.items ?? [];
  let weapons = 0;
  let outfits = 0;
  let junk = 0;
  let storedPets = 0;
  for (const it of items) {
    if (it.type === 'Weapon') weapons++;
    else if (it.type === 'Outfit') outfits++;
    else if (it.type === 'Junk') junk++;
    else if (it.type === 'Pet') storedPets++;
  }

  return {
    roomCount: save.vault?.rooms?.length ?? 0,
    population: alive.length,
    populationCap: VAULT_DWELLER_CAP,
    avgLevel: alive.length ? levelSum / alive.length : 0,
    petsOwned: storedPets + equippedPets,
    weapons,
    outfits,
    junk,
  };
}
