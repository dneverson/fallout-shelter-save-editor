import type { GameData } from '../gamedata/gameData.ts';
import type { Outfit, Pet, Special, Weapon } from '../gamedata/schemas.ts';
import type { SaveData } from '../model/saveSchema.ts';

// Suggestion helpers for location loadouts. A room's primary SPECIAL (room metadata,
// ESpecialStat name) maps to a SPECIAL key; the strongest outfit for that key, the
// best-average-damage weapon, and the pet whose locked bonus matches the room's job are
// the defaults the loadout panel pre-selects (user-overridable).

/** SPECIAL key letters in S P E C I A L order. */
export const STAT_KEYS = ['S', 'P', 'E', 'C', 'I', 'A', 'L'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

const SPECIAL_NAME_TO_KEY: Record<string, StatKey> = {
  Strength: 'S',
  Perception: 'P',
  Endurance: 'E',
  Charisma: 'C',
  Intelligence: 'I',
  Agility: 'A',
  Luck: 'L',
};

/** ESpecialStat name (room.primaryStat) → SPECIAL key, or null for None/unknown. */
export function statKeyForSpecial(name: string | undefined): StatKey | null {
  return name ? (SPECIAL_NAME_TO_KEY[name] ?? null) : null;
}

/** The outfit granting the most of `statKey` (tie-break: higher total SPECIAL, then name). */
export function suggestOutfitForStat(gameData: GameData, statKey: StatKey): Outfit | null {
  let best: Outfit | null = null;
  let bestScore = -1;
  let bestTotal = -1;
  for (const outfit of gameData.outfits) {
    const score = outfit.special[statKey];
    const total = STAT_KEYS.reduce((sum, k) => sum + outfit.special[k as keyof Special], 0);
    if (score > bestScore || (score === bestScore && total > bestTotal)) {
      best = outfit;
      bestScore = score;
      bestTotal = total;
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * The best-average-damage weapon (tie-break: higher min damage, i.e. more consistent).
 * Average beats raw max because damage is rolled per shot: in the shipped catalog this
 * lands on Dragon's Maw (22-29, avg 25.5) over the swingier Super Sledge (18-32, avg 25).
 */
export function suggestWeapon(gameData: GameData): Weapon | null {
  let best: Weapon | null = null;
  const avg = (w: Weapon): number => w.damageMin + w.damageMax;
  for (const weapon of gameData.weapons) {
    if (
      !best ||
      avg(weapon) > avg(best) ||
      (avg(weapon) === avg(best) && weapon.damageMin > best.damageMin)
    ) {
      best = weapon;
    }
  }
  return best;
}

// --- pet suggestion (per room job) ------------------------------------------------
// A pet's bonus EFFECT is locked per catalog id, so "the right pet" is the id whose
// bonus matches what the room's occupants do, at the breed with the highest bonusMax
// (the apply path grants it at that max).

/** Sentinel "room type" for the synthetic wasteland/unassigned loadout row. */
export const WASTELAND_LOADOUT_TYPE = 'Wasteland';

/** Training rooms prefer the legendary-tier effect (26-30%) over the rare one (16-20%). */
const TRAINING_BONUSES = ['TrainingNonStopBoost', 'TrainingBoost'] as const;

/** Producing rooms → XP gain (no pet bonus affects production output itself). */
const PRODUCTION_BONUSES = ['XPBoost'] as const;

/** Room type → EBonusEffects that serve that room's job, best first. Unlisted types
 *  (storage, barbershop, overseer/quest rooms) get no pet suggestion. */
const ROOM_PET_BONUS: Record<string, readonly string[]> = {
  // Crafting rooms → faster & cheaper crafting.
  WeaponFactory: ['FasterAndCheaperCrafting'],
  OutfitFactory: ['FasterAndCheaperCrafting'],
  UltraciteWeaponFactory: ['FasterAndCheaperCrafting'],
  DecorationFactory: ['FasterAndCheaperCrafting'],
  DesignFactory: ['FasterAndCheaperCrafting'],
  // Living quarters → child SPECIAL boost.
  LivingQuarters: ['ChildSpecialBoost'],
  // Training rooms (one per SPECIAL) → training speed.
  Gym: TRAINING_BONUSES,
  Armory: TRAINING_BONUSES,
  SuperRoom2: TRAINING_BONUSES,
  Bar: TRAINING_BONUSES,
  Classroom: TRAINING_BONUSES,
  Dojo: TRAINING_BONUSES,
  Casino: TRAINING_BONUSES,
  // Producing rooms (power/food/water/med/science/mining/radio) → max XP gain.
  Energy2: PRODUCTION_BONUSES,
  Geothermal: PRODUCTION_BONUSES,
  Cafeteria: PRODUCTION_BONUSES,
  Hydroponic: PRODUCTION_BONUSES,
  Water2: PRODUCTION_BONUSES,
  WaterPlant: PRODUCTION_BONUSES,
  NukaCola: PRODUCTION_BONUSES,
  MedBay: PRODUCTION_BONUSES,
  ScienceLab: PRODUCTION_BONUSES,
  UltraciteMining: PRODUCTION_BONUSES,
  Radio: PRODUCTION_BONUSES,
  // Vault door → incident damage resistance.
  Entrance: ['Resistance'],
  // Wasteland/unassigned pseudo-row → max HP for survival out there.
  [WASTELAND_LOADOUT_TYPE]: ['AddMaxHP'],
};

/** Room type → fixed outfit id, overriding the stat-based pick (Entrance guards get
 *  Death's Jacket: P/E/A/L +4, the guard-duty legendary). Ignored if not in the catalog. */
const ROOM_OUTFIT_ID: Record<string, string> = {
  Entrance: 'Horseman_DeathJacket',
};

/** The outfit for a loadout row: the per-room override when catalogued, else the
 *  strongest outfit for the row's primary stat (null without either). */
export function suggestOutfitForRoomType(
  gameData: GameData,
  roomType: string,
  statKey: StatKey | null,
): Outfit | null {
  const overrideId = ROOM_OUTFIT_ID[roomType];
  const override = overrideId ? gameData.outfitById.get(overrideId) : undefined;
  if (override) return override;
  return statKey ? suggestOutfitForStat(gameData, statKey) : null;
}

/** The pet with the highest `bonusMax` for an EBonusEffect, or null when none match. */
export function bestPetForBonus(gameData: GameData, bonus: string): Pet | null {
  let best: Pet | null = null;
  for (const pet of gameData.pets) {
    if (pet.bonus !== bonus) continue;
    if (!best || pet.bonusMax > best.bonusMax) best = pet;
  }
  return best;
}

/** The strongest pet serving `roomType`'s job, or null for rooms with no matching bonus. */
export function suggestPetForRoomType(gameData: GameData, roomType: string): Pet | null {
  for (const bonus of ROOM_PET_BONUS[roomType] ?? []) {
    const pet = bestPetForBonus(gameData, bonus);
    if (pet) return pet;
  }
  return null;
}

/** A room type present in the vault, with its primary stat + the dwellers assigned to it. */
export interface LoadoutRoomType {
  type: string;
  name: string;
  primaryStat: string;
  statKey: StatKey | null;
  dwellerIds: number[];
}

/**
 * Room types the vault actually has that train/use a SPECIAL (excludes elevators + facilities
 * with no primary stat - EXCEPT the Entrance, which is stat-less but has a catered pet:
 * guards want Resistance), each with the serializeIds of the dwellers currently in those
 * rooms. Sorted by room-type name. Drives the loadout panel ("lists only the room types
 * the vault has").
 */
export function vaultLoadoutRoomTypes(save: SaveData, gameData: GameData): LoadoutRoomType[] {
  const byType = new Map<string, LoadoutRoomType>();
  for (const room of save.vault?.rooms ?? []) {
    const meta = gameData.roomMetadataByType.get(room.type);
    const statKey = statKeyForSpecial(meta?.primaryStat);
    if (!statKey && !(room.type in ROOM_PET_BONUS)) continue; // elevators + no-stat facilities
    let entry = byType.get(room.type);
    if (!entry) {
      entry = {
        type: room.type,
        name: meta?.name ?? room.type,
        primaryStat: statKey ? (meta?.primaryStat ?? '') : '',
        statKey,
        dwellerIds: [],
      };
      byType.set(room.type, entry);
    }
    for (const id of room.dwellers ?? []) entry.dwellerIds.push(id);
  }
  return [...byType.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Synthetic loadout row for dwellers on NO room's roster - wasteland explorers plus
 * at-door idlers (`savedRoom` alone can't tell them apart; explorers and rostered-but-
 * wandering dwellers both carry -1, see advisorSelectors). Endurance is the catered
 * stat (survival HP) and the pet suggestion is AddMaxHP. Null when everyone is rostered.
 */
export function wastelandLoadoutRoomType(save: SaveData): LoadoutRoomType | null {
  const rostered = new Set<number>();
  for (const room of save.vault?.rooms ?? [])
    for (const id of room.dwellers ?? []) rostered.add(id);
  const ids = (save.dwellers?.dwellers ?? [])
    .filter((d) => (d.health?.healthValue ?? 1) > 0 && !rostered.has(d.serializeId))
    .map((d) => d.serializeId);
  if (ids.length === 0) return null;
  return {
    type: WASTELAND_LOADOUT_TYPE,
    name: 'Wasteland',
    primaryStat: 'Explorers & unassigned',
    statKey: 'E',
    dwellerIds: ids,
  };
}
