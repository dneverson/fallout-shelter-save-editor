// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseGameData, type GameData } from '../../src/domain/gamedata/gameData.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import { autoStaff, autoStaffPlan } from '../../src/domain/ops/autoStaffOps.ts';
import { vaultMetrics } from '../../src/domain/selectors/vaultSelectors.ts';

// A vault with one Strength room (Diner, 1-merge/level-1, 2 slots) + a strongest-Strength
// outfit and a weapon, so the generator has something to equip recruits with.
function makeGameData(): GameData {
  return parseGameData({
    weapons: [
      {
        id: 'Laser',
        name: 'Laser Pistol',
        damageMin: 5,
        damageMax: 7,
        type: 1,
        tier: 1,
        rarity: 'Rare',
        sprite: 'x',
      },
    ],
    outfits: [
      {
        id: 'StrSuit',
        name: 'Power Outfit',
        category: 1,
        special: { S: 5, P: 0, E: 0, C: 0, I: 0, A: 0, L: 0 },
        hasHelmet: false,
        rarity: 'Rare',
        sprite: 'x',
      },
    ],
    junk: [],
    pets: [],
    hair: [],
    enums: {},
    meta: { gameVersion: 'x', unityVersion: 'y', generatedAt: 'z', counts: {} },
    unlockables: { recipes: [], roomUnlocks: [] },
    roomCapacity: {
      base: { resources: {}, items: 0, maxPetCount: 0, mrHandyHealth: 5000 },
      perDweller: {},
      rooms: {
        Diner: { '1': { '1': { maxDwellers: 2, storage: {}, storageItems: 0 } } },
        WeightRoom: { '1': { '1': { maxDwellers: 2, storage: {}, storageItems: 0 } } },
        // Population capacity source: generation is budgeted by the living-quarters cap.
        LivingQuarters: {
          '1': { '1': { maxDwellers: 0, storage: {}, storageItems: 0, populationIncrease: 50 } },
        },
      },
    },
    roomMetadata: {
      rooms: {
        Diner: {
          name: 'Diner',
          class: 'Facility',
          primaryStat: 'Strength',
          width: 3,
          height: 1,
          maxMergeLevel: 3,
          maxLevel: 3,
          buildCost: {},
          instantBuildCost: {},
          priceFactor: 0,
          buildLocId: '',
        },
        // A stat room that produces nothing - included by 'all' mode, skipped by 'output'.
        WeightRoom: {
          name: 'Weight Room',
          class: 'TrainingRoom',
          primaryStat: 'Endurance',
          width: 3,
          height: 1,
          maxMergeLevel: 3,
          maxLevel: 3,
          buildCost: {},
          instantBuildCost: {},
          priceFactor: 0,
          buildLocId: '',
        },
      },
    },
    roomProduction: {
      globals: {
        taskCycle: 0.1,
        noRushResourcesMultiplier: 1,
        foodConsumptionPerDweller: 0.06,
        waterConsumptionPerDweller: 0.06,
        dwellerConsumptionPeriod: 10,
        energyConsumptionPeriod: 8,
        happinessFactorList: [0, 0.1],
      },
      rooms: {
        Diner: { '1': { '1': { produced: { Food: 1 }, reserve: {}, consumption: {} } } },
      },
    },
    uniqueDwellers: {},
  });
}

/** Dweller with Strength `s`, level `lvl`, at room `savedRoom` (-1 = idle). */
function dweller(id: number, s: number, lvl: number, savedRoom: number) {
  return {
    serializeId: id,
    savedRoom,
    health: { healthValue: 100, maxHealth: 100 },
    experience: { currentLevel: lvl },
    stats: {
      stats: [
        { value: 0 },
        { value: s },
        { value: s },
        { value: s },
        { value: s },
        { value: s },
        { value: s },
        { value: s },
      ],
    },
  };
}

const room = (type: string, deserializeID: number, dwellers: number[] = []) => ({
  type,
  deserializeID,
  row: 0,
  col: 0,
  level: 1,
  mergeLevel: 1,
  power: true,
  broken: false,
  dwellers,
});
const diner = (deserializeID = 1, dwellers: number[] = []) =>
  room('Diner', deserializeID, dwellers);
const weightRoom = (deserializeID = 2, dwellers: number[] = []) =>
  room('WeightRoom', deserializeID, dwellers);

function makeSave(dwellers: ReturnType<typeof dweller>[], rooms: unknown[]): SaveData {
  // Every save carries one living quarters (population cap 50, not staffable - no
  // primaryStat metadata) so recruit generation has capacity headroom by default.
  return {
    dwellers: { dwellers, id: dwellers.length },
    vault: { rooms: [...rooms, room('LivingQuarters', 1000)] },
  } as unknown as SaveData;
}

describe('autoStaffPlan', () => {
  it('counts free slots and splits assign vs generate', () => {
    // 2-slot Diner, 1 idle dweller → 1 assigned from pool, 1 needs generating.
    const save = makeSave([dweller(1, 5, 10, -1)], [diner(1, [])]);
    const plan = autoStaffPlan(save, makeGameData(), 'all');
    expect(plan).toEqual({ freeSlots: 2, idle: 1, toAssign: 1, toGenerate: 1 });
  });

  it('reports nothing to do for a fully staffed vault', () => {
    const save = makeSave([dweller(1, 5, 10, 1), dweller(2, 5, 10, 1)], [diner(1, [1, 2])]);
    const plan = autoStaffPlan(save, makeGameData(), 'all');
    expect(plan).toEqual({ freeSlots: 0, idle: 0, toAssign: 0, toGenerate: 0 });
  });

  it('counts occupancy from the room ROSTER even when savedRoom lags behind', () => {
    // Dweller 2 is on the roster but physically away (savedRoom -1: exploring/idle keep
    // their slot - verified against a genuine game save). The room is FULL: no free slots,
    // and dweller 2 is NOT idle. Counting savedRoom instead produced the "3/4 advisory on
    // a 4/4 room" bug and made auto-staff over-fill full rooms.
    const save = makeSave([dweller(1, 5, 10, 1), dweller(2, 5, 10, -1)], [diner(1, [1, 2])]);
    const plan = autoStaffPlan(save, makeGameData(), 'all');
    expect(plan).toEqual({ freeSlots: 0, idle: 0, toAssign: 0, toGenerate: 0 });
  });

  it('ignores ghost roster ids (no matching dweller) when counting occupancy', () => {
    // Roster claims [1, 77] but 77 does not exist - one real occupant, one free slot.
    const save = makeSave([dweller(1, 5, 10, 1)], [diner(1, [1, 77])]);
    const plan = autoStaffPlan(save, makeGameData(), 'all');
    expect(plan).toEqual({ freeSlots: 1, idle: 0, toAssign: 0, toGenerate: 1 });
  });

  it('output mode targets only producers; all mode includes non-producers', () => {
    // Empty 2-slot Diner (producer) + empty 2-slot Weight Room (non-producer).
    const save = makeSave([], [diner(1, []), weightRoom(2, [])]);
    expect(autoStaffPlan(save, makeGameData(), 'output').freeSlots).toBe(2);
    expect(autoStaffPlan(save, makeGameData(), 'all').freeSlots).toBe(4);
  });
});

describe('autoStaff - assigning existing dwellers', () => {
  it('fills slots highest-stat-first and never generates when generate=false', () => {
    // 3 idle (S=8/5/2); a single 2-slot Diner takes the two strongest (ids 1 & 2).
    const save = makeSave(
      [dweller(1, 8, 10, -1), dweller(2, 5, 10, -1), dweller(3, 2, 10, -1)],
      [diner(1, [])],
    );
    const next = autoStaff(save, makeGameData(), { mode: 'all', generate: false });

    const filled = next.vault?.rooms?.[0];
    expect(filled?.dwellers).toEqual([1, 2]);
    // The weakest stayed idle; no new dwellers were created.
    const byId = new Map(next.dwellers?.dwellers?.map((d) => [d.serializeId, d]));
    expect(byId.get(3)?.savedRoom).toBe(-1);
    expect(next.dwellers?.dwellers?.length).toBe(3);
  });
});

describe('autoStaff - generating recruits', () => {
  it('creates equipped, vault-scaled recruits for the shortfall and assigns them', () => {
    // Baseline dwellers (rostered in another full room, so not idle) set avg level 20,
    // avg Strength 6. No idle dwellers, so both empty-Diner slots must be generated.
    const save = makeSave(
      [dweller(10, 6, 20, 99), dweller(11, 6, 20, 99)],
      [diner(1, []), diner(99, [10, 11])],
    );
    const next = autoStaff(save, makeGameData(), { mode: 'all', generate: true, rng: () => 0.5 });

    // Two recruits added and both assigned to the room.
    expect(next.dwellers?.dwellers?.length).toBe(4);
    const filled = next.vault?.rooms?.[0];
    expect(filled?.dwellers?.length).toBe(2);

    const recruits = (next.dwellers?.dwellers ?? []).filter((d) => d.serializeId > 11);
    expect(recruits).toHaveLength(2);
    for (const r of recruits) {
      expect(r.savedRoom).toBe(1);
      // rng 0.5 → zero jitter → level == avg (20).
      expect(r.experience?.currentLevel).toBe(20);
      // Auto-generated name (no longer blank).
      expect(r.name).toBeTruthy();
      expect(r.lastName).toBeTruthy();
      // Equipped with the strongest Strength outfit + the weapon.
      expect(r.equipedOutfit?.id).toBe('StrSuit');
      expect(r.equipedWeapon?.id).toBe('Laser');
      // Primary stat (Strength, index 1) biased +2 over the vault avg (6) → 8.
      expect(r.stats?.stats?.[1]?.value).toBe(8);
      // Non-primary stats center on the vault average (6), not pinned to 10.
      expect(r.stats?.stats?.[2]?.value).toBe(6);
    }
  });

  it('assigns existing first, then generates only the remainder', () => {
    // 1 idle + 2-slot room → 1 assigned, 1 generated.
    const save = makeSave([dweller(1, 7, 15, -1)], [diner(1, [])]);
    const next = autoStaff(save, makeGameData(), { mode: 'all', generate: true, rng: () => 0.5 });

    expect(next.dwellers?.dwellers?.length).toBe(2); // one original + one recruit
    const filled = next.vault?.rooms?.[0];
    expect(filled?.dwellers).toContain(1);
    expect(filled?.dwellers?.length).toBe(2);
  });

  it('generate-only (assignExisting=false) fills every slot with recruits, leaving idle alone', () => {
    // 1 idle + 2-slot room → both slots generated; the idle dweller is untouched.
    const save = makeSave([dweller(1, 7, 15, -1)], [diner(1, [])]);
    const next = autoStaff(save, makeGameData(), {
      mode: 'all',
      generate: true,
      assignExisting: false,
      rng: () => 0.5,
    });

    expect(next.dwellers?.dwellers?.length).toBe(3); // original idle + two recruits
    const filled = next.vault?.rooms?.[0];
    expect(filled?.dwellers?.length).toBe(2);
    expect(filled?.dwellers).not.toContain(1); // idle dweller was not assigned
    const idleStill = next.dwellers?.dwellers?.find((d) => d.serializeId === 1);
    expect(idleStill?.savedRoom).toBe(-1);
  });

  it('stops generating at the vault population cap and predicts it in the plan', () => {
    // Cap 50, 49 dwellers already in the vault (rostered elsewhere), a 2-slot empty
    // Diner and no idle pool: only ONE recruit fits before the vault is full.
    const residents = Array.from({ length: 49 }, (_, i) => dweller(i + 1, 5, 10, 99));
    const save = makeSave(residents, [
      diner(1, []),
      room(
        'Diner',
        99,
        residents.map((d) => d.serializeId),
      ),
    ]);
    const plan = autoStaffPlan(save, makeGameData(), 'all');
    expect(plan.toGenerate).toBe(1); // 2 free slots, but only 1 population slot left

    const next = autoStaff(save, makeGameData(), { mode: 'all', generate: true, rng: () => 0.5 });
    expect(next.dwellers?.dwellers?.length).toBe(50); // capped, not 51
    expect(next.vault?.rooms?.[0]?.dwellers?.length).toBe(1);
  });
});

describe('vaultMetrics', () => {
  it('summarizes population, rooms, pets and storage', () => {
    const save = {
      dwellers: {
        dwellers: [
          { serializeId: 1, health: { healthValue: 100 }, experience: { currentLevel: 10 } },
          { serializeId: 2, health: { healthValue: 100 }, experience: { currentLevel: 20 } },
          // Dead dweller - excluded from population + avg level.
          { serializeId: 3, health: { healthValue: 0 }, experience: { currentLevel: 50 } },
          // Equipped pet counts toward pets owned.
          {
            serializeId: 4,
            health: { healthValue: 100 },
            experience: { currentLevel: 30 },
            equippedPet: { id: 'dog', type: 'Pet' },
          },
        ],
      },
      vault: {
        rooms: [{ deserializeID: 1 }, { deserializeID: 2 }],
        inventory: {
          items: [
            { id: 'a', type: 'Weapon' },
            { id: 'b', type: 'Weapon' },
            { id: 'c', type: 'Outfit' },
            { id: 'd', type: 'Junk' },
            { id: 'e', type: 'Pet' },
          ],
        },
      },
    } as unknown as SaveData;

    const m = vaultMetrics(save);
    expect(m.roomCount).toBe(2);
    expect(m.population).toBe(3); // 3 alive
    expect(m.populationCap).toBe(200);
    expect(m.avgLevel).toBeCloseTo((10 + 20 + 30) / 3);
    expect(m.petsOwned).toBe(2); // 1 stored + 1 equipped
    expect(m.weapons).toBe(2);
    expect(m.outfits).toBe(1);
    expect(m.junk).toBe(1);
  });
});
