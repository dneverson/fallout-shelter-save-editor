// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import type { UniqueDweller } from '../../src/domain/gamedata/schemas.ts';
import { BASE_HP, MAX_DWELLER_HP, maxHpForLevel } from '../../src/domain/ops/dwellerHealth.ts';
import {
  DEFAULT_OUTFIT_ID,
  DEFAULT_WEAPON_ID,
  DwellerNotFoundError,
  addSpecialDweller,
  attachPetFromStorage,
  autoPickPartner,
  createDwellerAtDoor,
  createPet,
  deleteEquippedPet,
  detachPet,
  editEquippedPet,
  equipOutfit,
  equipWeapon,
  hasDweller,
  maxOutHealth,
  remove,
  removeDwellers,
  setColors,
  setFaceMask,
  setGender,
  setHair,
  setHappiness,
  setHealth,
  setLastName,
  setLevel,
  setMaxHealth,
  setName,
  setPregnancy,
  setRadiation,
  setRarity,
  setStat,
  unequipOutfit,
  unequipWeapon,
} from '../../src/domain/ops/dwellerOps.ts';

// A small but representative save: two dwellers plus an untouched sibling manager,
// so every test can assert structural sharing (untouched subtrees kept by ref) and
// immutability (the input is never mutated).
function makeSave(): SaveData {
  return {
    dwellers: {
      dwellers: [
        {
          serializeId: 1,
          name: 'Alice',
          lastName: 'Cox',
          gender: 1,
          rarity: 'Normal',
          hair: '01',
          faceMask: 'beard',
          pregnant: false,
          babyReady: false,
          skinColor: 0xffaabbcc,
          hairColor: 0xff112233,
          outfitColor: 0xffffffff,
          happiness: { happinessValue: 50 },
          health: { healthValue: 80, maxHealth: 100, radiationValue: 10 },
          experience: { currentLevel: 5, experienceValue: 1234, needLvUp: true },
          stats: { stats: [{ value: 1 }, { value: 3, mod: 2 }, { value: 4 }] },
        },
        { serializeId: 2, name: 'Bob' },
      ],
    },
    someManagerWeNeverTouch: { nested: { a: [1, 2, 3] } },
    appVersion: '1.0',
  } as SaveData;
}

/** Deep snapshot for immutability assertions. */
const snap = (s: SaveData): string => JSON.stringify(s);

describe('dwellerOps - immutability & structural sharing', () => {
  it('never mutates the input and shares untouched subtrees by reference', () => {
    const before = makeSave();
    const beforeJson = snap(before);
    const after = setName(before, 1, 'Renamed');

    // input untouched
    expect(snap(before)).toBe(beforeJson);
    // changed value present on the result
    expect(after.dwellers?.dwellers[0].name).toBe('Renamed');
    // untouched sibling dweller + manager shared by reference (structural sharing)
    expect(after.dwellers?.dwellers[1]).toBe(before.dwellers?.dwellers[1]);
    expect((after as Record<string, unknown>).someManagerWeNeverTouch).toBe(
      (before as Record<string, unknown>).someManagerWeNeverTouch,
    );
    // the edited dweller is a NEW object (not the original)
    expect(after.dwellers?.dwellers[0]).not.toBe(before.dwellers?.dwellers[0]);
  });
});

describe('dwellerOps - basic setters', () => {
  it('setName / setLastName / setGender / setRarity', () => {
    const s0 = makeSave();
    expect(setName(s0, 1, 'X').dwellers?.dwellers[0].name).toBe('X');
    expect(setLastName(s0, 1, 'Y').dwellers?.dwellers[0].lastName).toBe('Y');
    expect(setGender(s0, 1, 2).dwellers?.dwellers[0].gender).toBe(2);
    expect(setRarity(s0, 1, 'Legendary').dwellers?.dwellers[0].rarity).toBe('Legendary');
  });

  it('setHair sets the style id', () => {
    expect(setHair(makeSave(), 1, '07').dwellers?.dwellers[0].hair).toBe('07');
  });
});

describe('dwellerOps - SPECIAL', () => {
  it('writes stats.stats[idx].value and preserves the entry’s other keys', () => {
    const after = setStat(makeSave(), 1, 1, 8);
    const entry = after.dwellers?.dwellers[0].stats?.stats[1];
    expect(entry?.value).toBe(8);
    expect((entry as Record<string, unknown>).mod).toBe(2); // unchanged sibling key
  });

  it('clamps value to 1..10', () => {
    expect(setStat(makeSave(), 1, 1, 99).dwellers?.dwellers[0].stats?.stats[1].value).toBe(10);
    expect(setStat(makeSave(), 1, 1, 0).dwellers?.dwellers[0].stats?.stats[1].value).toBe(1);
  });

  it('rejects an out-of-range stat index', () => {
    expect(() => setStat(makeSave(), 1, 0, 5)).toThrow(RangeError);
    expect(() => setStat(makeSave(), 1, 8, 5)).toThrow(RangeError);
    expect(() => setStat(makeSave(), 1, 1.5, 5)).toThrow(RangeError);
  });
});

describe('dwellerOps - level', () => {
  it('sets currentLevel (clamped 1..50) and resets XP', () => {
    const after = setLevel(makeSave(), 1, 50);
    const exp = after.dwellers?.dwellers[0].experience;
    expect(exp?.currentLevel).toBe(50);
    expect(exp?.experienceValue).toBe(0);
    expect(exp?.needLvUp).toBe(false);
  });

  it('clamps the level to 1..50', () => {
    expect(setLevel(makeSave(), 1, 999).dwellers?.dwellers[0].experience?.currentLevel).toBe(50);
    expect(setLevel(makeSave(), 1, 0).dwellers?.dwellers[0].experience?.currentLevel).toBe(1);
  });
});

describe('dwellerHealth - formula (matches real saves + wiki)', () => {
  it('computes known in-game HP values', () => {
    expect(maxHpForLevel(1, 1)).toBe(105); // level 1 is always base
    expect(maxHpForLevel(50, 1)).toBe(252); // END 1  → +3/level
    expect(maxHpForLevel(50, 17)).toBe(644); // END 17 → +11/level (absolute max)
    expect(maxHpForLevel(15, 17)).toBe(259); // real Vault1.sav dweller
  });
});

describe('dwellerOps - HP scaling on level change', () => {
  // A minimal dweller whose Endurance (stats index 3) is known, for deterministic HP.
  const withEndurance = (end: number): SaveData =>
    ({
      dwellers: {
        dwellers: [
          {
            serializeId: 1,
            health: { healthValue: 50, maxHealth: 105, radiationValue: 0 },
            experience: { currentLevel: 1, experienceValue: 0, needLvUp: false },
            stats: { stats: [{ value: 1 }, { value: 1 }, { value: 1 }, { value: end }] },
          },
        ],
      },
    }) as SaveData;

  it('rescales maxHealth from base Endurance and refills health + stamps lastLevelUpdated', () => {
    const h = setLevel(withEndurance(10), 1, 50).dwellers?.dwellers[0].health;
    expect(h?.maxHealth).toBeCloseTo(472.5); // 105 + 49*(2.5 + 0.5*10)
    expect(h?.healthValue).toBeCloseTo(472.5); // level-up refills to full
    expect((h as Record<string, unknown>).lastLevelUpdated).toBe(50);
  });

  it('adds the equipped-outfit Endurance bonus to reach the 644 max', () => {
    // base END 10 + a +7 outfit = END 17 → 644 at level 50
    const h = setLevel(withEndurance(10), 1, 50, undefined, 7).dwellers?.dwellers[0].health;
    expect(h?.maxHealth).toBe(MAX_DWELLER_HP);
  });

  it('caps maxHealth at 644 by default, but writes raw when out-of-range clamp is off', () => {
    const capped = setLevel(withEndurance(10), 1, 50, undefined, 40);
    expect(capped.dwellers?.dwellers[0].health?.maxHealth).toBe(MAX_DWELLER_HP);
    const raw = setLevel(withEndurance(10), 1, 50, { clamp: false }, 40);
    expect(raw.dwellers?.dwellers[0].health?.maxHealth).toBeGreaterThan(MAX_DWELLER_HP);
  });

  it('keeps a level-1 dweller at 105 regardless of Endurance', () => {
    expect(setLevel(withEndurance(10), 1, 1).dwellers?.dwellers[0].health?.maxHealth).toBe(BASE_HP);
  });

  it('maxOutHealth pins both maxHealth and healthValue to the 644 cap', () => {
    const h = maxOutHealth(withEndurance(1), 1).dwellers?.dwellers[0].health;
    expect(h?.maxHealth).toBe(MAX_DWELLER_HP);
    expect(h?.healthValue).toBe(MAX_DWELLER_HP);
  });
});

describe('dwellerOps - health / radiation / happiness', () => {
  it('setHealth / setMaxHealth / setRadiation touch only their field', () => {
    const after = setHealth(makeSave(), 1, 42);
    const h = after.dwellers?.dwellers[0].health;
    expect(h?.healthValue).toBe(42);
    expect(h?.maxHealth).toBe(100); // preserved
    expect(h?.radiationValue).toBe(10); // preserved
    expect(setMaxHealth(makeSave(), 1, 200).dwellers?.dwellers[0].health?.maxHealth).toBe(200);
    expect(setRadiation(makeSave(), 1, 7).dwellers?.dwellers[0].health?.radiationValue).toBe(7);
  });

  it('floors health/maxHealth/radiation at 0', () => {
    expect(setHealth(makeSave(), 1, -5).dwellers?.dwellers[0].health?.healthValue).toBe(0);
    expect(setRadiation(makeSave(), 1, -5).dwellers?.dwellers[0].health?.radiationValue).toBe(0);
  });

  it('setHappiness clamps to 0..100', () => {
    expect(setHappiness(makeSave(), 1, 999).dwellers?.dwellers[0].happiness?.happinessValue).toBe(
      100,
    );
    expect(setHappiness(makeSave(), 1, -3).dwellers?.dwellers[0].happiness?.happinessValue).toBe(0);
  });
});

describe('dwellerOps - allow-out-of-range override', () => {
  it('setStat writes raw values past 1..10 when clamp is disabled', () => {
    expect(
      setStat(makeSave(), 1, 1, 99, { clamp: false }).dwellers?.dwellers[0].stats?.stats[1].value,
    ).toBe(99);
    expect(
      setStat(makeSave(), 1, 1, 0, { clamp: false }).dwellers?.dwellers[0].stats?.stats[1].value,
    ).toBe(0);
    // The structural index guard still applies regardless of clamp.
    expect(() => setStat(makeSave(), 1, 8, 5, { clamp: false })).toThrow(RangeError);
  });

  it('setLevel writes raw values past 1..50 when clamp is disabled (still resets XP)', () => {
    const after = setLevel(makeSave(), 1, 999, { clamp: false });
    expect(after.dwellers?.dwellers[0].experience?.currentLevel).toBe(999);
    expect(after.dwellers?.dwellers[0].experience?.experienceValue).toBe(0);
  });

  it('setHappiness writes raw values past 0..100 when clamp is disabled', () => {
    expect(
      setHappiness(makeSave(), 1, 250, { clamp: false }).dwellers?.dwellers[0].happiness
        ?.happinessValue,
    ).toBe(250);
  });

  it('clamps by default and when clamp is explicitly true', () => {
    expect(setStat(makeSave(), 1, 1, 99).dwellers?.dwellers[0].stats?.stats[1].value).toBe(10);
    expect(
      setStat(makeSave(), 1, 1, 99, { clamp: true }).dwellers?.dwellers[0].stats?.stats[1].value,
    ).toBe(10);
  });
});

describe('dwellerOps - appearance', () => {
  it('setColors updates only provided channels and coerces to uint32', () => {
    const after = setColors(makeSave(), 1, { skin: 0x11223344 });
    const d = after.dwellers?.dwellers[0];
    expect(d?.skinColor).toBe(0x11223344);
    expect(d?.hairColor).toBe(0xff112233); // untouched
    // negative / oversized coerced into uint32 space
    expect(setColors(makeSave(), 1, { outfit: -1 }).dwellers?.dwellers[0].outfitColor).toBe(
      0xffffffff,
    );
  });

  it('setFaceMask sets a string, and clears by removing the key when null', () => {
    expect(setFaceMask(makeSave(), 1, 'goatee').dwellers?.dwellers[0].faceMask).toBe('goatee');
    const cleared = setFaceMask(makeSave(), 1, null).dwellers?.dwellers[0];
    expect(cleared && 'faceMask' in cleared).toBe(false);
  });
});

describe('dwellerOps - pregnancy', () => {
  it('sets only the provided flags', () => {
    const after = setPregnancy(makeSave(), 1, { pregnant: true });
    expect(after.dwellers?.dwellers[0].pregnant).toBe(true);
    expect(after.dwellers?.dwellers[0].babyReady).toBe(false); // untouched
    expect(setPregnancy(makeSave(), 1, { babyReady: true }).dwellers?.dwellers[0].babyReady).toBe(
      true,
    );
  });
});

describe('dwellerOps - autoPickPartner', () => {
  /** A mother + candidates fixture; every dweller is an alive adult unless overridden. */
  const person = (
    serializeId: number,
    gender: number,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    serializeId,
    gender,
    health: { healthValue: 100 },
    experience: { currentLevel: 10 },
    relations: { partner: -1, ascendants: [-1, -1, -1, -1, -1, -1] },
    ...extra,
  });
  const saveWith = (dwellers: Record<string, unknown>[]): SaveData =>
    ({ dwellers: { dwellers } }) as unknown as SaveData;

  it('prefers a non-relative over a sibling (shared ascendant)', () => {
    const save = saveWith([
      person(1, 1, { relations: { partner: -1, ascendants: [5, 6, -1, -1, -1, -1] } }),
      // Brother: shares parent 5 with the mother.
      person(2, 2, { relations: { partner: -1, ascendants: [5, 7, -1, -1, -1, -1] } }),
      person(3, 2), // unrelated
    ]);
    const after = autoPickPartner(save, 1, () => 0);
    expect(after.dwellers?.dwellers[0].relations?.partner).toBe(3);
  });

  it('falls back to a relative when nobody unrelated qualifies', () => {
    const save = saveWith([
      person(1, 1, { relations: { partner: -1, ascendants: [5, 6, -1, -1, -1, -1] } }),
      person(2, 2, { relations: { partner: -1, ascendants: [5, 7, -1, -1, -1, -1] } }),
    ]);
    const after = autoPickPartner(save, 1, () => 0);
    expect(after.dwellers?.dwellers[0].relations?.partner).toBe(2);
  });

  it('skips children, the dead, same gender, and keeps an existing partner', () => {
    const save = saveWith([
      person(1, 1),
      person(2, 2, { experience: { currentLevel: 0 } }), // child
      person(3, 2, { health: { healthValue: 0 } }), // dead
      person(4, 1), // same gender
    ]);
    expect(autoPickPartner(save, 1)).toBe(save); // nobody qualifies → no-op

    const partnered = saveWith([
      person(1, 1, { relations: { partner: 9, ascendants: [-1, -1, -1, -1, -1, -1] } }),
      person(2, 2),
    ]);
    expect(autoPickPartner(partnered, 1)).toBe(partnered); // already recorded → no-op
  });
});

describe('dwellerOps - remove', () => {
  it('drops the target and keeps survivors (by reference)', () => {
    const before = makeSave();
    const after = remove(before, 1);
    expect(after.dwellers?.dwellers).toHaveLength(1);
    expect(after.dwellers?.dwellers[0].serializeId).toBe(2);
    expect(after.dwellers?.dwellers[0]).toBe(before.dwellers?.dwellers[1]);
    expect(snap(before)).toBe(snap(makeSave())); // input untouched
  });
});

describe('dwellerOps - removeDwellers (bulk + reference scrub)', () => {
  // A save exercising every reference kind the op must scrub: work/dead rosters,
  // a training slot, a female-anchored partnership with a birth task, a child entry
  // with a grow-up task, a wasteland team, and the tasks those entries own.
  function makeReferencedSave(): SaveData {
    return {
      dwellers: {
        dwellers: [
          { serializeId: 1, name: 'Worker' },
          { serializeId: 2, name: 'Mother', gender: 1 },
          { serializeId: 3, name: 'Father', gender: 2 },
          { serializeId: 4, name: 'Child' },
          { serializeId: 5, name: 'Explorer' },
          { serializeId: 6, name: 'Survivor' },
        ],
      },
      vault: {
        rooms: [
          { type: 'Energy', deserializeID: 10, dwellers: [1, 6], deadDwellers: [1] },
          {
            type: 'TrainingRoomS',
            deserializeID: 11,
            slots: [
              { dwellerID: 1, taskID: 501 },
              { dwellerID: 6, taskID: 502 },
            ],
          },
          {
            type: 'LivingQuarters',
            deserializeID: 12,
            partners: [
              { m: 3, f: 2, s: 'RaisingBaby', t: 503 },
              { m: 1, f: 6, s: 'Partners' },
            ],
            children: [{ taskID: 504, dwellerID: 4, notificationID: -1 }],
          },
        ],
        wasteland: {
          teams: [
            { dwellers: [5], status: 'Exploring', elapsedTimeAliveExploring: 100 },
            { dwellers: [5, 6], status: 'Exploring' },
          ],
        },
      },
      taskMgr: {
        id: 600,
        time: 1000,
        tasks: [
          { id: 501, startTime: 0, endTime: 2000 },
          { id: 503, startTime: 0, endTime: 3000 },
          { id: 504, startTime: 0, endTime: 4000 },
          { id: 599, startTime: 0, endTime: 5000 }, // unrelated - must survive
        ],
        pausedTasks: [{ id: 502, startTime: 0, endTime: 2500 }],
      },
      someManagerWeNeverTouch: { nested: true },
    } as unknown as SaveData;
  }

  it('scrubs rosters, training slots, partner/child entries, teams and their tasks', () => {
    const before = makeReferencedSave();
    const beforeJson = snap(before);
    const after = removeDwellers(before, [1, 2, 4, 5]);

    // Dweller list: only 3 (Father) and 6 (Survivor) remain, survivors by reference.
    expect(after.dwellers?.dwellers.map((d) => d.serializeId)).toEqual([3, 6]);
    expect(after.dwellers?.dwellers[1]).toBe(before.dwellers?.dwellers[5]);

    const rooms = after.vault?.rooms ?? [];
    // Work + dead rosters scrubbed.
    expect(rooms[0]?.dwellers).toEqual([6]);
    expect(rooms[0]?.deadDwellers).toEqual([]);
    // Removed dweller's training slot reset to the game's empty sentinels; the
    // other slot untouched by reference.
    expect(rooms[1]?.slots?.[0]).toEqual({ dwellerID: -2, taskID: -2 });
    expect(rooms[1]?.slots?.[1]).toBe(before.vault?.rooms?.[1]?.slots?.[1]);
    // Mother removed -> her partnership entry dropped; the male-only entry stays
    // (the game keeps it - IsValid() only needs the female).
    expect(rooms[2]?.partners).toHaveLength(1);
    expect(rooms[2]?.partners?.[0]).toBe(before.vault?.rooms?.[2]?.partners?.[1]);
    // Child removed -> child entry dropped.
    expect(rooms[2]?.children).toEqual([]);

    // Solo team dropped whole; mixed team keeps the survivor.
    expect(after.vault?.wasteland?.teams).toHaveLength(1);
    expect(after.vault?.wasteland?.teams?.[0]?.dwellers).toEqual([6]);

    // Orphaned tasks (training 501, birth 503, grow-up 504) deleted; the unrelated
    // task and the surviving dweller's paused training task (502) are kept.
    expect(after.taskMgr?.tasks?.map((t) => t.id)).toEqual([599]);
    expect(after.taskMgr?.pausedTasks?.map((t) => t.id)).toEqual([502]);

    // Input never mutated; untouched sibling manager shared by reference.
    expect(snap(before)).toBe(beforeJson);
    expect((after as Record<string, unknown>).someManagerWeNeverTouch).toBe(
      (before as Record<string, unknown>).someManagerWeNeverTouch,
    );
  });

  it('is a same-reference no-op when no requested id exists', () => {
    const before = makeReferencedSave();
    expect(removeDwellers(before, [999])).toBe(before);
    expect(removeDwellers(before, [])).toBe(before);
  });

  it("resets a surviving partnership's dangling fatherId and child templateID to -1", () => {
    // Mother (2) survives; the removed dweller (4) is both the recorded father and the
    // first-born template of a multi-birth. The game resets fatherId itself on removal
    // (OnDwellerRemoved); templateID left dangling would NPE in CreateChild at the next
    // sibling's birth (unchecked GetDwellerById(templateID).m_gender).
    const before = {
      dwellers: { dwellers: [{ serializeId: 2 }, { serializeId: 4 }] },
      vault: {
        rooms: [
          {
            type: 'LivingQuarters',
            deserializeID: 12,
            partners: [
              { m: 4, f: 2, s: 'RaisingBaby', t: 503, fatherId: 4, templateID: 4 },
              { m: 9, f: 2, s: 'Partners', fatherId: 9, templateID: -1 },
            ],
          },
        ],
      },
    } as unknown as SaveData;

    const after = removeDwellers(before, [4]);
    const partners = after.vault?.rooms?.[0]?.partners ?? [];
    expect(partners[0]).toMatchObject({ m: 4, f: 2, t: 503, fatherId: -1, templateID: -1 });
    // Entry with no dangling ids untouched by reference; the birth task survives with
    // the partnership (only female-removal orphans it).
    expect(partners[1]).toBe(before.vault?.rooms?.[0]?.partners?.[1]);
  });

  it('skips unknown ids and leaves untouched subtrees shared', () => {
    const before = makeReferencedSave();
    const after = removeDwellers(before, [6, 999]);
    expect(after.dwellers?.dwellers.map((d) => d.serializeId)).toEqual([1, 2, 3, 4, 5]);
    // 6 was on room 10's roster, slot 502, a partnership (as female f=6) and a team.
    expect(after.vault?.rooms?.[0]?.dwellers).toEqual([1]);
    expect(after.vault?.rooms?.[1]?.slots?.[1]).toEqual({ dwellerID: -2, taskID: -2 });
    // 6's training task lived in pausedTasks - the paused list is scrubbed too.
    expect(after.taskMgr?.pausedTasks).toEqual([]);
    expect(after.taskMgr?.tasks?.map((t) => t.id)).toEqual([501, 503, 504, 599]);
    expect(after.vault?.rooms?.[2]?.partners).toHaveLength(1);
    // Untouched room kept by reference? Room 12 changed (partner f=6 dropped); room 10 changed;
    // the living quarters children array is untouched by reference.
    expect(after.vault?.rooms?.[2]?.children).toBe(before.vault?.rooms?.[2]?.children);
  });
});

describe('dwellerOps - createDwellerAtDoor', () => {
  it('appends a level-1 at-door dweller with the next serializeId and bumps the counter', () => {
    const before = makeSave(); // dwellers 1 & 2, no counter
    const after = createDwellerAtDoor(before, { name: 'New', lastName: 'Comer', gender: 1 });
    const list = after.dwellers?.dwellers ?? [];
    expect(list).toHaveLength(3);
    const created = list[2];
    expect(created.serializeId).toBe(3); // max(2, counter 0) + 1
    expect((after.dwellers as Record<string, unknown>).id).toBe(3); // counter bumped
    expect(created.name).toBe('New');
    expect(created.lastName).toBe('Comer');
    expect(created.gender).toBe(1);
    expect(created.savedRoom).toBe(-1);
    expect(created.assigned).toBe(false);
    expect(created.experience?.currentLevel).toBe(1);
    expect(created.stats?.stats).toHaveLength(8);
    expect(created.stats?.stats.slice(1).every((s) => s.value === 1)).toBe(true);
    expect(created.equipedWeapon?.id).toBe(DEFAULT_WEAPON_ID);
    expect(created.equipedOutfit?.id).toBe(DEFAULT_OUTFIT_ID);
  });

  it('uses the running counter when it exceeds the max serializeId (gaps after deletes)', () => {
    const before = makeSave();
    (before.dwellers as Record<string, unknown>).id = 141; // counter past the live ids
    const created = createDwellerAtDoor(before).dwellers?.dwellers.at(-1);
    expect(created?.serializeId).toBe(142);
  });

  it('defaults names to empty and gender to male', () => {
    const created = createDwellerAtDoor(makeSave()).dwellers?.dwellers.at(-1);
    expect(created?.name).toBe('');
    expect(created?.lastName).toBe('');
    expect(created?.gender).toBe(2);
  });

  it('does not mutate the input and shares untouched dwellers by reference', () => {
    const before = makeSave();
    const json = snap(before);
    const after = createDwellerAtDoor(before);
    expect(snap(before)).toBe(json);
    expect(after.dwellers?.dwellers[0]).toBe(before.dwellers?.dwellers[0]);
  });

  it('constructs the dwellers block when the save has none', () => {
    const after = createDwellerAtDoor({} as SaveData);
    const list = after.dwellers?.dwellers ?? [];
    expect(list).toHaveLength(1);
    expect(list[0].serializeId).toBe(1);
  });
});

describe('dwellerOps - addSpecialDweller', () => {
  const MAX: UniqueDweller = {
    ascendancyId: -48,
    name: 'Maximus',
    lastName: '',
    gender: 2,
    hair: '03',
    faceMask: null,
    outfitId: 'BOSCasual',
    weaponId: 'T60Pistol',
    skinColor: 4286339388,
    hairColor: 4280623644,
    stats: [7, 6, 6, 5, 4, 7, 5],
    isInfertile: false,
    randomBody: false,
    randomName: false,
  };

  it('appends a named dweller stamped with uniqueData + the catalog customization', () => {
    const after = addSpecialDweller(makeSave(), 'L_Max', MAX);
    const list = after.dwellers?.dwellers ?? [];
    expect(list).toHaveLength(3);
    const created = list[2];
    expect(created.serializeId).toBe(3); // running counter, like at-door
    expect((after.dwellers as Record<string, unknown>).id).toBe(3);
    expect(created.uniqueData).toBe('L_Max');
    expect(created.name).toBe('Maximus');
    expect(created.gender).toBe(2);
    expect(created.hair).toBe('03');
    expect(created.skinColor).toBe(4286339388);
    expect(created.hairColor).toBe(4280623644);
    expect(created.equipedOutfit?.id).toBe('BOSCasual');
    expect(created.equipedWeapon?.id).toBe('T60Pistol');
    expect(created.savedRoom).toBe(-1);
    expect(created.experience?.currentLevel).toBe(1);
  });

  it('maps the 7 catalog SPECIAL values to stat indices 1..7 (clamped 1..10)', () => {
    const created = addSpecialDweller(makeSave(), 'L_Max', MAX).dwellers?.dwellers.at(-1);
    expect(created?.stats?.stats).toHaveLength(8);
    expect(created?.stats?.stats.slice(1).map((s) => s.value)).toEqual([7, 6, 6, 5, 4, 7, 5]);
  });

  it('omits the faceMask key when the catalog has none, and writes it when present', () => {
    const noBeard = addSpecialDweller(makeSave(), 'L_Max', MAX).dwellers?.dwellers.at(-1);
    expect(noBeard?.faceMask).toBeUndefined();
    const bearded = addSpecialDweller(makeSave(), 'X', {
      ...MAX,
      faceMask: 'glasses2',
    }).dwellers?.dwellers.at(-1);
    expect(bearded?.faceMask).toBe('glasses2');
  });

  it('falls back to the vault default weapon when the catalog weapon id is empty', () => {
    const created = addSpecialDweller(makeSave(), 'X', {
      ...MAX,
      weaponId: '',
    }).dwellers?.dwellers.at(-1);
    expect(created?.equipedWeapon?.id).toBe(DEFAULT_WEAPON_ID);
  });

  it('keeps neutral base appearance for random-body characters but still sets equipment/SPECIAL', () => {
    const created = addSpecialDweller(makeSave(), 'Cleric', {
      ...MAX,
      randomBody: true,
      hair: null,
      skinColor: 0xff000000,
      outfitId: 'BishopSpecial',
    }).dwellers?.dwellers.at(-1);
    // base appearance retained (hair '08', base skin), not the catalog look
    expect(created?.hair).toBe('08');
    expect(created?.skinColor).not.toBe(0xff000000);
    // equipment + SPECIAL still applied
    expect(created?.equipedOutfit?.id).toBe('BishopSpecial');
    expect(created?.stats?.stats[1].value).toBe(7);
  });

  it('does not mutate the input and shares untouched dwellers by reference', () => {
    const before = makeSave();
    const json = snap(before);
    const after = addSpecialDweller(before, 'L_Max', MAX);
    expect(snap(before)).toBe(json);
    expect(after.dwellers?.dwellers[0]).toBe(before.dwellers?.dwellers[0]);
  });
});

describe('dwellerOps - missing dweller', () => {
  it('throws DwellerNotFoundError for an unknown id', () => {
    expect(() => setName(makeSave(), 999, 'X')).toThrow(DwellerNotFoundError);
    expect(() => remove(makeSave(), 999)).toThrow(DwellerNotFoundError);
  });

  it('hasDweller reflects presence', () => {
    expect(hasDweller(makeSave(), 1)).toBe(true);
    expect(hasDweller(makeSave(), 999)).toBe(false);
  });
});

// A save with equipped slots + a stored pet, matching the real save's shapes
// (equiped*/equippedPet spellings, hasRandonWeaponBeenAssigned, pet extraData).
function makeEquipSave(): SaveData {
  return {
    dwellers: {
      dwellers: [
        {
          serializeId: 1,
          name: 'Alice',
          equipedWeapon: {
            id: 'GatlingLaser_Vengeance',
            type: 'Weapon',
            hasBeenAssigned: false,
            hasRandonWeaponBeenAssigned: false,
          },
          equipedOutfit: {
            id: 'ScarredPowerArmor',
            type: 'Outfit',
            hasBeenAssigned: false,
            hasRandonWeaponBeenAssigned: false,
          },
          equippedPet: {
            id: 'lykoi_l',
            type: 'Pet',
            hasBeenAssigned: false,
            hasRandonWeaponBeenAssigned: false,
            extraData: { uniqueName: 'Calypso', bonus: 'DamageBoost', bonusValue: 6 },
          },
        },
        { serializeId: 2, name: 'Bob' }, // no pet equipped
      ],
    },
    vault: {
      inventory: {
        items: [
          { id: 'TeddyBear', type: 'Junk' },
          {
            id: 'persian_l',
            type: 'Pet',
            extraData: { uniqueName: 'Mr. Pebbles', bonus: 'HappinessBoost', bonusValue: 95 },
          },
        ],
      },
    },
    appVersion: '1.0',
  } as SaveData;
}

describe('dwellerOps - equip weapons & outfits', () => {
  it('equipWeapon/equipOutfit write the id+type and preserve the slot’s other keys', () => {
    const w = equipWeapon(makeEquipSave(), 1, 'PlasmaRifle').dwellers?.dwellers[0].equipedWeapon;
    expect(w?.id).toBe('PlasmaRifle');
    expect(w?.type).toBe('Weapon');
    expect((w as Record<string, unknown>).hasRandonWeaponBeenAssigned).toBe(false); // preserved

    const o = equipOutfit(makeEquipSave(), 1, 'Jumpsuit2').dwellers?.dwellers[0].equipedOutfit;
    expect(o?.id).toBe('Jumpsuit2');
    expect(o?.type).toBe('Outfit');
  });

  it('unequip resets weapon→Fist and outfit→jumpsuit (the game has no empty slot)', () => {
    expect(unequipWeapon(makeEquipSave(), 1).dwellers?.dwellers[0].equipedWeapon?.id).toBe(
      DEFAULT_WEAPON_ID,
    );
    expect(unequipOutfit(makeEquipSave(), 1).dwellers?.dwellers[0].equipedOutfit?.id).toBe(
      DEFAULT_OUTFIT_ID,
    );
  });

  it('creates a fresh slot with the standard flags when none exists', () => {
    const w = equipWeapon(makeEquipSave(), 2, 'Fist').dwellers?.dwellers[1].equipedWeapon;
    expect(w?.id).toBe('Fist');
    expect((w as Record<string, unknown>).hasBeenAssigned).toBe(false);
  });

  it('does not mutate the input', () => {
    const before = makeEquipSave();
    const json = snap(before);
    equipWeapon(before, 1, 'X');
    expect(snap(before)).toBe(json);
  });
});

describe('dwellerOps - pets', () => {
  it('attachPetFromStorage moves the stored pet into the slot and swaps the old one back', () => {
    const after = attachPetFromStorage(makeEquipSave(), 1, 1); // index 1 = persian_l
    expect(after.dwellers?.dwellers[0].equippedPet?.id).toBe('persian_l');
    const items = after.vault?.inventory?.items ?? [];
    // persian_l left storage; the previously-worn lykoi_l returned to it.
    expect(items.find((i) => i.id === 'persian_l')).toBeUndefined();
    expect(items.find((i) => i.id === 'lykoi_l')).toBeDefined();
    expect(items.find((i) => i.id === 'TeddyBear')).toBeDefined(); // untouched junk
  });

  it('attachPetFromStorage on a dweller with no pet just consumes the stored pet', () => {
    const after = attachPetFromStorage(makeEquipSave(), 2, 1);
    expect(after.dwellers?.dwellers[1].equippedPet?.id).toBe('persian_l');
    expect((after.vault?.inventory?.items ?? []).some((i) => i.type === 'Pet')).toBe(false);
  });

  it('rejects attaching a non-pet inventory item', () => {
    expect(() => attachPetFromStorage(makeEquipSave(), 1, 0)).toThrow(TypeError); // index 0 = Junk
    expect(() => attachPetFromStorage(makeEquipSave(), 1, 99)).toThrow(RangeError);
  });

  it('createPet builds the instance shape and swaps any current pet to storage', () => {
    const after = createPet(makeEquipSave(), 1, {
      petId: 'husky_c',
      uniqueName: 'Rex',
      bonus: 'XPBoost',
      bonusValue: 12,
    });
    const pet = after.dwellers?.dwellers[0].equippedPet;
    expect(pet).toMatchObject({
      id: 'husky_c',
      type: 'Pet',
      extraData: { uniqueName: 'Rex', bonus: 'XPBoost', bonusValue: 12 },
    });
    expect((after.vault?.inventory?.items ?? []).find((i) => i.id === 'lykoi_l')).toBeDefined();
  });

  it('editEquippedPet changes value/name but keeps the bonus locked', () => {
    const after = editEquippedPet(makeEquipSave(), 1, { bonusValue: 6, uniqueName: 'Calypso II' });
    const extra = after.dwellers?.dwellers[0].equippedPet?.extraData;
    expect(extra?.bonusValue).toBe(6);
    expect(extra?.uniqueName).toBe('Calypso II');
    expect(extra?.bonus).toBe('DamageBoost'); // never changed
  });

  it('editEquippedPet is a no-op (same ref) when no pet is equipped', () => {
    const before = makeEquipSave();
    expect(editEquippedPet(before, 2, { bonusValue: 1 })).toBe(before);
  });

  it('detachPet returns the pet to storage and DELETES the equippedPet key', () => {
    const after = detachPet(makeEquipSave(), 1);
    const dweller = after.dwellers?.dwellers[0];
    expect(dweller && 'equippedPet' in dweller).toBe(false);
    expect((after.vault?.inventory?.items ?? []).find((i) => i.id === 'lykoi_l')).toBeDefined();
  });

  it('detachPet is a no-op (same ref) when no pet is equipped', () => {
    const before = makeEquipSave();
    expect(detachPet(before, 2)).toBe(before);
  });

  it('deleteEquippedPet removes the key WITHOUT returning the pet to storage', () => {
    const before = makeEquipSave();
    const storedBefore = (before.vault?.inventory?.items ?? []).length;
    const after = deleteEquippedPet(before, 1);
    const dweller = after.dwellers?.dwellers[0];
    expect(dweller && 'equippedPet' in dweller).toBe(false);
    // Unlike detachPet, the instance is destroyed - inventory is unchanged.
    expect((after.vault?.inventory?.items ?? []).length).toBe(storedBefore);
    expect((after.vault?.inventory?.items ?? []).find((i) => i.id === 'lykoi_l')).toBeUndefined();
  });

  it('deleteEquippedPet is a no-op (same ref) when no pet is equipped', () => {
    const before = makeEquipSave();
    expect(deleteEquippedPet(before, 2)).toBe(before);
  });
});
