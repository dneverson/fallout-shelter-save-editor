import { describe, expect, it } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  RoomNotFoundError,
  addRoom,
  assignDweller,
  maxRoomLevel,
  mergeRoomWith,
  moveMrHandyToFloor,
  mrHandiesByFloor,
  moveRoom,
  nextRoomId,
  removeRoom,
  repairAllRooms,
  repairRoom,
  residentHandiesOnFloor,
  setRoomDecoration,
  setRoomLevel,
  setRoomPower,
  setRoomTheme,
  unassignDweller,
} from '../../src/domain/ops/roomOps.ts';

// Pure room-op tests (Stage C). Structural ops assume the layout validator has approved
// the edit (tested separately in roomLayout.test.ts); here we verify the mutations + the
// room/dweller cross-reference bookkeeping (savedRoom ↔ dwellers[]).

function makeSave(): SaveData {
  return {
    dwellers: {
      dwellers: [
        { serializeId: 10, savedRoom: 100 },
        { serializeId: 11, savedRoom: 101 },
      ],
    },
    vault: {
      rooms: [
        { type: 'Entrance', deserializeID: 99, row: 0, col: 0, level: 3, dwellers: [] },
        {
          type: 'Storage',
          class: 'Facility',
          deserializeID: 100,
          row: 0,
          col: 4,
          level: 2,
          mergeLevel: 1,
          power: true,
          broken: false,
          roomHealth: { damageValue: 120, initialValue: 80 },
          dwellers: [10],
        },
        {
          type: 'Storage',
          class: 'Facility',
          deserializeID: 101,
          row: 0,
          col: 7,
          level: 2,
          mergeLevel: 1,
          dwellers: [11],
        },
      ],
    },
  } as unknown as SaveData;
}

const roomById = (save: SaveData, id: number) =>
  save.vault!.rooms!.find((r) => r.deserializeID === id)!;
const dwellerById = (save: SaveData, id: number) =>
  save.dwellers!.dwellers!.find((d) => d.serializeId === id)!;

describe('value-bounded room ops', () => {
  it('setRoomLevel clamps to [1, maxLevel]', () => {
    expect(roomById(setRoomLevel(makeSave(), 100, 5, 3), 100).level).toBe(3);
    expect(roomById(setRoomLevel(makeSave(), 100, 0, 3), 100).level).toBe(1);
    expect(roomById(setRoomLevel(makeSave(), 100, 3, 3), 100).level).toBe(3);
  });

  it('setRoomLevel is a no-op (same ref) when unchanged', () => {
    const save = makeSave();
    expect(setRoomLevel(save, 100, 2, 3)).toBe(save);
  });

  it('maxRoomLevel raises to the max', () => {
    expect(roomById(maxRoomLevel(makeSave(), 100, 3), 100).level).toBe(3);
  });

  it('repairRoom zeroes damage and clears broken', () => {
    const save = makeSave();
    save.vault!.rooms![1].broken = true;
    const out = roomById(repairRoom(save, 100), 100);
    expect(out.roomHealth?.damageValue).toBe(0);
    expect(out.broken).toBe(false);
  });

  it('repairRoom is a no-op (same ref) on a healthy room', () => {
    const save = makeSave();
    save.vault!.rooms![1].roomHealth = { damageValue: 0, initialValue: 0 };
    save.vault!.rooms![1].broken = false;
    expect(repairRoom(save, 100)).toBe(save);
  });

  it('repairAllRooms repairs every damaged room in one edit', () => {
    const save = makeSave();
    save.vault!.rooms![1].roomHealth = { damageValue: 120, initialValue: 80 };
    save.vault!.rooms![2].broken = true; // room 101 broken but damageValue 0
    const out = repairAllRooms(save);
    expect(roomById(out, 100).roomHealth?.damageValue).toBe(0);
    expect(roomById(out, 100).broken).toBe(false);
    expect(roomById(out, 101).broken).toBe(false);
    expect(roomById(out, 101).roomHealth?.damageValue).toBe(0);
  });

  it('repairAllRooms shares healthy rooms by reference', () => {
    const save = makeSave();
    save.vault!.rooms![2].roomHealth = { damageValue: 0, initialValue: 0 };
    const healthy = save.vault!.rooms![2];
    const out = repairAllRooms(save);
    expect(out.vault!.rooms!.find((r) => r.deserializeID === 101)).toBe(healthy);
  });

  it('repairAllRooms is a no-op (same ref) when nothing is damaged', () => {
    const save = makeSave();
    save.vault!.rooms![1].roomHealth = { damageValue: 0, initialValue: 0 };
    save.vault!.rooms![1].broken = false;
    expect(repairAllRooms(save)).toBe(save);
  });

  it('setRoomPower / setRoomDecoration write through', () => {
    expect(roomById(setRoomPower(makeSave(), 100, false), 100).power).toBe(false);
    expect(roomById(setRoomDecoration(makeSave(), 100, 'Nuka'), 100).assignedDecoration).toBe(
      'Nuka',
    );
  });

  it('throws RoomNotFoundError for an absent id', () => {
    expect(() => setRoomPower(makeSave(), 999, false)).toThrow(RoomNotFoundError);
  });

  it('setRoomTheme writes themeByRoomType + adds the recipe to survivalW.recipes', () => {
    const out = setRoomTheme(makeSave(), 'Cafeteria', 'Institute');
    expect(out.specialTheme?.themeByRoomType?.Cafeteria).toBe('Institute');
    expect(out.survivalW?.recipes).toContain('CafeteriaInstitute');
  });

  it('setRoomTheme uses the irregular exterior recipe id (FakeWasteland → ConcordExterior)', () => {
    const out = setRoomTheme(makeSave(), 'FakeWasteland', 'Concord');
    expect(out.survivalW?.recipes).toContain('ConcordExterior');
  });

  it('setRoomTheme never duplicates an already-known recipe', () => {
    const base = setRoomTheme(makeSave(), 'Cafeteria', 'Institute');
    const again = setRoomTheme(base, 'Cafeteria', 'Institute');
    expect(again).toBe(base); // theme + recipe unchanged → same ref
    // Re-applying after clearing must not add a second copy.
    const cleared = setRoomTheme(base, 'Cafeteria', 'None');
    const reapplied = setRoomTheme(cleared, 'Cafeteria', 'Institute');
    expect(reapplied.survivalW?.recipes?.filter((r) => r === 'CafeteriaInstitute')).toHaveLength(1);
  });

  it('setRoomTheme = None clears the theme and adds no recipe', () => {
    const out = setRoomTheme(makeSave(), 'Cafeteria', 'None');
    expect(out.specialTheme?.themeByRoomType?.Cafeteria).toBe('None');
    expect(out.survivalW?.recipes ?? []).toHaveLength(0);
  });

  it('setRoomTheme preserves existing recipes and other room types', () => {
    const seeded = { ...makeSave(), survivalW: { recipes: ['SomeOtherRecipe'] } };
    const base = setRoomTheme(seeded, 'LivingQuarters', 'Enclave');
    const out = setRoomTheme(base, 'Cafeteria', 'Institute');
    expect(out.specialTheme?.themeByRoomType).toEqual({
      LivingQuarters: 'Enclave',
      Cafeteria: 'Institute',
    });
    expect(out.survivalW?.recipes).toEqual([
      'SomeOtherRecipe',
      'LivingQuartersEnclave',
      'CafeteriaInstitute',
    ]);
  });
});

describe('dweller assignment', () => {
  it('assignDweller moves the dweller and syncs savedRoom', () => {
    const out = assignDweller(makeSave(), 101, 10); // move dweller 10 from room 100 → 101
    expect(roomById(out, 100).dwellers).toEqual([]);
    expect(roomById(out, 101).dwellers).toEqual([11, 10]);
    expect(dwellerById(out, 10).savedRoom).toBe(101);
  });

  it('unassignDweller removes from room and sets savedRoom = -1', () => {
    const out = unassignDweller(makeSave(), 10);
    expect(roomById(out, 100).dwellers).toEqual([]);
    expect(dwellerById(out, 10).savedRoom).toBe(-1);
  });
});

describe('structural room ops', () => {
  it('nextRoomId is max + 1', () => {
    expect(nextRoomId(makeSave())).toBe(102);
  });

  it('addRoom appends a fresh room with defaults + new id', () => {
    const out = addRoom(makeSave(), {
      type: 'Casino',
      class: 'Training',
      row: 1,
      col: 0,
      mergeLevel: 1,
    });
    const room = roomById(out, 102);
    expect(room).toMatchObject({
      type: 'Casino',
      class: 'Training',
      row: 1,
      col: 0,
      level: 1,
      power: true,
      broken: false,
      currentStateName: 'Idle',
      dwellers: [],
    });
    expect(room.roomHealth?.damageValue).toBe(0);
  });

  it('removeRoom drops the room and returns its dwellers to the door', () => {
    const out = removeRoom(makeSave(), 100);
    expect(out.vault!.rooms!.some((r) => r.deserializeID === 100)).toBe(false);
    expect(dwellerById(out, 10).savedRoom).toBe(-1);
  });

  it('removeRoom throws for an absent id', () => {
    expect(() => removeRoom(makeSave(), 999)).toThrow(RoomNotFoundError);
  });

  it('moveRoom updates row/col', () => {
    const out = roomById(moveRoom(makeSave(), 100, 2, 10), 100);
    expect(out).toMatchObject({ row: 2, col: 10 });
  });

  it('moveRoom carries occupants along without touching the dweller cross-reference', () => {
    const save = makeSave();
    const out = moveRoom(save, 100, 2, 10);
    // The room keeps its id + occupant list, and the occupant's savedRoom still points at it
    // - a move must never desync savedRoom ↔ dwellers[].
    expect(roomById(out, 100).dwellers).toEqual([10]);
    expect(dwellerById(out, 10).savedRoom).toBe(100);
    // The dweller block is shared by reference (the move only rewrites rooms) - proof the op
    // doesn't rewrite savedRoom and so cannot introduce desync.
    expect(out.dwellers).toBe(save.dwellers);
  });

  it('moveRoom is a no-op (same ref) when the position is unchanged', () => {
    const save = makeSave();
    expect(moveRoom(save, 100, 0, 4)).toBe(save);
  });

  it('moveRoom throws RoomNotFoundError for an absent id', () => {
    expect(() => moveRoom(makeSave(), 999, 1, 1)).toThrow(RoomNotFoundError);
  });

  it('mergeRoomWith absorbs the neighbour: width + dwellers + leftmost col', () => {
    const out = mergeRoomWith(makeSave(), 100, 101);
    const survivor = roomById(out, 100);
    expect(survivor.mergeLevel).toBe(2);
    expect(survivor.col).toBe(4);
    expect(survivor.dwellers).toEqual([10, 11]);
    expect(out.vault!.rooms!.some((r) => r.deserializeID === 101)).toBe(false);
    expect(dwellerById(out, 11).savedRoom).toBe(100); // re-pointed at survivor
  });
});

describe('Mr. Handy preservation (a robot referenced by no room vanishes in-game)', () => {
  const withHandy = (save: SaveData, roomId: number, ids: number[]): SaveData => {
    for (const r of save.vault!.rooms!) {
      if (r.deserializeID === roomId) (r as { mrHandyList?: number[] }).mrHandyList = ids;
    }
    return save;
  };

  it('removeRoom relocates the room’s Mr. Handies to a same-floor room', () => {
    const out = removeRoom(withHandy(makeSave(), 101, [3]), 101);
    // Room 100 (Storage, same floor 0, non-elevator) adopts id 3.
    expect(roomById(out, 100).mrHandyList).toEqual([3]);
  });

  it('removeRoom falls back to the Entrance when no same-floor room remains', () => {
    const save = withHandy(makeSave(), 101, [3]);
    // Move room 101 to floor 1 so its only same-floor company is gone.
    for (const r of save.vault!.rooms!) if (r.deserializeID === 101) r.row = 1;
    const out = removeRoom(save, 101);
    expect(roomById(out, 99).mrHandyList).toEqual([3]);
  });

  it('mergeRoomWith carries the neighbour’s Mr. Handies onto the survivor', () => {
    const save = withHandy(withHandy(makeSave(), 100, [1]), 101, [2]);
    const out = mergeRoomWith(save, 100, 101);
    expect(roomById(out, 100).mrHandyList).toEqual([1, 2]);
  });

  it('mrHandiesByFloor maps robot ids to their room’s floor', () => {
    const save = withHandy(makeSave(), 100, [3]);
    expect(mrHandiesByFloor(save)).toEqual(new Map([[0, [3]]]));
  });

  it('moveMrHandyToFloor strips the id everywhere and attaches it on the target floor', () => {
    const save = withHandy(makeSave(), 100, [3]);
    // Move room 101 to floor 1 so it is the only adopter there.
    for (const r of save.vault!.rooms!) if (r.deserializeID === 101) r.row = 1;
    const out = moveMrHandyToFloor(save, 3, 1);
    expect(roomById(out, 100).mrHandyList).toEqual([]);
    expect(roomById(out, 101).mrHandyList).toEqual([3]);
    // No adopter on an empty floor: no-op by reference.
    expect(moveMrHandyToFloor(out, 3, 20)).toBe(out);
  });

  // HARD game rule: one Mr. Handy per floor. Moving a room that carries a robot onto a
  // floor that already has one evicts the RESIDENT robot (sent outside the vault, where
  // it waits at the door); the incoming robot wins because the move is the user's intent.
  it('moveRoom evicts the resident robot when the moved room brings one onto its floor', () => {
    const save = withHandy(withHandy(makeSave(), 100, [3]), 101, [4]);
    (save.dwellers as { actors?: unknown[] }).actors = [
      { serializeId: 3, characterType: 2, savedRoom: 100 },
      { serializeId: 4, characterType: 2, savedRoom: 101 },
    ];
    // Room 101 (robot 4) starts on floor 1, then moves onto floor 0 where room 100
    // already holds robot 3.
    for (const r of save.vault!.rooms!) if (r.deserializeID === 101) r.row = 1;
    const out = moveRoom(save, 101, 0, 7);
    expect(roomById(out, 101).mrHandyList).toEqual([4]); // incoming robot stays
    expect(roomById(out, 100).mrHandyList).toEqual([]); // resident evicted
    expect(out.dwellers?.actors?.find((a) => a.serializeId === 3)?.savedRoom).toBe(-1);
    expect(residentHandiesOnFloor(save, 101, 0)).toEqual([3]); // what the UI toast names
  });

  it('moveRoom leaves floor robots alone when the moved room carries none', () => {
    const save = withHandy(makeSave(), 100, [3]);
    for (const r of save.vault!.rooms!) if (r.deserializeID === 101) r.row = 1;
    const out = moveRoom(save, 101, 0, 7);
    expect(roomById(out, 100).mrHandyList).toEqual([3]);
  });
});
