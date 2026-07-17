import type { GameData } from '../gamedata/gameData.ts';
import type {
  Handy,
  Quest,
  QuestLoot,
  QuestRoom,
  Rarity,
  UniqueDweller,
} from '../gamedata/schemas.ts';
import type { SaveData } from '../model/saveSchema.ts';
import { addSpecialDweller, type NewPet } from '../ops/dwellerOps.ts';
import { createMrHandy } from '../ops/mrHandyOps.ts';
import { grantItems, addPet, type StackableType } from '../ops/storageOps.ts';
import { addRecipes, addRecipeParts, BUILT_PARTS } from '../ops/recipeOps.ts';
import { themeRecipeInfo } from '../rooms/themes.ts';
import { setResource, resources, consumableCounts, setConsumableCount } from '../ops/vaultOps.ts';

// Quest-loot engine (Section 5 of the Quest-tab design). The editor marks quests complete
// WITHOUT playing them, so it must reconstruct and grant the loot itself.
//
// Two stages, both pure:
//   1. planQuestLoot(quest, gameData [, rng]) -> GrantLine[]  (a resolved reward manifest).
//      Without an rng the Random* loot types stay as `random` descriptors (the deterministic
//      preview the UI shows before completing). With an rng they are ROLLED to concrete items.
//   2. grantResolvedLoot(save, lines) -> SaveData  (applies the manifest, reusing the existing
//      game-data-free ops setResource / consumables / grantItems / addPet / addRecipes).
//
// Keeping the rolled `GrantLine[]` between the two stages means undo just reverts the save
// snapshot: the roll is captured, never re-rolled, so a single applyEdit is fully reversible.

/** EQuestLootType (catalog `m_lootType`) - from scripts/extract/enums.json (Section 4). */
export const EQuestLootType = {
  None: 0,
  Weapon: 1,
  Outfit: 2,
  Stimpak: 3,
  Radaway: 4,
  Nuka: 5, // caps (Nuka === caps in the resources map)
  Quantum: 6,
  Pet: 7,
  Dweller: 8,
  Recipe: 9,
  RecipeParts: 10,
  Junk: 11,
  Lunchbox: 12,
  PetCarrier: 13,
  MrHandyBox: 14,
  QuestClue: 15,
  Specific: 16,
  MrHandy: 17,
  PokerChip: 18,
  RandomLoots: 100,
  RandomCommonWeapon: 101,
  RandomRareWeapon: 102,
  RandomLegendaryWeapon: 103,
  RandomCommonOutfit: 104,
  RandomRareOutfit: 105,
  RandomLegendaryOutfit: 106,
  RandomCommonPet: 107,
  RandomRarePet: 108,
  RandomLegendaryPet: 109,
  RandomRareDweller: 110,
  RandomCommonJunk: 111,
  RandomRareJunk: 112,
  RandomLegendaryJunk: 113,
  RandomRareWeaponRecipe: 114,
  RandomRareOutfitRecipe: 115,
  RandomLegendaryWeaponRecipe: 116,
  RandomLegendaryOutfitRecipe: 117,
  RandomRecipePart: 118,
  RandomClue: 119,
} as const;

/** Resource-map keys for the currency/consumable loot types granted via setResource. */
const RESOURCE_KEY: Record<number, string> = {
  [EQuestLootType.Nuka]: 'Nuka', // caps
  [EQuestLootType.Quantum]: 'NukaColaQuantum',
  [EQuestLootType.Stimpak]: 'StimPack',
  [EQuestLootType.Radaway]: 'RadAway',
  [EQuestLootType.PokerChip]: 'PokerChip',
};

/**
 * Openable-consumable loot types -> vault.LunchBoxesByType code (CONSUMABLE_CODES). These are
 * NOT in the resources map: they are box counts rebuilt by setConsumableCount, the same path the
 * Vault tab's consumable editor uses.
 */
const CONSUMABLE_CODE: Record<number, number> = {
  [EQuestLootType.Lunchbox]: 0, // CONSUMABLE_CODES.Lunchbox
  [EQuestLootType.MrHandyBox]: 1, // CONSUMABLE_CODES.MrHandy
  [EQuestLootType.PetCarrier]: 2, // CONSUMABLE_CODES.PetCarrier
};

/** lootType -> the stackable storage type it grants (Weapon/Outfit/Junk). */
const ITEM_TYPE: Record<number, StackableType> = {
  [EQuestLootType.Weapon]: 'Weapon',
  [EQuestLootType.Outfit]: 'Outfit',
  [EQuestLootType.Junk]: 'Junk',
};

/**
 * Random* loot types -> which app catalog to roll from and which rarities qualify. The game's
 * "Common" tier maps to the catalog's "Normal" rarity (weapons/pets/junk have no "Common" rarity),
 * so Common accepts both. Rare/Legendary map straight through.
 */
type RandomSpec = { catalog: 'weapon' | 'outfit' | 'junk' | 'pet'; rarities: readonly Rarity[] };
const RANDOM_SPEC: Record<number, RandomSpec> = {
  [EQuestLootType.RandomCommonWeapon]: { catalog: 'weapon', rarities: ['Common', 'Normal'] },
  [EQuestLootType.RandomRareWeapon]: { catalog: 'weapon', rarities: ['Rare'] },
  [EQuestLootType.RandomLegendaryWeapon]: { catalog: 'weapon', rarities: ['Legendary'] },
  [EQuestLootType.RandomCommonOutfit]: { catalog: 'outfit', rarities: ['Common', 'Normal'] },
  [EQuestLootType.RandomRareOutfit]: { catalog: 'outfit', rarities: ['Rare'] },
  [EQuestLootType.RandomLegendaryOutfit]: { catalog: 'outfit', rarities: ['Legendary'] },
  [EQuestLootType.RandomCommonPet]: { catalog: 'pet', rarities: ['Common', 'Normal'] },
  [EQuestLootType.RandomRarePet]: { catalog: 'pet', rarities: ['Rare'] },
  [EQuestLootType.RandomLegendaryPet]: { catalog: 'pet', rarities: ['Legendary'] },
  [EQuestLootType.RandomCommonJunk]: { catalog: 'junk', rarities: ['Common', 'Normal'] },
  [EQuestLootType.RandomRareJunk]: { catalog: 'junk', rarities: ['Rare'] },
  [EQuestLootType.RandomLegendaryJunk]: { catalog: 'junk', rarities: ['Legendary'] },
};

/**
 * Human labels for every loot type that can reach the UI as a descriptor rather than a resolved
 * item. The fallback below is `Loot type ${t}`, so a gap here surfaces a raw enum number to the
 * player - which is what the whole map exists to prevent.
 *
 * THE RANDOM* TYPES WITH A RANDOM_SPEC NEED A LABEL TOO, even though the grant path rolls them
 * into concrete items and never reads this. The PREVIEW path (planQuestLoot with no rng) sends
 * every type >= 100 through randomOrUnsupported, so the detail panel showed "Loot type 112" for
 * the 703 Rare Junk slots in the catalog, and "Loot type 101"/"Loot type 106" for the rest.
 *
 * No "Random" prefix: the chip already carries a "?" mystery badge that says so, and the tiered
 * names read better beside it ("? Rare Junk ×3").
 */
const LOOT_TYPE_LABEL: Record<number, string> = {
  // Concrete types, reached only when a stack arrives with no m_lootID to resolve.
  [EQuestLootType.Weapon]: 'Weapon',
  [EQuestLootType.Outfit]: 'Outfit',
  [EQuestLootType.Pet]: 'Pet',
  [EQuestLootType.Recipe]: 'Recipe',
  [EQuestLootType.Junk]: 'Junk',
  [EQuestLootType.Specific]: 'Specific Item',
  [EQuestLootType.Dweller]: 'Special Dweller',
  [EQuestLootType.MrHandy]: 'Mr. Handy',
  [EQuestLootType.QuestClue]: 'Quest Clue',
  [EQuestLootType.RecipeParts]: 'Recipe Parts',
  // Random* family: the preview's descriptors.
  [EQuestLootType.RandomLoots]: 'Random Loot',
  [EQuestLootType.RandomCommonWeapon]: 'Common Weapon',
  [EQuestLootType.RandomRareWeapon]: 'Rare Weapon',
  [EQuestLootType.RandomLegendaryWeapon]: 'Legendary Weapon',
  [EQuestLootType.RandomCommonOutfit]: 'Common Outfit',
  [EQuestLootType.RandomRareOutfit]: 'Rare Outfit',
  [EQuestLootType.RandomLegendaryOutfit]: 'Legendary Outfit',
  [EQuestLootType.RandomCommonPet]: 'Common Pet',
  [EQuestLootType.RandomRarePet]: 'Rare Pet',
  [EQuestLootType.RandomLegendaryPet]: 'Legendary Pet',
  [EQuestLootType.RandomRareDweller]: 'Rare Dweller',
  [EQuestLootType.RandomCommonJunk]: 'Common Junk',
  [EQuestLootType.RandomRareJunk]: 'Rare Junk',
  [EQuestLootType.RandomLegendaryJunk]: 'Legendary Junk',
  [EQuestLootType.RandomRareWeaponRecipe]: 'Rare Weapon Recipe',
  [EQuestLootType.RandomRareOutfitRecipe]: 'Rare Outfit Recipe',
  [EQuestLootType.RandomLegendaryWeaponRecipe]: 'Legendary Weapon Recipe',
  [EQuestLootType.RandomLegendaryOutfitRecipe]: 'Legendary Outfit Recipe',
  [EQuestLootType.RandomRecipePart]: 'Random Recipe Part',
  [EQuestLootType.RandomClue]: 'Quest Clue',
};

// --- draw pools (loot the game rolls WITHOUT replacement) --------------------------
//
// Recipes and clues are not drawn from the catalog, they are drawn from what the vault does NOT
// already have, and a draw REMOVES the winner so one completion cannot award it twice.
//
// This mirrors the game exactly rather than inventing a rule. ItemParameters.GetRandomRecipe asks
// m_recipeLootManager for the still-possible loot and calls Remove(id) on the winner;
// QuestSetupReferences.CreateClueLoot draws from QuestDataManager.AvailableClue and Removes the
// winner. AvailableClue itself is rebuilt on load as "every EQuestType.QuestClue quest not in
// completedQuestDataManager.foundClues".
//
// An EXHAUSTED pool grants nothing, silently: both game paths set LootType = None when they come
// up empty. A vault that already knows every rare weapon recipe simply gets no recipe.

/** Rarity words the quest recipe rolls ask for (EItemRarity). */
type RecipeRarity = 'Rare' | 'Legendary';

/** Which catalog a random recipe roll draws from. */
type RecipeKind = 'Weapon' | 'Outfit';

/**
 * The mutable draw pools for one grant. Built per completion from the save, then MUTATED as lines
 * are rolled, so a closure that completes ten quests never awards the same recipe or clue twice.
 */
export interface LootPools {
  /** Recipe ids the vault does not know yet (`unlockables.recipes` minus `survivalW.recipes`). */
  recipes: Set<string>;
  /** Clue quest-names not yet found (every Clue-type quest minus `foundClues`). */
  clues: Set<string>;
  /** Theme ids that can still take recipe parts. */
  themes: Set<string>;
}

/** The `rarity`-bearing catalog rows a recipe id can resolve to. */
const recipeRarityOf = (id: string, g: GameData, kind: RecipeKind): string | undefined =>
  (kind === 'Weapon' ? g.weaponById.get(id) : g.outfitById.get(id))?.rarity;

/** Draw one recipe of `kind`/`rarity` from the pool, removing it. Null when none remain. */
function drawRecipe(
  pools: LootPools,
  g: GameData,
  kind: RecipeKind,
  rarity: RecipeRarity,
  rng: () => number,
): string | null {
  const candidates = [...pools.recipes].filter((id) => recipeRarityOf(id, g, kind) === rarity);
  const won = pick(candidates, rng);
  if (won === undefined) return null;
  pools.recipes.delete(won);
  return won;
}

/** Draw one un-found clue, removing it. Null when every clue is already found. */
function drawClue(pools: LootPools, rng: () => number): string | null {
  const won = pick([...pools.clues], rng);
  if (won === undefined) return null;
  pools.clues.delete(won);
  return won;
}

/** EQuestLootType -> the recipe draw it performs. */
const RECIPE_ROLL: Record<number, { kind: RecipeKind; rarity: RecipeRarity }> = {
  [EQuestLootType.RandomRareWeaponRecipe]: { kind: 'Weapon', rarity: 'Rare' },
  [EQuestLootType.RandomRareOutfitRecipe]: { kind: 'Outfit', rarity: 'Rare' },
  [EQuestLootType.RandomLegendaryWeaponRecipe]: { kind: 'Weapon', rarity: 'Legendary' },
  [EQuestLootType.RandomLegendaryOutfitRecipe]: { kind: 'Outfit', rarity: 'Legendary' },
};

/** A currency/consumable stack summed across all rooms (one entry per lootType, in first-seen order). */
export interface LootStack {
  lootType: number;
  lootID: string;
  quantity: number;
}

/**
 * A resolved reward line. `random`/`unsupported` grant nothing (they only describe the reward for
 * the preview); every other kind maps to exactly one existing op in grantResolvedLoot. `rolled`
 * marks an item/pet that was drawn from a Random* type so the UI can flag "you rolled this".
 */
export type GrantLine =
  | { kind: 'resource'; key: string; qty: number; label: string }
  | { kind: 'consumable'; code: number; qty: number; label: string }
  | {
      kind: 'item';
      itemType: StackableType;
      id: string;
      qty: number;
      label: string;
      rolled: boolean;
    }
  | { kind: 'pet'; pet: NewPet; label: string; rolled: boolean }
  | { kind: 'recipe'; ids: string[]; label: string; rolled: boolean }
  /** A found clue: the quest-name of an EQuestType.QuestClue quest, appended to foundClues. */
  | { kind: 'clue'; questName: string; label: string; rolled: boolean }
  /** A named character added to dwellers[] with its `uniqueData` id. */
  | { kind: 'dweller'; uniqueId: string; entry: UniqueDweller; label: string; rolled: boolean }
  /** A vault-helper robot (Mr. Handy / Snip Snip / ...) minted into actors[]. */
  | { kind: 'mrHandy'; handy: Handy; label: string }
  /** Theme recipe parts: `qty` parts toward crafting `themeId`. */
  | { kind: 'recipePart'; themeId: string; qty: number; label: string; rolled: boolean }
  | { kind: 'random'; lootType: number; qty: number; label: string }
  | { kind: 'unsupported'; lootType: number; qty: number; label: string };

// --- Stage 0: aggregate the raw catalog loot -------------------------------------

/** Every loot slot of one mandatory room, in a stable slot order. */
function roomLootSlots(room: QuestRoom): (QuestLoot | undefined)[] {
  const slots: (QuestLoot | undefined)[] = [];
  slots.push(room.m_combatLoot);
  for (const l of room.m_pickableLoot ?? []) slots.push(l);
  slots.push(room.m_roomCompletionLoot);
  for (const l of room.m_extraRoomCompletionLoot ?? []) slots.push(l);
  return slots;
}

/**
 * Sum every non-None loot slot across a quest's mandatory rooms into one stack per
 * (lootType, lootID), preserving first-seen order. None (lootType 0) padding and zero/absent
 * quantities are dropped. Deterministic - no RNG.
 */
export function aggregateQuestLoot(quest: Quest): LootStack[] {
  const order: string[] = [];
  const byKey = new Map<string, LootStack>();
  for (const room of quest.m_mandatoryRooms ?? []) {
    for (const slot of roomLootSlots(room)) {
      if (!slot || slot.m_lootType === EQuestLootType.None) continue;
      const qty = slot.m_lootQuantity ?? 0;
      if (qty <= 0) continue;
      const lootID = slot.m_lootID ?? '';
      const key = `${slot.m_lootType}|${lootID}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.quantity += qty;
      } else {
        byKey.set(key, { lootType: slot.m_lootType, lootID, quantity: qty });
        order.push(key);
      }
    }
  }
  return order.map((k) => byKey.get(k)!);
}

// --- Seeded RNG (mulberry32) -----------------------------------------------------

/** A deterministic 32-bit PRNG so random-loot rolls are reproducible + testable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rollInt = (min: number, max: number, rng: () => number) =>
  min + Math.floor(rng() * (max - min + 1));

const pick = <T>(arr: readonly T[], rng: () => number): T | undefined =>
  arr.length === 0 ? undefined : arr[Math.floor(rng() * arr.length)];

// --- Stage 1: plan (resolve one stack -> grant lines) ----------------------------

const catalogFor = (spec: RandomSpec, g: GameData) =>
  spec.catalog === 'weapon'
    ? g.weapons
    : spec.catalog === 'outfit'
      ? g.outfits
      : spec.catalog === 'junk'
        ? g.junk
        : g.pets;

/** Build a pet-grant NewPet from a catalog pet, rolling its bonus value in [bonusMin, bonusMax]. */
function petGrant(pet: GameData['pets'][number], rng: () => number, rolled: boolean): GrantLine {
  return {
    kind: 'pet',
    pet: {
      petId: pet.id,
      uniqueName: pet.name,
      bonus: pet.bonus,
      bonusValue: rollInt(pet.bonusMin, pet.bonusMax, rng),
    },
    label: pet.name,
    rolled,
  };
}

/** Resolve a Random* stack into concrete item/pet lines by drawing `quantity` times. */
function resolveRandom(stack: LootStack, g: GameData, rng: () => number): GrantLine[] {
  const spec = RANDOM_SPEC[stack.lootType];
  if (!spec) {
    // Random types with no app catalog to roll (recipes, dwellers, clues, generic loot): flag them.
    return [randomOrUnsupported(stack)];
  }
  const pool = catalogFor(spec, g).filter((e) => spec.rarities.includes(e.rarity));
  if (pool.length === 0) return [randomOrUnsupported(stack)];

  if (spec.catalog === 'pet') {
    // Pets are instanced: one distinct line per drawn pet.
    return Array.from({ length: stack.quantity }, () =>
      petGrant(
        pick(
          g.pets.filter((p) => spec.rarities.includes(p.rarity)),
          rng,
        )!,
        rng,
        true,
      ),
    );
  }
  // Weapons/outfits/junk are fungible: draw N, then merge identical ids into counted lines.
  const itemType =
    spec.catalog === 'weapon' ? 'Weapon' : spec.catalog === 'outfit' ? 'Outfit' : 'Junk';
  const counts = new Map<string, { name: string; qty: number }>();
  for (let i = 0; i < stack.quantity; i++) {
    const e = pick(pool, rng) as { id: string; name: string };
    const c = counts.get(e.id);
    if (c) c.qty += 1;
    else counts.set(e.id, { name: e.name, qty: 1 });
  }
  return [...counts.entries()].map(([id, { name, qty }]) => ({
    kind: 'item' as const,
    itemType: itemType as StackableType,
    id,
    qty,
    label: name,
    rolled: true,
  }));
}

/** A Random* stack that could not be rolled: keep it as a `random` descriptor for the preview. */
function randomOrUnsupported(stack: LootStack): GrantLine {
  const label = LOOT_TYPE_LABEL[stack.lootType] ?? `Loot type ${stack.lootType}`;
  return { kind: 'random', lootType: stack.lootType, qty: stack.quantity, label };
}

/** Look up a concrete item id across the weapon/outfit/junk/pet catalogs (for Specific/Pet loot). */
function resolveSpecific(id: string, qty: number, g: GameData, rng: () => number): GrantLine {
  const w = g.weaponById.get(id);
  if (w) return { kind: 'item', itemType: 'Weapon', id, qty, label: w.name, rolled: false };
  const o = g.outfitById.get(id);
  if (o) return { kind: 'item', itemType: 'Outfit', id, qty, label: o.name, rolled: false };
  const j = g.junkById.get(id);
  if (j) return { kind: 'item', itemType: 'Junk', id, qty, label: j.name, rolled: false };
  const p = g.petById.get(id);
  if (p) return petGrant(p, rng, false);
  return { kind: 'unsupported', lootType: EQuestLootType.Specific, qty, label: id };
}

/** A named character grant, or null when the id is not in the catalog. */
function dwellerGrant(
  uniqueId: string,
  g: GameData,
  rolled: boolean,
  qty: number,
): GrantLine[] | null {
  const entry = g.uniqueDwellers[uniqueId];
  if (!entry) return null;
  const label = `${entry.name} ${entry.lastName}`.trim() || uniqueId;
  // Characters are instanced, never stacked: N copies are N separate dwellers.
  return Array.from({ length: Math.max(1, qty) }, () => ({
    kind: 'dweller' as const,
    uniqueId,
    entry,
    label,
    rolled,
  }));
}

/**
 * Resolve one aggregated stack into zero-or-more grant lines.
 *
 * `pools` carries the draw state for the without-replacement types (recipes/clues). Without it
 * those stay preview descriptors, which is exactly what the panel wants: a preview must not
 * consume a pool, and it has no save to consult.
 */
function planStack(
  stack: LootStack,
  g: GameData,
  rng: (() => number) | null,
  pools: LootPools | null,
): GrantLine[] {
  const t = stack.lootType;
  const qty = stack.quantity;

  // --- rolled, without replacement: recipes + clues ------------------------------
  // Each mirrors the game: draw from what the vault lacks, remove the winner, and grant NOTHING
  // when the pool is empty (the game sets LootType = None).
  const recipeRoll = RECIPE_ROLL[t];
  if (recipeRoll && rng && pools) {
    const ids: string[] = [];
    for (let i = 0; i < qty; i++) {
      const won = drawRecipe(pools, g, recipeRoll.kind, recipeRoll.rarity, rng);
      if (won === null) break; // pool exhausted - silently award less (or nothing)
      ids.push(won);
    }
    if (ids.length === 0) return [];
    const name = (id: string): string =>
      (recipeRoll.kind === 'Weapon' ? g.weaponById.get(id) : g.outfitById.get(id))?.name ?? id;
    return [
      {
        kind: 'recipe',
        ids,
        label: ids.length === 1 ? `${name(ids[0])} Recipe` : `${ids.length} Recipes`,
        rolled: true,
      },
    ];
  }
  if ((t === EQuestLootType.QuestClue || t === EQuestLootType.RandomClue) && rng && pools) {
    const lines: GrantLine[] = [];
    for (let i = 0; i < qty; i++) {
      // A catalog QuestClue slot may name its clue; RandomClue never does.
      const named =
        t === EQuestLootType.QuestClue && stack.lootID && pools.clues.has(stack.lootID)
          ? stack.lootID
          : null;
      if (named) pools.clues.delete(named);
      const won = named ?? drawClue(pools, rng);
      if (won === null) break; // every clue already found - silently grant nothing
      lines.push({ kind: 'clue', questName: won, label: 'Quest Clue', rolled: named === null });
    }
    return lines;
  }
  if (t === EQuestLootType.RandomRecipePart && rng && pools) {
    const themeId = pick([...pools.themes], rng);
    if (themeId === undefined) return [];
    return [{ kind: 'recipePart', themeId, qty, label: `${themeId} Parts`, rolled: true }];
  }
  if (t === EQuestLootType.RecipeParts && stack.lootID) {
    return [
      {
        kind: 'recipePart',
        themeId: stack.lootID,
        qty,
        label: `${stack.lootID} Parts`,
        rolled: false,
      },
    ];
  }

  // --- named characters + robots -------------------------------------------------
  if (t === EQuestLootType.Dweller && stack.lootID) {
    const lines = dwellerGrant(stack.lootID, g, false, qty);
    if (lines) return lines;
  }
  if (t === EQuestLootType.RandomRareDweller && rng) {
    // GetRareDwellers: the curated rare pool, hidden characters excluded.
    const pool = Object.keys(g.uniqueDwellers).filter((id) => {
      const d = g.uniqueDwellers[id];
      return d.rarity === 'Rare' && !d.isHidden;
    });
    const won = pick(pool, rng);
    if (won !== undefined) {
      const lines = dwellerGrant(won, g, true, qty);
      if (lines) return lines;
    }
  }
  if (t === EQuestLootType.MrHandy) {
    // FindMrHandyData matches the asset name case-insensitively; the catalog is keyed by variant,
    // and the quest's "L_SnipSnip" carries the lunchbox-asset prefix the variant id lacks.
    const wanted = (stack.lootID || '').replace(/^L_/, '').toLowerCase();
    const handy =
      g.handies.find((h) => h.variantId.toLowerCase() === wanted) ??
      g.handies.find((h) => h.variantId === 'MrHandy');
    if (handy) {
      return Array.from({ length: Math.max(1, qty) }, () => ({
        kind: 'mrHandy' as const,
        handy,
        label: handy.name,
      }));
    }
  }

  if (RESOURCE_KEY[t]) {
    return [{ kind: 'resource', key: RESOURCE_KEY[t], qty, label: RESOURCE_KEY[t] }];
  }
  if (CONSUMABLE_CODE[t] !== undefined) {
    return [{ kind: 'consumable', code: CONSUMABLE_CODE[t], qty, label: `Consumable ${t}` }];
  }
  if (ITEM_TYPE[t] && stack.lootID) {
    const cat =
      ITEM_TYPE[t] === 'Weapon'
        ? g.weaponById.get(stack.lootID)
        : ITEM_TYPE[t] === 'Outfit'
          ? g.outfitById.get(stack.lootID)
          : g.junkById.get(stack.lootID);
    return [
      {
        kind: 'item',
        itemType: ITEM_TYPE[t],
        id: stack.lootID,
        qty,
        label: cat?.name ?? stack.lootID,
        rolled: false,
      },
    ];
  }
  if (t === EQuestLootType.Specific && stack.lootID) {
    return [resolveSpecific(stack.lootID, qty, g, () => (rng ? rng() : Math.random()))];
  }
  if (t === EQuestLootType.Pet && stack.lootID) {
    const p = g.petById.get(stack.lootID);
    if (p) return [petGrant(p, () => (rng ? rng() : Math.random()), false)];
  }
  if (t === EQuestLootType.Recipe && stack.lootID) {
    const named =
      g.weaponById.get(stack.lootID)?.name ?? g.outfitById.get(stack.lootID)?.name ?? stack.lootID;
    return [{ kind: 'recipe', ids: [stack.lootID], label: `${named} Recipe`, rolled: false }];
  }
  if (RANDOM_SPEC[t] || t >= 100) {
    // Random* family: roll when an rng is supplied (grant flow), else keep a preview descriptor.
    return rng ? resolveRandom(stack, g, rng) : [randomOrUnsupported(stack)];
  }
  // Dweller, MrHandy, RecipeParts, QuestClue, and any id-less item stack: cannot grant in v1.
  const label = LOOT_TYPE_LABEL[t] ?? (stack.lootID || `Loot type ${t}`);
  return [{ kind: 'unsupported', lootType: t, qty, label }];
}

/**
 * Build the full grant manifest for a quest. Pass an `rng` to ROLL the Random* loot into concrete
 * items (the grant flow); omit it for the deterministic preview (randoms stay as descriptors).
 *
 * `pools` unlocks the without-replacement draws (recipes/clues/theme parts) and is MUTATED by
 * them, so callers granting a whole closure must thread ONE pools object through every quest -
 * that is what stops two quests in the same completion awarding the same recipe.
 */
export function planQuestLoot(
  quest: Quest,
  gameData: GameData,
  rng?: () => number,
  pools?: LootPools,
): GrantLine[] {
  const stacks = aggregateQuestLoot(quest);
  return stacks.flatMap((s) => planStack(s, gameData, rng ?? null, pools ?? null));
}

/**
 * The draw pools for a save: what the vault does NOT already have.
 *
 * `clueQuests` is every EQuestType.QuestClue quest-name in the catalog, which is precisely how
 * QuestDataManager rebuilds AvailableClue on load. Theme parts draw from the theme recipes that
 * are not already fully built.
 */
export function buildLootPools(
  save: SaveData,
  gameData: GameData,
  clueQuests: readonly string[],
): LootPools {
  const knownRecipes = new Set(save.survivalW?.recipes ?? []);
  const foundClues = new Set(save.completedQuestDataManager?.foundClues ?? []);
  const builtThemes = new Set(
    (save.survivalW?.collectedThemes?.themeList ?? [])
      .filter((t) => (t.extraData?.partsCollectedCount ?? 0) >= BUILT_PARTS)
      .map((t) => t.id),
  );
  return {
    recipes: new Set(gameData.unlockables.recipes.filter((id) => !knownRecipes.has(id))),
    clues: new Set(clueQuests.filter((q) => !foundClues.has(q))),
    themes: new Set(
      gameData.unlockables.recipes.filter(
        (id) => themeRecipeInfo(id) !== null && !builtThemes.has(id),
      ),
    ),
  };
}

// --- Stage 2: apply the manifest to a save ---------------------------------------

/** Optional legal-max caps (resource key -> max) so resource grants never exceed the app's cap. */
export type ResourceCaps = Record<string, number>;

/** Additively grant one resource, clamped to `cap` when supplied (never lowers the current value). */
function grantResource(save: SaveData, key: string, qty: number, caps?: ResourceCaps): SaveData {
  const current = resources(save)[key] ?? 0;
  let target = current + qty;
  const cap = caps?.[key];
  if (cap !== undefined && target > cap) target = Math.max(current, cap);
  return setResource(save, key, target);
}

/**
 * Record a found clue (CompletedQuestDataManager.AddFoundClue): append the clue quest-name to
 * `foundClues`, deduped. This is the durable home for clues - a team's `equipment.questClues` is
 * only the satchel it carries them home in, and is flushed here on return.
 */
function addFoundClue(save: SaveData, questName: string): SaveData {
  const mgr = save.completedQuestDataManager ?? {};
  const found = mgr.foundClues ?? [];
  if (found.includes(questName)) return save;
  return { ...save, completedQuestDataManager: { ...mgr, foundClues: [...found, questName] } };
}

/** Additively grant an openable consumable by rebuilding LunchBoxesByType (Vault-tab path). */
function grantConsumable(save: SaveData, code: number, qty: number): SaveData {
  return setConsumableCount(save, code, (consumableCounts(save)[code] ?? 0) + qty);
}

/**
 * Apply a resolved manifest to a save, folding each line through the matching game-data-free op.
 * `random`/`unsupported` lines grant nothing. Returns a new save (structural sharing); intended to
 * be composed with the quest-completion ledger edit so ONE undo reverts the completion + its loot.
 */
export function grantResolvedLoot(
  save: SaveData,
  lines: readonly GrantLine[],
  caps?: ResourceCaps,
): SaveData {
  let next = save;
  for (const line of lines) {
    switch (line.kind) {
      case 'resource':
        next = grantResource(next, line.key, line.qty, caps);
        break;
      case 'consumable':
        next = grantConsumable(next, line.code, line.qty);
        break;
      case 'item':
        next = grantItems(next, line.itemType, line.id, line.qty);
        break;
      case 'pet':
        next = addPet(next, line.pet);
        break;
      case 'recipe':
        next = addRecipes(next, line.ids);
        break;
      case 'clue':
        next = addFoundClue(next, line.questName);
        break;
      case 'dweller':
        next = addSpecialDweller(next, line.uniqueId, line.entry);
        break;
      case 'mrHandy':
        next = createMrHandy(next, {
          variant: line.handy.variantId,
          characterType: line.handy.characterType,
          actorDataId: line.handy.actorDataId,
          name: line.handy.name,
        });
        break;
      case 'recipePart':
        next = addRecipeParts(next, line.themeId, line.qty);
        break;
      case 'random':
      case 'unsupported':
        break; // descriptive only - nothing to grant
    }
  }
  return next;
}
