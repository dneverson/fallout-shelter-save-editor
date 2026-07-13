// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  assignMrHandyToRoom,
  createMrHandy,
  deleteMrHandy,
  editMrHandy,
  healMrHandy,
  selectMrHandyRows,
  unassignMrHandy,
} from '../../src/domain/ops/mrHandyOps.ts';

/** Two floors: room 10 on row 0 (hosts robot 5), room 11 on row 1 (free). */
function baseSave(): SaveData {
  return {
    dwellers: {
      id: 7,
      dwellers: [{ serializeId: 3, savedRoom: -1 }],
      actors: [
        {
          characterType: 2,
          serializeId: 5,
          name: 'Robby',
          health: 250,
          death: false,
          savedRoom: 10,
          MrHandyVariantID: 'MrHandy',
        },
        { characterType: 3, serializeId: 6, name: 'Pet actor' },
      ],
    },
    vault: {
      rooms: [
        { type: 'MedBay', deserializeID: 10, row: 0, col: 3, mrHandyList: [5] },
        { type: 'Diner', deserializeID: 11, row: 1, col: 3, mrHandyList: [] },
      ],
    },
  } as unknown as SaveData;
}

describe('selectMrHandyRows', () => {
  it('projects robots with their referencing room, skipping non-handy actors', () => {
    const rows = selectMrHandyRows(baseSave());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      serializeId: 5,
      name: 'Robby',
      variant: 'MrHandy',
      health: 250,
      floor: 0,
      roomId: 10,
      roomLabel: 'MedBay #10',
    });
  });

  it('marks a robot referenced by no room as unassigned (floor null)', () => {
    const save = unassignMrHandy(baseSave(), 5);
    const rows = selectMrHandyRows(save);
    expect(rows[0]?.floor).toBeNull();
    expect(rows[0]?.roomId).toBeNull();
    expect(rows[0]?.inWasteland).toBe(false);
  });

  it('flags a robot listed in a wasteland team as collecting, not at the door', () => {
    const save = unassignMrHandy(baseSave(), 5);
    save.vault!.wasteland = { teams: [{ actors: [5], status: 'Exploring' }] };
    const rows = selectMrHandyRows(save);
    expect(rows[0]?.inWasteland).toBe(true);
    expect(rows[0]?.floor).toBeNull();
  });
});

describe('createMrHandy', () => {
  it('mints a fresh actor past every existing id and bumps the counter', () => {
    const save = createMrHandy(baseSave(), { name: 'Newbot', roomId: 11, health: 500 });
    const rows = selectMrHandyRows(save);
    expect(rows).toHaveLength(2);
    const created = rows.find((r) => r.name === 'Newbot');
    expect(created?.serializeId).toBe(8); // past counter 7
    expect(save.dwellers?.id).toBe(8);
    expect(created?.roomId).toBe(11);
    // Attached actor carries the game's field shape (spot-check the load-bearing ones).
    const actor = save.dwellers?.actors?.find((a) => a.serializeId === 8);
    expect(actor?.characterType).toBe(2);
    expect(actor?.savedRoom).toBe(11);
  });

  it('creates an unassigned robot when no room is given', () => {
    const save = createMrHandy(baseSave(), {});
    const created = selectMrHandyRows(save).find((r) => r.serializeId === 8);
    expect(created?.floor).toBeNull();
  });
});

describe('assign / unassign', () => {
  it('moves a robot between rooms, stripping the old reference', () => {
    const save = assignMrHandyToRoom(baseSave(), 5, 11);
    const rooms = save.vault?.rooms ?? [];
    expect(rooms.find((r) => r.deserializeID === 10)?.mrHandyList).toEqual([]);
    expect(rooms.find((r) => r.deserializeID === 11)?.mrHandyList).toEqual([5]);
    expect(save.dwellers?.actors?.find((a) => a.serializeId === 5)?.savedRoom).toBe(11);
  });

  it('is a no-op for an unknown room', () => {
    const save = baseSave();
    expect(assignMrHandyToRoom(save, 5, 999)).toBe(save);
  });

  it('unassign strips every reference and resets savedRoom', () => {
    const save = unassignMrHandy(baseSave(), 5);
    expect((save.vault?.rooms ?? []).flatMap((r) => r.mrHandyList ?? [])).toEqual([]);
    expect(save.dwellers?.actors?.find((a) => a.serializeId === 5)?.savedRoom).toBe(-1);
  });
});

describe('edit / heal / delete', () => {
  it('edits name and variant', () => {
    const save = editMrHandy(baseSave(), 5, { name: 'Codsworth', variant: 'MrHandyFancy' });
    const row = selectMrHandyRows(save)[0];
    expect(row?.name).toBe('Codsworth');
    expect(row?.variant).toBe('MrHandyFancy');
  });

  it('heals to full and clears death', () => {
    const start = baseSave();
    (start.dwellers!.actors![0] as { death?: boolean }).death = true;
    const save = healMrHandy(start, 5, 500);
    const actor = save.dwellers?.actors?.find((a) => a.serializeId === 5);
    expect(actor?.health).toBe(500);
    expect(actor?.death).toBe(false);
  });

  it('heal is a no-op (same reference) at full health', () => {
    const start = baseSave();
    expect(healMrHandy(start, 5, 250)).toBe(start);
  });

  it('delete removes the actor and every room reference, leaving other actors alone', () => {
    const save = deleteMrHandy(baseSave(), 5);
    expect(selectMrHandyRows(save)).toHaveLength(0);
    expect((save.vault?.rooms ?? []).flatMap((r) => r.mrHandyList ?? [])).toEqual([]);
    expect(save.dwellers?.actors?.some((a) => a.serializeId === 6)).toBe(true);
  });

  it('does not mutate the input save', () => {
    const start = baseSave();
    const json = JSON.stringify(start);
    deleteMrHandy(assignMrHandyToRoom(createMrHandy(start, { roomId: 11 }), 5, 11), 5);
    expect(JSON.stringify(start)).toBe(json);
  });
});
