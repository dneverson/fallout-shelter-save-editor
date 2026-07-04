import type { SaveData } from '../model/saveSchema.ts';

// ERoomType → room-unlock objective id (the strings in `unlockableMgr.claimed`, also the
// gameData.unlockables.roomUnlocks catalog the Vault "Unlock all rooms" action writes).
// SOURCE OF TRUTH: the game's Unlockable MGR objectives matched to the ERoomType catalog -
// the ids are IRREGULAR (Bar→BarUnlock, but Casino→GameRoomUnlock, Radio→RadioStationUnlock),
// so they're transcribed verbatim, not derived. The build script only scrapes the *Unlock
// strings; it carries no room association, which is why this map lives here.
//
// The advanced production rooms have their OWN objective, distinct from their basic
// counterpart, which is a free starter room with no objective: Energy2 (Nuclear Reactor,
// unlocks at 60 dwellers) → PowerPlantUnlock - the basic Geothermal (Power Generator) is a
// starter; Water2 (Water Purification) → WaterroomUnlock - the basic WaterPlant is a starter.
// SuperRoom2 is the Fitness Room (Endurance training) → CardioUnlock.
//
// The free starter rooms - Cafeteria (Diner), Geothermal, WaterPlant, LivingQuarters, Elevator
// - have NO unlock objective (available from the start) and are intentionally absent: they're
// always considered unlocked. Overseer is listed for completeness but is a Quest-class room, so
// it never appears in the Build palette and can only be unlocked via "Unlock all rooms".
// Verified complete against the game's Unlockable MGR prefab (exactly 23 UnlockRoom_* objectives).
const UNLOCK_ID_BY_ROOM_TYPE: Record<string, string> = {
  Armory: 'ArmoryUnlock',
  Bar: 'BarUnlock',
  BarberShop: 'BarberShopUnlock',
  Casino: 'GameRoomUnlock',
  Classroom: 'ClassUnlock',
  DecorationFactory: 'DecorationFactoryUnlock',
  DesignFactory: 'DesignFactoryUnlock',
  Dojo: 'DojoUnlock',
  Energy2: 'PowerPlantUnlock',
  Gym: 'GymUnlock',
  Hydroponic: 'HydroponicUnlock',
  MedBay: 'MedbayUnlock',
  NukaCola: 'NukacolaUnlock',
  OutfitFactory: 'OutfitFactoryUnlock',
  Overseer: 'OverseerUnlock',
  Radio: 'RadioStationUnlock',
  ScienceLab: 'SciencelabUnlock',
  Storage: 'StorageUnlock',
  SuperRoom2: 'CardioUnlock',
  UltraciteMining: 'UltraciteMiningUnlock',
  UltraciteWeaponFactory: 'UltraciteWeaponFactoryUnlock',
  Water2: 'WaterroomUnlock',
  WeaponFactory: 'WeaponFactoryUnlock',
};

/** The room-unlock objective id for a room type, or null if the type is a free starter room. */
export function unlockIdForRoomType(roomType: string): string | null {
  return UNLOCK_ID_BY_ROOM_TYPE[roomType] ?? null;
}

/**
 * Whether a room type is unlocked in this save - true for free starter rooms (no objective),
 * otherwise whether its unlock id is present in `unlockableMgr.claimed`.
 */
export function isRoomTypeUnlocked(save: SaveData, roomType: string): boolean {
  const id = UNLOCK_ID_BY_ROOM_TYPE[roomType];
  if (!id) return true;
  return (save.unlockableMgr?.claimed ?? []).includes(id);
}

/**
 * Mark a room type's unlock objective as claimed (append its id to `unlockableMgr.claimed`).
 * No-op - returns the SAME save - for free starter rooms or an already-claimed unlock, so it
 * composes cleanly with addRoom inside a single applyEdit (building a locked room unlocks it
 * as one undo step).
 */
export function claimRoomUnlock(save: SaveData, roomType: string): SaveData {
  const id = UNLOCK_ID_BY_ROOM_TYPE[roomType];
  if (!id) return save;
  const claimed = save.unlockableMgr?.claimed ?? [];
  if (claimed.includes(id)) return save;
  return {
    ...save,
    unlockableMgr: { ...save.unlockableMgr, claimed: [...claimed, id] },
  };
}
