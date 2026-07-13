import type { Dweller, DwellerRarity, Gender, Item, SaveData } from '../model/saveSchema.ts';
import type { UniqueDweller } from '../gamedata/schemas.ts';
import { MAX_DWELLER_HP, maxHpForLevel } from './dwellerHealth.ts';

// Pure, immutable dweller edit operations. Every op is `(save, serializeId, …args) => SaveData`
// with no mutation: it returns a new save that shares every untouched subtree by
// reference (structural sharing via spread). That sharing is what makes the
// store's full-save-snapshot undo/redo cheap - a snapshot is a new spine plus
// references, not a deep copy.
//
// Game-legal ranges are clamped by default. The bounded setters
// (`setStat`/`setLevel`/`setHappiness`) accept `{ clamp: false }` so the
// "allow out-of-range" power toggle can write raw values; clamping stays the
// default so every existing call site (and bulkOps) keeps game-legal behavior.
// Vitals still floor at 0 regardless - a negative HP/radiation breaks the game,
// and those fields have no upper bound to override.
//
// Equip ops (weapon/outfit/pet) write the `{id, type, …}` slot shape verified in the
// real save, preserving unknown keys (hasBeenAssigned, hasRandonWeaponBeenAssigned, …).
// Weapons/outfits are never empty in-game, so "unequip" resets to the bare defaults
// (Fist / jumpsuit). Pets are instances: attaching from
// storage or creating one swaps any current pet back to inventory; detaching returns it
// to inventory and DELETES the optional `equippedPet` key (round-trip fidelity). These
// ops stay pure and game-data-free; the id guard + pet value-range clamp are
// applied by the UI call site (the pickers only surface valid catalog ids).

/** Thrown when an op targets a `serializeId` that no dweller has. */
export class DwellerNotFoundError extends Error {
  constructor(public readonly serializeId: number) {
    super(`No dweller with serializeId ${serializeId}.`);
    this.name = 'DwellerNotFoundError';
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Opt-out of game-legal clamping for the "allow out-of-range" power toggle. */
export interface ClampOpts {
  clamp?: boolean;
}

/** Clamp to `[lo, hi]` unless the caller opted out of clamping. */
const bound = (n: number, lo: number, hi: number, opts?: ClampOpts): number =>
  opts?.clamp === false ? n : clamp(n, lo, hi);

/** Coerce to an ARGB uint32 (0xAARRGGBB), matching how colors are stored. */
const toUint32 = (n: number): number => Math.trunc(n) >>> 0;

function dwellerList(save: SaveData): Dweller[] {
  const list = save.dwellers?.dwellers;
  if (!Array.isArray(list)) return [];
  return list;
}

function indexOf(save: SaveData, serializeId: number): number {
  return dwellerList(save).findIndex((d) => d.serializeId === serializeId);
}

/**
 * Replace one dweller (located by `serializeId`) with `updater(dweller)`, sharing
 * every other dweller and top-level key by reference. Throws if the id is absent.
 */
function updateDweller(
  save: SaveData,
  serializeId: number,
  updater: (dweller: Dweller) => Dweller,
): SaveData {
  const block = save.dwellers;
  const list = block?.dwellers;
  const idx = list ? list.findIndex((d) => d.serializeId === serializeId) : -1;
  if (!list || idx === -1) throw new DwellerNotFoundError(serializeId);

  const nextList = list.slice();
  nextList[idx] = updater(list[idx]);
  return { ...save, dwellers: { ...block, dwellers: nextList } };
}

// --- Identity / basics ----------------------------------------------------------

export const setName = (save: SaveData, serializeId: number, name: string): SaveData =>
  updateDweller(save, serializeId, (d) => ({ ...d, name }));

export const setLastName = (save: SaveData, serializeId: number, lastName: string): SaveData =>
  updateDweller(save, serializeId, (d) => ({ ...d, lastName }));

export const setGender = (save: SaveData, serializeId: number, gender: Gender): SaveData =>
  updateDweller(save, serializeId, (d) => ({ ...d, gender }));

export const setRarity = (save: SaveData, serializeId: number, rarity: DwellerRarity): SaveData =>
  updateDweller(save, serializeId, (d) => ({ ...d, rarity }));

// --- SPECIAL --------------------------------------------------------------------

/** Set a SPECIAL stat. `statIndex` is 1..7 (S P E C I A L); value clamped 1..10 by default. */
export function setStat(
  save: SaveData,
  serializeId: number,
  statIndex: number,
  value: number,
  opts?: ClampOpts,
): SaveData {
  if (!Number.isInteger(statIndex) || statIndex < 1 || statIndex > 7) {
    throw new RangeError(`SPECIAL statIndex must be an integer 1..7, got ${statIndex}.`);
  }
  return updateDweller(save, serializeId, (d) => {
    const stats = d.stats?.stats ?? [];
    const nextStats = stats.slice();
    nextStats[statIndex] = { ...nextStats[statIndex], value: bound(value, 1, 10, opts) };
    return { ...d, stats: { ...d.stats, stats: nextStats } };
  });
}

// --- Level (resets XP - the game reads currentLevel directly) -------------------

/** The stats.stats index of the base SPECIAL Endurance value (S=1,P=2,E=3,…). */
const ENDURANCE_INDEX = 3;

/** A dweller's base Endurance stat (the raw SPECIAL value), defaulting to 1. */
const baseEndurance = (d: Dweller): number => d.stats?.stats?.[ENDURANCE_INDEX]?.value ?? 1;

/**
 * Set a dweller's level (clamped 1..50 by default, XP reset) AND rescale HP the way the
 * game does at each level-up: maxHealth = maxHpForLevel(level, base Endurance + the
 * equipped outfit's Endurance bonus). The current healthValue is refilled to the new max
 * (a level-up heals) and `lastLevelUpdated` is stamped to `level` so the game agrees and
 * won't recompute on its next in-game level-up. maxHealth is capped at the 644 in-game
 * maximum unless the out-of-range toggle (`clamp:false`) is on.
 *
 * `enduranceBonus` is the outfit's `special.E` (game data lives in the UI layer, so the
 * caller resolves and passes it); it defaults to 0 so game-data-free callers still scale
 * from base Endurance alone.
 */
export const setLevel = (
  save: SaveData,
  serializeId: number,
  level: number,
  opts?: ClampOpts,
  enduranceBonus = 0,
): SaveData =>
  updateDweller(save, serializeId, (d) => {
    const nextLevel = bound(Math.trunc(level), 1, 50, opts);
    const raw = maxHpForLevel(nextLevel, baseEndurance(d) + enduranceBonus);
    const maxHealth = opts?.clamp === false ? raw : Math.min(MAX_DWELLER_HP, raw);
    return {
      ...d,
      experience: {
        ...d.experience,
        currentLevel: nextLevel,
        experienceValue: 0,
        needLvUp: false,
      },
      health: { ...d.health, maxHealth, healthValue: maxHealth, lastLevelUpdated: nextLevel },
    };
  });

// --- Health / radiation / happiness --------------------------------------------

export const setHealth = (save: SaveData, serializeId: number, healthValue: number): SaveData =>
  updateDweller(save, serializeId, (d) => ({
    ...d,
    health: { ...d.health, healthValue: Math.max(0, healthValue) },
  }));

export const setMaxHealth = (save: SaveData, serializeId: number, maxHealth: number): SaveData =>
  updateDweller(save, serializeId, (d) => ({
    ...d,
    health: { ...d.health, maxHealth: Math.max(0, maxHealth) },
  }));

/**
 * Push a dweller to the absolute in-game maximum HP (644): set both maxHealth and the
 * current healthValue to the cap and stamp `lastLevelUpdated` to the current level so the
 * game won't rescale it. This is the explicit "Max HP" cheat - independent of level and
 * Endurance (unlike {@link setLevel}'s natural scaling).
 */
export const maxOutHealth = (save: SaveData, serializeId: number): SaveData =>
  updateDweller(save, serializeId, (d) => ({
    ...d,
    health: {
      ...d.health,
      maxHealth: MAX_DWELLER_HP,
      healthValue: MAX_DWELLER_HP,
      lastLevelUpdated: d.experience?.currentLevel ?? 1,
    },
  }));

export const setRadiation = (
  save: SaveData,
  serializeId: number,
  radiationValue: number,
): SaveData =>
  updateDweller(save, serializeId, (d) => ({
    ...d,
    health: { ...d.health, radiationValue: Math.max(0, radiationValue) },
  }));

export const setHappiness = (
  save: SaveData,
  serializeId: number,
  happinessValue: number,
  opts?: ClampOpts,
): SaveData =>
  updateDweller(save, serializeId, (d) => ({
    ...d,
    happiness: { ...d.happiness, happinessValue: bound(happinessValue, 0, 100, opts) },
  }));

// --- Appearance -----------------------------------------------------------------

/** Set any of the ARGB uint32 colors; only provided channels change. */
export function setColors(
  save: SaveData,
  serializeId: number,
  colors: { skin?: number; hair?: number; outfit?: number },
): SaveData {
  return updateDweller(save, serializeId, (d) => {
    const next = { ...d };
    if (colors.skin !== undefined) next.skinColor = toUint32(colors.skin);
    if (colors.hair !== undefined) next.hairColor = toUint32(colors.hair);
    if (colors.outfit !== undefined) next.outfitColor = toUint32(colors.outfit);
    return next;
  });
}

export const setHair = (save: SaveData, serializeId: number, hair: string): SaveData =>
  updateDweller(save, serializeId, (d) => ({ ...d, hair }));

/**
 * Set facial hair (`faceMask`). Passing `null` clears it by removing the key,
 * matching how unset dwellers are stored (the key is absent, never `null`).
 */
export function setFaceMask(
  save: SaveData,
  serializeId: number,
  faceMask: string | null,
): SaveData {
  return updateDweller(save, serializeId, (d) => {
    if (faceMask === null) {
      const next = { ...d };
      delete next.faceMask;
      return next;
    }
    return { ...d, faceMask };
  });
}

// --- Pregnancy (female only; the op does not gender-gate - the UI does) ---------

export function setPregnancy(
  save: SaveData,
  serializeId: number,
  state: { pregnant?: boolean; babyReady?: boolean },
): SaveData {
  return updateDweller(save, serializeId, (d) => {
    const next = { ...d };
    if (state.pregnant !== undefined) next.pregnant = state.pregnant;
    if (state.babyReady !== undefined) next.babyReady = state.babyReady;
    return next;
  });
}

/**
 * Set a dweller's recorded partner (`relations.partner`, the other parent of a pregnancy;
 * -1 clears). The game records the link on each dweller separately, so this writes ONLY
 * the given dweller's side; unknown relations keys ride through untouched.
 */
export function setPartner(save: SaveData, serializeId: number, partnerId: number): SaveData {
  return updateDweller(save, serializeId, (d) => ({
    ...d,
    relations: { ...(d.relations ?? {}), partner: partnerId },
  }));
}

/**
 * Auto-pick a pregnancy partner: a random alive, adult, opposite-gender dweller,
 * preferring NON-relatives (no shared ascendants, not the dweller's own ancestor or
 * descendant). When only relatives exist, one of them is picked anyway - a recorded
 * partner beats a fatherless pregnancy. Writes only `relations.partner` on
 * `serializeId`; no-op when a partner is already recorded or nobody qualifies.
 */
export function autoPickPartner(
  save: SaveData,
  serializeId: number,
  rng: () => number = Math.random,
): SaveData {
  const list = save.dwellers?.dwellers ?? [];
  const mother = list.find((d) => d.serializeId === serializeId);
  if (!mother) return save;
  if ((mother.relations?.partner ?? -1) !== -1) return save;

  // Ascendants are [father, mother, 4 grandparents]; -1 = unknown slot.
  const motherAsc = new Set((mother.relations?.ascendants ?? []).filter((a) => a >= 0));
  const candidates = list.filter(
    (d) =>
      d.serializeId !== serializeId &&
      (d.health?.healthValue ?? 1) > 0 &&
      d.experience?.currentLevel !== 0 && // level 0 = child
      d.gender !== undefined &&
      mother.gender !== undefined &&
      d.gender !== mother.gender,
  );
  const isRelative = (d: (typeof list)[number]): boolean => {
    const asc = (d.relations?.ascendants ?? []).filter((a) => a >= 0);
    if (asc.some((a) => motherAsc.has(a))) return true; // shared parent/grandparent
    if (asc.includes(serializeId)) return true; // the dweller is this candidate's ancestor
    if (motherAsc.has(d.serializeId)) return true; // the candidate is this dweller's ancestor
    return false;
  };
  const unrelated = candidates.filter((d) => !isRelative(d));
  const pool = unrelated.length > 0 ? unrelated : candidates;
  if (pool.length === 0) return save;
  const chosen = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!;
  return setPartner(save, serializeId, chosen.serializeId);
}

// --- Equipment: weapons & outfits ----------------------------------------------

/** The default (bare) weapon - equipping this is how a weapon slot is "cleared". */
export const DEFAULT_WEAPON_ID = 'Fist';
/** The default (vault) outfit - equipping this is how an outfit slot is "cleared". */
export const DEFAULT_OUTFIT_ID = 'jumpsuit';

// New slots get the flags the game writes; an existing slot's flags + unknown keys
// are preserved (spread after the defaults, before the id/type override).
const SLOT_FLAGS = { hasBeenAssigned: false, hasRandonWeaponBeenAssigned: false } as const;

/** Equip a weapon by id (preserves the slot's other keys). */
export const equipWeapon = (save: SaveData, serializeId: number, weaponId: string): SaveData =>
  updateDweller(save, serializeId, (d) => ({
    ...d,
    equipedWeapon: { ...SLOT_FLAGS, ...d.equipedWeapon, id: weaponId, type: 'Weapon' },
  }));

/** Equip an outfit by id (preserves the slot's other keys). */
export const equipOutfit = (save: SaveData, serializeId: number, outfitId: string): SaveData =>
  updateDweller(save, serializeId, (d) => ({
    ...d,
    equipedOutfit: { ...SLOT_FLAGS, ...d.equipedOutfit, id: outfitId, type: 'Outfit' },
  }));

/** Reset the weapon slot to the bare-fists default (the game has no empty slot). */
export const unequipWeapon = (save: SaveData, serializeId: number): SaveData =>
  equipWeapon(save, serializeId, DEFAULT_WEAPON_ID);

/** Reset the outfit slot to the vault-suit default (the game has no empty slot). */
export const unequipOutfit = (save: SaveData, serializeId: number): SaveData =>
  equipOutfit(save, serializeId, DEFAULT_OUTFIT_ID);

// --- Equipment: pets (instances) ------------------------------------------------

/** Find a dweller or throw - for ops that read the dweller before composing edits. */
function getDweller(save: SaveData, serializeId: number): Dweller {
  const dweller = dwellerList(save).find((d) => d.serializeId === serializeId);
  if (!dweller) throw new DwellerNotFoundError(serializeId);
  return dweller;
}

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

/** Fields for a newly-created pet instance (UI supplies the locked bonus + clamped value). */
export interface NewPet {
  /** A real pet id (`<breed>_<c|r|l>`), validated against game data by the caller. */
  petId: string;
  uniqueName: string;
  /** EBonusEffect name, locked to the pet id by the caller. */
  bonus: string;
  bonusValue: number;
}

/**
 * Build a pet-instance slot (the `equippedPet` shape, also valid as a stored
 * `vault.inventory.items` entry) for a freshly-created pet. Shared with storageOps,
 * which grants pets directly into storage.
 */
export function newPetSlot(pet: NewPet): Item {
  return {
    ...SLOT_FLAGS,
    id: pet.petId,
    type: 'Pet',
    extraData: { uniqueName: pet.uniqueName, bonus: pet.bonus, bonusValue: pet.bonusValue },
  };
}

/**
 * Attach a stored pet instance (by its `vault.inventory.items` index) to a dweller.
 * Any pet the dweller already wears is returned to storage (a swap, not a duplicate).
 */
export function attachPetFromStorage(
  save: SaveData,
  serializeId: number,
  itemIndex: number,
): SaveData {
  const dweller = getDweller(save, serializeId);
  const items = inventoryItems(save);
  const item = items[itemIndex];
  if (!item) throw new RangeError(`No inventory item at index ${itemIndex}.`);
  if (item.type !== 'Pet')
    throw new TypeError(`Inventory item at index ${itemIndex} is not a Pet.`);

  const nextItems = items.filter((_, i) => i !== itemIndex);
  if (dweller.equippedPet) nextItems.push(dweller.equippedPet);

  const next = updateDweller(save, serializeId, (d) => ({ ...d, equippedPet: item }));
  return withInventoryItems(next, nextItems);
}

/**
 * Create a new pet instance and equip it. Any pet the dweller already wears is returned
 * to storage. The bonus is locked and the value pre-clamped by the caller.
 */
export function createPet(save: SaveData, serializeId: number, pet: NewPet): SaveData {
  const dweller = getDweller(save, serializeId);
  const next = updateDweller(save, serializeId, (d) => ({ ...d, equippedPet: newPetSlot(pet) }));
  if (dweller.equippedPet) {
    return withInventoryItems(next, [...inventoryItems(next), dweller.equippedPet]);
  }
  return next;
}

/**
 * Edit the equipped pet's unique name and/or rolled bonus value. The bonus EFFECT stays
 * locked (it is never changed here). No-op if the dweller has no pet equipped.
 */
export function editEquippedPet(
  save: SaveData,
  serializeId: number,
  changes: { uniqueName?: string; bonusValue?: number },
): SaveData {
  const dweller = getDweller(save, serializeId);
  if (!dweller.equippedPet) return save;
  return updateDweller(save, serializeId, (d) => {
    const pet = d.equippedPet;
    if (!pet) return d;
    const extraData = { ...pet.extraData };
    if (changes.uniqueName !== undefined) extraData.uniqueName = changes.uniqueName;
    if (changes.bonusValue !== undefined) extraData.bonusValue = changes.bonusValue;
    return { ...d, equippedPet: { ...pet, extraData } };
  });
}

/** Detach the equipped pet back to storage, deleting the optional `equippedPet` key. */
export function detachPet(save: SaveData, serializeId: number): SaveData {
  const dweller = getDweller(save, serializeId);
  const pet = dweller.equippedPet;
  if (!pet) return save;
  const next = updateDweller(save, serializeId, (d) => {
    const copy = { ...d };
    delete copy.equippedPet;
    return copy;
  });
  return withInventoryItems(next, [...inventoryItems(next), pet]);
}

/**
 * Delete the equipped pet instance outright, removing the optional `equippedPet` key
 * WITHOUT returning it to storage (unlike `detachPet`). Used by the Pets section to
 * destroy an instance wherever it lives. No-op if the dweller has no pet equipped.
 */
export function deleteEquippedPet(save: SaveData, serializeId: number): SaveData {
  const dweller = getDweller(save, serializeId);
  if (!dweller.equippedPet) return save;
  return updateDweller(save, serializeId, (d) => {
    const copy = { ...d };
    delete copy.equippedPet;
    return copy;
  });
}

// --- Add at door ------------------------------------------------------

/** Options for a freshly-created dweller; everything unset falls back to the base. */
export interface NewDwellerOpts {
  name?: string;
  lastName?: string;
  gender?: Gender;
}

// One SPECIAL entry at the floor value; index 0 is the placeholder, 1..7 = S P E C I A L.
const baseStatEntry = (): { value: number; mod: number; exp: number } => ({
  value: 1,
  mod: 0,
  exp: 0,
});

/**
 * The full base shape of a brand-new "at the door" dweller, modeled on a real
 * level-1 dweller from `Vault1.sav`: `savedRoom:-1`,
 * `assigned:false`, level 1 / XP 0, all SPECIAL at 1, Fist + jumpsuit, no relations.
 * Cosmetic values reuse confirmed-valid ids/colors; everything is editable afterward.
 */
function baseDweller(serializeId: number, opts: NewDwellerOpts): Dweller {
  return {
    serializeId,
    name: opts.name ?? '',
    lastName: opts.lastName ?? '',
    happiness: { happinessValue: 50 },
    health: {
      healthValue: 105,
      maxHealth: 105,
      radiationValue: 0,
      permaDeath: false,
      lastLevelUpdated: 1,
    },
    deathSource: 0,
    experience: {
      experienceValue: 0,
      currentLevel: 1,
      storage: 0,
      accum: 0,
      needLvUp: false,
      wastelandExperience: 0,
    },
    relations: {
      relations: [],
      partner: -1,
      lastPartner: -1,
      ascendants: [-1, -1, -1, -1, -1, -1],
    },
    gender: opts.gender ?? 2,
    stats: { stats: Array.from({ length: 8 }, baseStatEntry) },
    pregnant: false,
    babyReady: false,
    assigned: false,
    sawIncident: false,
    WillGoToWasteland: false,
    WillBeEvicted: false,
    IsEvictedWaitingForFollowers: false,
    skinColor: 4293511599,
    hairColor: 4294967295,
    outfitColor: 4294967295,
    pendingExperienceReward: 0,
    hair: '08',
    equipedOutfit: { id: DEFAULT_OUTFIT_ID, type: 'Outfit', ...SLOT_FLAGS },
    equipedWeapon: { id: DEFAULT_WEAPON_ID, type: 'Weapon', ...SLOT_FLAGS },
    savedRoom: -1,
    wasTemporarilyAssigned: false,
    lastChildBorn: -1,
    rarity: 'Normal',
    deathTime: -1,
  };
}

/**
 * Add a new dweller standing at the vault door. The id is the running counter's next
 * value - `max(dwellers.id, highest serializeId) + 1` - and `dwellers.id` is bumped to
 * match, so ids never collide even after deletes leave gaps (verified against the real
 * save where `dwellers.id` tracks the last-assigned serializeId). Pure/immutable: the
 * surviving dwellers and every other top-level key pass through by reference.
 */
export function createDwellerAtDoor(save: SaveData, opts: NewDwellerOpts = {}): SaveData {
  const block = save.dwellers ?? { dwellers: [] };
  const list = Array.isArray(block.dwellers) ? block.dwellers : [];
  const maxSerializeId = list.reduce((m, d) => Math.max(m, d.serializeId ?? 0), 0);
  const counter = typeof block.id === 'number' ? block.id : 0;
  const nextId = Math.max(maxSerializeId, counter) + 1;
  const dweller = baseDweller(nextId, opts);
  return { ...save, dwellers: { ...block, dwellers: [...list, dweller], id: nextId } };
}

/**
 * Put an existing dweller in the vault-door waiting line: append the game's reference
 * shape (`{ newDweller: true, charType: "Dweller", dwellerId }`) to
 * `dwellerSpawner.dwellersWaiting`. The dweller entry itself stays in `dwellers.dwellers`
 * with `savedRoom: -1`, exactly like a real radio arrival (verified against a real save).
 * No-op if already queued. Callers enforce the game's 10-place queue cap.
 */
export function markDwellerWaiting(save: SaveData, dwellerId: number): SaveData {
  const spawner = save.dwellerSpawner ?? {};
  const waiting = Array.isArray(spawner.dwellersWaiting) ? spawner.dwellersWaiting : [];
  if (waiting.some((w) => w?.dwellerId === dwellerId)) return save;
  return {
    ...save,
    dwellerSpawner: {
      ...spawner,
      dwellersWaiting: [...waiting, { newDweller: true, charType: 'Dweller', dwellerId }],
    },
  };
}

/**
 * Add a special/legendary NAMED dweller. Unlike a generic at-door
 * dweller, a special dweller carries a `uniqueData` string (e.g. "L_Max") and the
 * customization baked into its UniqueDwellerData catalog entry - it is a regular entry
 * in `save.dwellers.dwellers[]`, NOT an `actors[]` entry. This replicates the game's
 * Dweller.SetUniqueCustomization (Assembly-CSharp): apply hair / faceMask / skin+hair
 * colors / outfit id / weapon id / SPECIAL / gender, then stamp `uniqueData`.
 *
 * `random-body` catalog characters (the game randomizes their appearance at spawn) keep
 * the neutral base appearance; their outfit/weapon/SPECIAL/name still come from the entry.
 * Rarity is left at the editable base default (the catalog stores card-lottery odds, not a
 * rarity word). The op trusts the entry's outfit/weapon ids - the id-existence guard
 * lives at the UI call site (the picker only surfaces real catalog characters). Id
 * allocation matches `createDwellerAtDoor` (running counter + `dwellers.id` bump), so ids
 * never collide. Pure/immutable: existing dwellers and other top-level keys pass through.
 */
export function addSpecialDweller(
  save: SaveData,
  uniqueId: string,
  entry: UniqueDweller,
): SaveData {
  const block = save.dwellers ?? { dwellers: [] };
  const list = Array.isArray(block.dwellers) ? block.dwellers : [];
  const maxSerializeId = list.reduce((m, d) => Math.max(m, d.serializeId ?? 0), 0);
  const counter = typeof block.id === 'number' ? block.id : 0;
  const nextId = Math.max(maxSerializeId, counter) + 1;

  const base = baseDweller(nextId, {
    name: entry.name,
    lastName: entry.lastName,
    gender: entry.gender as Gender,
  });

  const stats = (base.stats?.stats ?? []).map((s, i) =>
    i >= 1 && i <= 7 ? { ...s, value: clamp(entry.stats[i - 1] ?? 1, 1, 10) } : s,
  );

  // Random-body characters get neutral base appearance; others take the catalog look.
  // faceMask/hair keys are only written when present (the save omits faceMask for none).
  const appearance = entry.randomBody
    ? {}
    : {
        skinColor: toUint32(entry.skinColor),
        hairColor: toUint32(entry.hairColor),
        ...(entry.hair !== null ? { hair: entry.hair } : {}),
        ...(entry.faceMask !== null ? { faceMask: entry.faceMask } : {}),
      };

  const dweller: Dweller = {
    ...base,
    uniqueData: uniqueId,
    stats: { ...base.stats, stats },
    equipedOutfit: { id: entry.outfitId, type: 'Outfit', ...SLOT_FLAGS },
    equipedWeapon: { id: entry.weaponId || DEFAULT_WEAPON_ID, type: 'Weapon', ...SLOT_FLAGS },
    ...appearance,
  };

  return { ...save, dwellers: { ...block, dwellers: [...list, dweller], id: nextId } };
}

// --- Remove ---------------------------------------------------------------------

/** Delete a dweller, sharing every surviving dweller and top-level key by reference. */
export function remove(save: SaveData, serializeId: number): SaveData {
  const block = save.dwellers;
  const list = block?.dwellers;
  const idx = list ? list.findIndex((d) => d.serializeId === serializeId) : -1;
  if (!list || idx === -1) throw new DwellerNotFoundError(serializeId);

  const nextList = list.slice();
  nextList.splice(idx, 1);
  return { ...save, dwellers: { ...block, dwellers: nextList } };
}

/** True if a dweller with this `serializeId` exists (handy for UI guards). */
export const hasDweller = (save: SaveData, serializeId: number): boolean =>
  indexOf(save, serializeId) !== -1;

/** The game's own empty-training-slot sentinel (TrainingSlot.Serialize writes -2/-2). */
const EMPTY_TRAINING_SLOT = -2;

/**
 * Delete multiple dwellers AND scrub every save reference to them, mirroring the state
 * the game itself re-serializes after DwellerManager.RemoveDweller:
 *
 * - room `dwellers` / `deadDwellers` rosters: ids dropped (a ghost roster id is tolerated
 *   on load but flagged by our own health check, so it must not be left behind);
 * - training `slots[]`: reset to the game's empty sentinels (-2/-2). Left dangling, a
 *   slot with `needLvUp` NPEs in TrainingSlot.Deserialize (ShowDwellerIcon on null);
 * - `partners[]`: entries whose FEMALE (`f`, the validity anchor - IsValid() is
 *   `m_female != null`) is removed are dropped; male-only removals keep the entry,
 *   exactly like the game (names survive for the family tree). On surviving entries a
 *   removed `fatherId` resets to -1 (what DwellerPartnership.OnDwellerRemoved does) and
 *   a removed `templateID` (first-born of a multi-birth, copied by its siblings) resets
 *   to -1 - CreateChild dereferences that id WITHOUT a null check, so leaving it
 *   dangling would crash the game when the next sibling is born;
 * - `children[]`: entries for a removed child dweller are dropped;
 * - wasteland `teams[]`: removed members leave the team; a team with nobody left is
 *   dropped whole (teams are a dynamic list of active trips);
 * - `dwellerSpawner.dwellersWaiting`: door-queue refs (`dwellerId`) to removed dwellers
 *   are dropped so the game never resolves a deleted dweller at the door;
 * - `taskMgr`: tasks owned solely by dropped entries (birth `t`, grow-up `taskID`,
 *   training `taskID`) are deleted - TaskMgr re-serializes every queued task, so an
 *   unclaimed orphan would linger in the save forever.
 *
 * Other dwellers' relation ids (ascendants/partner history) are deliberately kept: the
 * game null-checks and preserves them (dead ancestors are routinely absent from saves).
 * Unknown ids are skipped; removing nothing returns the SAME reference (store no-op).
 */
export function removeDwellers(save: SaveData, serializeIds: readonly number[]): SaveData {
  const block = save.dwellers;
  const list = block?.dwellers;
  if (!list || serializeIds.length === 0) return save;
  const requested = new Set(serializeIds);
  const removing = new Set<number>();
  for (const d of list) {
    if (typeof d.serializeId === 'number' && requested.has(d.serializeId)) {
      removing.add(d.serializeId);
    }
  }
  if (removing.size === 0) return save;
  const hits = (id: number | undefined): boolean => typeof id === 'number' && removing.has(id);

  let next: SaveData = {
    ...save,
    dwellers: { ...block, dwellers: list.filter((d) => !hits(d.serializeId)) },
  };

  // Task ids that only the dropped entries referenced; scrubbed from taskMgr below.
  const orphanTasks = new Set<number>();
  const claimTask = (id: number | undefined): void => {
    if (typeof id === 'number' && id > 0) orphanTasks.add(id);
  };

  const rooms = save.vault?.rooms;
  if (rooms) {
    let roomsChanged = false;
    const nextRooms = rooms.map((room) => {
      let r = room;
      if (r.dwellers?.some(hits)) {
        r = { ...r, dwellers: r.dwellers.filter((id) => !hits(id)) };
      }
      if (r.deadDwellers?.some(hits)) {
        r = { ...r, deadDwellers: r.deadDwellers.filter((id) => !hits(id)) };
      }
      if (r.slots?.some((s) => hits(s.dwellerID))) {
        r = {
          ...r,
          slots: r.slots.map((s) => {
            if (!hits(s.dwellerID)) return s;
            claimTask(s.taskID);
            return { ...s, dwellerID: EMPTY_TRAINING_SLOT, taskID: EMPTY_TRAINING_SLOT };
          }),
        };
      }
      if (r.partners?.some((p) => hits(p.f) || hits(p.fatherId) || hits(p.templateID))) {
        for (const p of r.partners) if (hits(p.f)) claimTask(p.t);
        r = {
          ...r,
          partners: r.partners
            .filter((p) => !hits(p.f))
            .map((p) => {
              if (!hits(p.fatherId) && !hits(p.templateID)) return p;
              const patched = { ...p };
              // Mirror DwellerPartnership.OnDwellerRemoved: a removed father becomes -1
              // (name strings carry the family tree).
              if (hits(patched.fatherId)) patched.fatherId = -1;
              // A dangling child template CRASHES CreateChild at the next multi-birth
              // (unchecked GetDwellerById(templateID).m_gender); -1 rolls a random child.
              if (hits(patched.templateID)) patched.templateID = -1;
              return patched;
            }),
        };
      }
      if (r.children?.some((c) => hits(c.dwellerID))) {
        for (const c of r.children) if (hits(c.dwellerID)) claimTask(c.taskID);
        r = { ...r, children: r.children.filter((c) => !hits(c.dwellerID)) };
      }
      if (r !== room) roomsChanged = true;
      return r;
    });
    if (roomsChanged) {
      next = { ...next, vault: { ...next.vault, rooms: nextRooms } };
    }
  }

  const wasteland = save.vault?.wasteland;
  if (wasteland?.teams?.some((t) => t.dwellers?.some(hits))) {
    const nextTeams = wasteland.teams
      .map((t) =>
        t.dwellers?.some(hits) ? { ...t, dwellers: t.dwellers.filter((id) => !hits(id)) } : t,
      )
      .filter((t) => t.dwellers === undefined || t.dwellers.length > 0);
    next = { ...next, vault: { ...next.vault, wasteland: { ...wasteland, teams: nextTeams } } };
  }

  // Door-queue refs (dwellersWaiting) point at dwellers by `dwellerId`; a dangling ref
  // would make the game resolve a deleted dweller on load. Robot entries key by
  // `serializeId` instead and are untouched here.
  const spawner = save.dwellerSpawner;
  if (spawner?.dwellersWaiting?.some((w) => hits(w?.dwellerId))) {
    next = {
      ...next,
      dwellerSpawner: {
        ...spawner,
        dwellersWaiting: spawner.dwellersWaiting.filter((w) => !hits(w?.dwellerId)),
      },
    };
  }

  const mgr = save.taskMgr;
  if (orphanTasks.size > 0 && mgr) {
    const dropTasks = <T extends { id?: number | undefined }>(
      tasks: T[] | undefined,
    ): T[] | undefined =>
      tasks?.some((t) => typeof t.id === 'number' && orphanTasks.has(t.id))
        ? tasks.filter((t) => !(typeof t.id === 'number' && orphanTasks.has(t.id)))
        : tasks;
    const tasks = dropTasks(mgr.tasks);
    const pausedTasks = dropTasks(mgr.pausedTasks);
    if (tasks !== mgr.tasks || pausedTasks !== mgr.pausedTasks) {
      next = {
        ...next,
        taskMgr: {
          ...mgr,
          ...(tasks !== undefined ? { tasks } : {}),
          ...(pausedTasks !== undefined ? { pausedTasks } : {}),
        },
      };
    }
  }

  return next;
}
