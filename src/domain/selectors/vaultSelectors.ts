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

/**
 * The game's hard ceiling on dwellers (DwellerManager.m_maximumDwellerCount, a code
 * constant - not stored in the save or any prefab). ClampedMaxDwellers clamps to it.
 */
const VAULT_DWELLER_CAP = 200;

/**
 * The vault's dweller capacity, exactly as the game derives it: the sum of every
 * living quarters room's `populationIncrease` at its current (mergeLevel, level)
 * (LivingQuartersRoom.UpdateAddedPopulation), clamped to the hard 200 ceiling
 * (Vault.ClampedMaxDwellers). Nothing else contributes - a vault with no living
 * quarters has capacity 0.
 */
export function computePopulationCap(save: SaveData, catalog: RoomCapacity): number {
  let cap = 0;
  for (const room of save.vault?.rooms ?? []) {
    const contribution = roomContribution(catalog, room.type, room.mergeLevel, room.level);
    cap += contribution?.populationIncrease ?? 0;
  }
  return Math.min(cap, VAULT_DWELLER_CAP);
}

/**
 * The game's cap on the vault-door waiting line (DwellerSpawner.m_dwellersWaitingQueueSize).
 * Dwellers and Mr. Handies share the ONE queue; past it the game refuses arrivals with a
 * "hack to protect the savegame" warning.
 */
export const DOOR_QUEUE_CAP = 10;

/** How full the vault and its door queue are - the add-dweller flows' legality check. */
export interface DwellerCapacity {
  /** Dwellers who count against the cap: non-evicted entries minus new arrivals still
   *  waiting at the door (DwellerManager.ValidDwellers). */
  population: number;
  /** Living-quarters-derived capacity (200-ceiling fallback without the catalog). */
  populationCap: number;
  /** Characters in the door queue - dwellers AND robots (the game caps the line). */
  waiting: number;
  /** Open in-vault slots (0 when at or over cap - over-cap saves exist in the wild). */
  vaultFree: number;
  /** Open door-queue slots. */
  doorFree: number;
}

/** Compute the vault + door-queue occupancy exactly as the game counts it. */
export function dwellerCapacity(save: SaveData, catalog?: RoomCapacity): DwellerCapacity {
  const dwellers = save.dwellers?.dwellers ?? [];
  const waitingList = save.dwellerSpawner?.dwellersWaiting ?? [];
  const waitingHumans = waitingList.filter((w) => typeof w?.dwellerId === 'number').length;
  const nonEvicted = dwellers.filter((d) => d.IsEvictedWaitingForFollowers !== true).length;
  const population = nonEvicted - waitingHumans;
  const populationCap = catalog ? computePopulationCap(save, catalog) : VAULT_DWELLER_CAP;
  return {
    population,
    populationCap,
    waiting: waitingList.length,
    vaultFree: Math.max(0, populationCap - population),
    doorFree: Math.max(0, DOOR_QUEUE_CAP - waitingList.length),
  };
}

/** At-a-glance vault metrics surfaced on the Vault overview tiles. Save-derivable except
 *  populationCap (needs the room-capacity catalog; falls back to the 200 ceiling);
 *  vacant work slots (needs room capacity) are computed by the caller from the advisor. */
export interface VaultMetrics {
  /** Total rooms placed (includes elevators). */
  roomCount: number;
  /** Alive dwellers (the population that counts against the cap). */
  population: number;
  /** Living-quarters-derived dweller capacity (200 ceiling fallback without catalog). */
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

/**
 * Compute the overview metric tiles. The room-capacity catalog is optional (tiles
 * render before game data resolves); without it populationCap falls back to the
 * 200 ceiling rather than showing a wrong living-quarters sum.
 */
export function vaultMetrics(save: SaveData, catalog?: RoomCapacity): VaultMetrics {
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
    populationCap: catalog ? computePopulationCap(save, catalog) : VAULT_DWELLER_CAP,
    avgLevel: alive.length ? levelSum / alive.length : 0,
    petsOwned: storedPets + equippedPets,
    weapons,
    outfits,
    junk,
  };
}
