// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData } from '../../src/domain/gamedata/gameData.ts';
import type { Quest } from '../../src/domain/gamedata/schemas.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import { resources, consumableCounts } from '../../src/domain/ops/vaultOps.ts';
import {
  aggregateQuestLoot,
  buildLootPools,
  planQuestLoot,
  grantResolvedLoot,
  mulberry32,
  EQuestLootType as T,
} from '../../src/domain/quests/questLoot.ts';

// --- fixtures --------------------------------------------------------------------

function weapon(id: string, rarity: string) {
  return { id, name: id, damageMin: 1, damageMax: 2, type: 1, tier: 1, rarity, sprite: 'x' };
}
function outfit(id: string, rarity: string) {
  return {
    id,
    name: id,
    category: 1,
    special: { S: 0, P: 0, E: 0, C: 0, I: 0, A: 0, L: 0 },
    hasHelmet: false,
    rarity,
    sprite: 'x',
  };
}
function junk(id: string, rarity: string) {
  return { id, name: id, rarity, value: 1, sprite: 'x' };
}
function pet(id: string, rarity: string, bonusMin: number, bonusMax: number) {
  return {
    id,
    name: id,
    baseName: id,
    breed: id,
    breedCode: 0,
    type: 'Dog',
    typeCode: 0,
    rarity,
    rarityCode: 2,
    bonus: 'TrainingBoost',
    bonusCode: 0,
    bonusMin,
    bonusMax,
    sprite: 'x',
    headSprite: 'x',
    poolName: 'p',
    codeId: 0,
    sellPrice: 0,
    petCarrierOdds: 0,
    descriptionLocalization: '',
    isHidden: false,
    craftOnly: false,
    lunchboxOnly: false,
    sortIndex: 0,
  };
}

function makeGameData(over: Record<string, unknown> = {}): GameData {
  return parseGameData({
    weapons: [
      weapon('RustyPistol', 'Normal'),
      weapon('LaserRifle', 'Rare'),
      weapon('MIRV', 'Legendary'),
    ],
    outfits: [outfit('Jumpsuit', 'Normal'), outfit('RaiderArmor_Sturdy', 'Rare')],
    junk: [junk('AlarmClock', 'Normal'), junk('GoldWatch', 'Rare')],
    pets: [pet('collar_c', 'Normal', 5, 5), pet('collar_r', 'Rare', 10, 20)],
    hair: [],
    enums: {},
    meta: { gameVersion: 't', unityVersion: 't', generatedAt: 't', counts: {} },
    unlockables: { recipes: [], roomUnlocks: [] },
    roomCapacity: {
      base: { resources: {}, items: 0, maxPetCount: 0, mrHandyHealth: 5000 },
      perDweller: {},
      rooms: {},
    },
    roomMetadata: { rooms: {} },
    roomProduction: {
      globals: {
        taskCycle: 0.1,
        noRushResourcesMultiplier: 1,
        foodConsumptionPerDweller: 0.06,
        waterConsumptionPerDweller: 0.06,
        dwellerConsumptionPeriod: 10,
        energyConsumptionPeriod: 8,
        happinessFactorList: [],
      },
      rooms: {},
    },
    uniqueDwellers: {},
    ...over,
  });
}

const loot = (m_lootType: number, m_lootQuantity: number, m_lootID = '') => ({
  m_lootType,
  m_lootID,
  m_lootQuantity,
  m_fromVaultQuantity: 0,
});

function makeQuest(rooms: Quest['m_mandatoryRooms']): Quest {
  return { m_questName: 'Q', m_questType: 0, title: 'Q', m_mandatoryRooms: rooms } as Quest;
}

// --- aggregation -----------------------------------------------------------------

describe('aggregateQuestLoot', () => {
  it('sums the same (type,id) across rooms/slots and drops None + zero padding', () => {
    const quest = makeQuest([
      { m_questRoomType: 1, m_pickableLoot: [loot(T.Nuka, 99), loot(T.None, 1)] },
      {
        m_questRoomType: 1,
        m_combatLoot: loot(T.Nuka, 1),
        m_roomCompletionLoot: loot(T.Stimpak, 0),
      },
      { m_questRoomType: 3, m_roomCompletionLoot: loot(T.Outfit, 1, 'RaiderArmor_Sturdy') },
    ]);
    const stacks = aggregateQuestLoot(quest);
    expect(stacks).toEqual([
      { lootType: T.Nuka, lootID: '', quantity: 100 }, // 99 + 1, None + zero-qty dropped
      { lootType: T.Outfit, lootID: 'RaiderArmor_Sturdy', quantity: 1 },
    ]);
  });

  it('returns an empty manifest for a quest with no rooms', () => {
    expect(aggregateQuestLoot(makeQuest(undefined))).toEqual([]);
  });
});

// --- preview (no rng) ------------------------------------------------------------

describe('planQuestLoot - deterministic preview', () => {
  it('maps currency/consumable/item loot and keeps Random* as descriptors', () => {
    const g = makeGameData();
    const quest = makeQuest([
      {
        m_questRoomType: 1,
        m_pickableLoot: [loot(T.Nuka, 2500), loot(T.Quantum, 2), loot(T.Lunchbox, 1)],
        m_roomCompletionLoot: loot(T.Outfit, 1, 'RaiderArmor_Sturdy'),
        m_extraRoomCompletionLoot: [loot(T.RandomRareWeapon, 1)],
      },
    ]);
    const lines = planQuestLoot(quest, g);
    expect(lines).toEqual([
      { kind: 'resource', key: 'Nuka', qty: 2500, label: 'Nuka' },
      { kind: 'resource', key: 'NukaColaQuantum', qty: 2, label: 'NukaColaQuantum' },
      { kind: 'consumable', code: 0, qty: 1, label: 'Consumable 12' },
      {
        kind: 'item',
        itemType: 'Outfit',
        id: 'RaiderArmor_Sturdy',
        qty: 1,
        label: 'RaiderArmor_Sturdy',
        rolled: false,
      },
      { kind: 'random', lootType: T.RandomRareWeapon, qty: 1, label: 'Rare Weapon' },
    ]);
  });

  // The preview routes EVERY type >= 100 through the descriptor path, including the ones the
  // grant path can roll, so a missing label here reaches the player as "Loot type 112" - which
  // is exactly what the detail panel used to show for the catalog's 703 Rare Junk slots.
  it('never labels a loot type with its raw enum number', () => {
    const g = makeGameData();
    const raw = /^Loot type \d+$/;
    for (const [name, type] of Object.entries(T)) {
      if (type === T.None) continue; // None is padding: aggregation drops it
      const quest = makeQuest([{ m_questRoomType: 1, m_combatLoot: loot(type, 1) }]);
      const [line] = planQuestLoot(quest, g);
      expect(line, `${name} (${type}) produced no grant line`).toBeDefined();
      expect(line.label, `${name} (${type}) fell back to a raw enum label`).not.toMatch(raw);
    }
  });

  it('labels the random tiers the preview cannot roll into concrete items', () => {
    const g = makeGameData();
    const labelOf = (type: number): string =>
      planQuestLoot(makeQuest([{ m_questRoomType: 1, m_combatLoot: loot(type, 1) }]), g)[0].label;
    expect(labelOf(T.RandomCommonWeapon)).toBe('Common Weapon');
    expect(labelOf(T.RandomLegendaryOutfit)).toBe('Legendary Outfit');
    expect(labelOf(T.RandomRareJunk)).toBe('Rare Junk');
  });

  it('flags loot types with no grant path as unsupported', () => {
    const quest = makeQuest([{ m_questRoomType: 1, m_combatLoot: loot(T.Dweller, 1) }]);
    const [line] = planQuestLoot(quest, makeGameData());
    expect(line).toEqual({
      kind: 'unsupported',
      lootType: T.Dweller,
      qty: 1,
      label: 'Special Dweller',
    });
  });
});

// --- without-replacement pools (recipes / clues) ----------------------------------
//
// These mirror the game: draw only from what the vault LACKS, remove the winner so it cannot
// repeat, and grant NOTHING once the pool is dry (the game sets LootType = None).

describe('planQuestLoot - recipe + clue draw pools', () => {
  // LaserRifle is the only RARE weapon recipe, MIRV the only LEGENDARY one.
  const withRecipes = (): GameData =>
    makeGameData({
      unlockables: {
        recipes: ['RustyPistol', 'LaserRifle', 'MIRV', 'RaiderArmor_Sturdy'],
        roomUnlocks: [],
      },
    });

  const pools = (g: GameData, save: SaveData, clues: string[] = []) =>
    buildLootPools(save, g, clues);

  const rng = () => mulberry32(7);
  const questWith = (type: number, qty = 1, id = '') =>
    makeQuest([{ m_questRoomType: 1, m_combatLoot: loot(type, qty, id) }]);

  it('rolls a rare weapon recipe only from recipes the vault does not know', () => {
    const g = withRecipes();
    const save = { survivalW: { recipes: [] } } as unknown as SaveData;
    const lines = planQuestLoot(questWith(T.RandomRareWeaponRecipe), g, rng(), pools(g, save));
    expect(lines).toEqual([
      { kind: 'recipe', ids: ['LaserRifle'], label: 'LaserRifle Recipe', rolled: true },
    ]);
  });

  // The user-facing rule: a vault that already knows everything silently gets nothing, rather
  // than a duplicate or a raw descriptor.
  it('grants nothing when every matching recipe is already known', () => {
    const g = withRecipes();
    const save = { survivalW: { recipes: ['LaserRifle'] } } as unknown as SaveData;
    expect(planQuestLoot(questWith(T.RandomRareWeaponRecipe), g, rng(), pools(g, save))).toEqual(
      [],
    );
  });

  it('never awards the same recipe twice within one grant', () => {
    const g = withRecipes();
    const save = { survivalW: { recipes: [] } } as unknown as SaveData;
    const p = pools(g, save);
    const r = rng();
    // Two quests, one shared pool: only ONE legendary weapon recipe exists.
    const first = planQuestLoot(questWith(T.RandomLegendaryWeaponRecipe), g, r, p);
    const second = planQuestLoot(questWith(T.RandomLegendaryWeaponRecipe), g, r, p);
    expect(first).toEqual([{ kind: 'recipe', ids: ['MIRV'], label: 'MIRV Recipe', rolled: true }]);
    expect(second).toEqual([]); // pool consumed by the first draw
  });

  it('draws a clue from the un-found clue quests and records it in foundClues', () => {
    const g = withRecipes();
    const save = { completedQuestDataManager: { foundClues: ['ClueA'] } } as unknown as SaveData;
    const p = pools(g, save, ['ClueA', 'ClueB']);
    const lines = planQuestLoot(questWith(T.RandomClue), g, rng(), p);
    expect(lines).toEqual([
      { kind: 'clue', questName: 'ClueB', label: 'Quest Clue', rolled: true },
    ]);
    const next = grantResolvedLoot(save, lines);
    expect(next.completedQuestDataManager!.foundClues).toEqual(['ClueA', 'ClueB']);
  });

  it('grants nothing when every clue is already found', () => {
    const g = withRecipes();
    const save = { completedQuestDataManager: { foundClues: ['ClueA'] } } as unknown as SaveData;
    expect(planQuestLoot(questWith(T.RandomClue), g, rng(), pools(g, save, ['ClueA']))).toEqual([]);
  });

  // Without pools (the panel's preview) the draws must not fire: a preview has no save to
  // consult and must never consume a pool.
  it('leaves recipe/clue rolls as descriptors when no pools are supplied', () => {
    const g = withRecipes();
    const [line] = planQuestLoot(questWith(T.RandomRareWeaponRecipe), g, rng());
    expect(line).toMatchObject({ kind: 'random', label: 'Rare Weapon Recipe' });
  });
});

describe('planQuestLoot - characters + robots', () => {
  const MAX = {
    ascendancyId: -48,
    name: 'Maximus',
    lastName: 'Rex',
    gender: 2,
    hair: '03',
    faceMask: null,
    outfitId: 'BOSCasual',
    weaponId: 'T60Pistol',
    skinColor: 4286339388,
    hairColor: 4280623644,
    stats: [7, 6, 6, 5, 4, 7, 5],
    rarity: 'Rare',
    isHidden: false,
    isInfertile: false,
    randomBody: false,
    randomName: false,
  };
  const HIDDEN = { ...MAX, name: 'Ghost', rarity: 'Rare', isHidden: true };
  const g = (): GameData =>
    makeGameData({
      uniqueDwellers: { L_Max: MAX, Q_Hidden: HIDDEN },
      handies: [
        {
          id: 'snipsnip',
          variantId: 'SnipSnip',
          characterType: 2,
          actorDataId: 'SnipSnip',
          sprite: 'x',
          source: 'q',
          name: 'Snip Snip',
          starterPack: false,
          mrHandyBoxOdds: 0,
          lotteryOdds: { normal: 0, rare: 0, legendary: 0 },
        },
      ],
    });

  it('grants a named quest dweller by its lootID', () => {
    const quest = makeQuest([{ m_questRoomType: 1, m_combatLoot: loot(T.Dweller, 1, 'L_Max') }]);
    const [line] = planQuestLoot(quest, g(), mulberry32(1));
    expect(line).toMatchObject({ kind: 'dweller', uniqueId: 'L_Max', label: 'Maximus Rex' });
  });

  // GetRareDwellers excludes IsHiddenDweller characters, so the quest-only ones can never drop.
  it('draws a random rare dweller from the non-hidden rare pool only', () => {
    const quest = makeQuest([{ m_questRoomType: 1, m_combatLoot: loot(T.RandomRareDweller, 1) }]);
    for (let seed = 1; seed < 12; seed++) {
      const [line] = planQuestLoot(quest, g(), mulberry32(seed));
      expect(line).toMatchObject({ kind: 'dweller', uniqueId: 'L_Max', rolled: true });
    }
  });

  it('maps the quest MrHandy lootID onto its catalog variant', () => {
    const quest = makeQuest([
      { m_questRoomType: 1, m_combatLoot: loot(T.MrHandy, 1, 'L_SnipSnip') },
    ]);
    const [line] = planQuestLoot(quest, g(), mulberry32(1));
    expect(line).toMatchObject({ kind: 'mrHandy', label: 'Snip Snip' });
    const next = grantResolvedLoot({ dwellers: { dwellers: [] } } as unknown as SaveData, [line]);
    expect(next.dwellers!.actors!.map((a) => a.actorDataId)).toEqual(['SnipSnip']);
  });
});

// --- rolling (with rng) ----------------------------------------------------------

describe('planQuestLoot - random rolls', () => {
  it('rolls a Random* type into a concrete item of the requested rarity', () => {
    const g = makeGameData();
    const quest = makeQuest([{ m_questRoomType: 1, m_combatLoot: loot(T.RandomRareWeapon, 1) }]);
    const lines = planQuestLoot(quest, g, mulberry32(1));
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.kind).toBe('item');
    if (line.kind === 'item') {
      expect(line.itemType).toBe('Weapon');
      expect(line.rolled).toBe(true);
      // The only Rare weapon in the fixture.
      expect(line.id).toBe('LaserRifle');
    }
  });

  it('rolls Random* pets as distinct instanced lines with a bonus value in range', () => {
    const g = makeGameData();
    const quest = makeQuest([{ m_questRoomType: 1, m_combatLoot: loot(T.RandomRarePet, 2) }]);
    const lines = planQuestLoot(quest, g, mulberry32(7));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.kind).toBe('pet');
      if (line.kind === 'pet') {
        expect(line.pet.petId).toBe('collar_r');
        expect(line.pet.bonusValue).toBeGreaterThanOrEqual(10);
        expect(line.pet.bonusValue).toBeLessThanOrEqual(20);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const g = makeGameData();
    const quest = makeQuest([{ m_questRoomType: 1, m_combatLoot: loot(T.RandomCommonWeapon, 3) }]);
    expect(planQuestLoot(quest, g, mulberry32(42))).toEqual(
      planQuestLoot(quest, g, mulberry32(42)),
    );
  });
});

// --- granting --------------------------------------------------------------------

function makeSave(): SaveData {
  return {
    vault: {
      storage: { resources: { Nuka: 1000, NukaColaQuantum: 5 }, items: [] },
      inventory: { items: [] },
      LunchBoxesByType: [],
    },
    survivalW: { recipes: [] },
  } as unknown as SaveData;
}

describe('grantResolvedLoot', () => {
  it('additively grants resources, consumables, items, pets and recipes in one save', () => {
    const g = makeGameData();
    const lines = [
      { kind: 'resource' as const, key: 'Nuka', qty: 2500, label: 'Nuka' },
      { kind: 'resource' as const, key: 'NukaColaQuantum', qty: 2, label: 'NukaColaQuantum' },
      { kind: 'consumable' as const, code: 0, qty: 3, label: 'lunchbox' },
      {
        kind: 'item' as const,
        itemType: 'Outfit' as const,
        id: 'RaiderArmor_Sturdy',
        qty: 2,
        label: 'x',
        rolled: false,
      },
      {
        kind: 'pet' as const,
        pet: { petId: 'collar_r', uniqueName: 'collar_r', bonus: 'TrainingBoost', bonusValue: 15 },
        label: 'collar_r',
        rolled: true,
      },
      { kind: 'recipe' as const, ids: ['SomeRecipe'], label: 'SomeRecipe', rolled: false },
    ];
    const next = grantResolvedLoot(makeSave(), lines);
    expect(resources(next).Nuka).toBe(3500); // 1000 + 2500 additive
    expect(resources(next).NukaColaQuantum).toBe(7);
    expect(consumableCounts(next)[0]).toBe(3);
    const items = next.vault!.inventory!.items!;
    expect(items.filter((i) => i.id === 'RaiderArmor_Sturdy')).toHaveLength(2);
    expect(items.filter((i) => i.type === 'Pet')).toHaveLength(1);
    expect(next.survivalW!.recipes).toContain('SomeRecipe');
    void g;
  });

  it('clamps a resource grant to a supplied cap without lowering the current value', () => {
    const lines = [{ kind: 'resource' as const, key: 'Nuka', qty: 2500, label: 'Nuka' }];
    const next = grantResolvedLoot(makeSave(), lines, { Nuka: 2000 });
    expect(resources(next).Nuka).toBe(2000); // 1000 + 2500 -> capped at 2000
  });

  it('keeps a value already above its cap untouched', () => {
    const lines = [{ kind: 'resource' as const, key: 'Nuka', qty: 100, label: 'Nuka' }];
    const next = grantResolvedLoot(makeSave(), lines, { Nuka: 500 }); // current 1000 > cap 500
    expect(resources(next).Nuka).toBe(1000);
  });

  it('ignores random/unsupported lines (nothing to grant)', () => {
    const save = makeSave();
    const lines = [
      { kind: 'random' as const, lootType: T.RandomLoots, qty: 1, label: 'Random Loot' },
      { kind: 'unsupported' as const, lootType: T.Dweller, qty: 1, label: 'Special Dweller' },
    ];
    expect(grantResolvedLoot(save, lines)).toBe(save); // no-op -> same reference
  });
});
