// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import { diagnose, repairAll, type DiagnosisKind } from '../../src/domain/health/diagnostics.ts';

/** A structurally-broken save exercising every diagnosis at once. */
function brokenSave(): SaveData {
  return {
    dwellers: {
      id: 2, // counter behind max serializeId (5)
      dwellers: [
        { serializeId: 1, savedRoom: 10 }, // valid room
        { serializeId: 2, savedRoom: 999 }, // orphaned (no room 999)
        { serializeId: 3, savedRoom: 10 }, // valid room, but room 10 won't list it (desync)
        { serializeId: 3, savedRoom: -1 }, // duplicate id 3
        { serializeId: 5, savedRoom: -1 },
      ],
      // A Mr. Handy (characterType 2) no room's mrHandyList references. This is a VALID
      // state (it waits outside the vault, user-verified in-game) and must NOT be flagged.
      actors: [{ serializeId: 4, characterType: 2, name: 'Mr. Handy' }],
    },
    vault: {
      rooms: [{ type: 'Cafeteria', deserializeID: 10, dwellers: [1, 77] }], // 77 is bogus
      storage: { resources: { Food: -50, Water: 100, Nuka: Number.POSITIVE_INFINITY } },
      LunchBoxesByType: [0, 1, 2],
      LunchBoxesCount: 9, // mismatch (should be 3)
    },
    someUntouchedManager: { a: 1 },
  } as unknown as SaveData;
}

const kinds = (s: SaveData): DiagnosisKind[] => diagnose(s).map((d) => d.kind);

describe('diagnostics - broken roster breakdown', () => {
  it('flags roster entries that reference nonexistent dwellers, in plain english', () => {
    const desync = diagnose(brokenSave()).find((d) => d.kind === 'roomAssignmentDesync');
    // Room 10 lists dweller 77, which does not exist. Dweller 3 having savedRoom 10
    // without being on the roster is NORMAL (visiting/idle) and must NOT be flagged.
    expect(desync?.details).toHaveLength(1);
    expect(desync?.details?.[0]?.text).toContain('Cafeteria #10');
    expect(desync?.details?.[0]?.text).toContain('77');
  });

  it('does not flag rosters listing dwellers who are currently elsewhere (savedRoom -1)', () => {
    // Straight-from-the-game pattern: a room keeps an exploring/idle dweller on its
    // roster while the dweller's savedRoom is -1. Verified against a genuine save.
    const save = {
      dwellers: {
        id: 2,
        dwellers: [
          { serializeId: 1, savedRoom: -1 },
          { serializeId: 2, savedRoom: 10 },
        ],
      },
      vault: {
        rooms: [{ type: 'Storage', deserializeID: 10, dwellers: [1, 2] }],
        storage: { resources: {} },
      },
    } as unknown as SaveData;
    expect(kinds(save)).not.toContain('roomAssignmentDesync');
  });

  it('flags a dweller double-booked onto two rooms, naming them for deep links', () => {
    const save = {
      dwellers: {
        id: 1,
        dwellers: [{ serializeId: 1, name: 'Bob', lastName: 'Smith', savedRoom: 10 }],
      },
      vault: {
        rooms: [
          { type: 'Diner', deserializeID: 10, dwellers: [1] },
          { type: 'Storage', deserializeID: 11, dwellers: [1] },
        ],
        storage: { resources: {} },
      },
    } as unknown as SaveData;
    const desync = diagnose(save).find((d) => d.kind === 'roomAssignmentDesync');
    expect(desync?.details).toHaveLength(1);
    expect(desync?.details?.[0]?.text).toContain('Bob Smith');
    expect(desync?.details?.[0]?.dwellers).toEqual([{ id: 1, name: 'Bob Smith' }]);
    // The repair keeps the room the dweller is actually in (savedRoom 10).
    const fixed = desync!.repair(save);
    expect(fixed.vault?.rooms?.find((r) => r.deserializeID === 10)?.dwellers).toEqual([1]);
    expect(fixed.vault?.rooms?.find((r) => r.deserializeID === 11)?.dwellers).toEqual([]);
  });
});

describe('diagnostics - detection', () => {
  it('detects every malformation in a broken save', () => {
    expect(new Set(kinds(brokenSave()))).toEqual(
      new Set<DiagnosisKind>([
        'orphanedSavedRoom',
        'roomAssignmentDesync',
        'lunchboxCountMismatch',
        'invalidResource',
        'duplicateSerializeId',
        'dwellerIdCounterBehind',
      ]),
    );
  });

  it('reports no issues for a clean save', () => {
    const clean: SaveData = {
      dwellers: {
        id: 2,
        dwellers: [
          { serializeId: 1, savedRoom: 10 },
          { serializeId: 2, savedRoom: -1 },
        ],
      },
      vault: {
        rooms: [{ type: 'Cafeteria', deserializeID: 10, dwellers: [1] }],
        storage: { resources: { Food: 100 } },
        LunchBoxesByType: [0],
        LunchBoxesCount: 1,
      },
    } as unknown as SaveData;
    expect(diagnose(clean)).toHaveLength(0);
  });

  it('carries plain-language detail and an affected count per diagnosis', () => {
    for (const d of diagnose(brokenSave())) {
      expect(d.detail.length).toBeGreaterThan(20);
      expect(d.count).toBeGreaterThan(0);
    }
  });
});

describe('diagnostics - individual repairs', () => {
  it('each repair fixes its own issue without introducing others of its kind', () => {
    const start = brokenSave();
    for (const d of diagnose(start)) {
      const fixed = d.repair(start);
      expect(kinds(fixed)).not.toContain(d.kind);
    }
  });

  it('orphan repair sends the dweller to the door, keeps valid assignments', () => {
    const fixed = diagnose(brokenSave())
      .find((d) => d.kind === 'orphanedSavedRoom')!
      .repair(brokenSave());
    const orphan = fixed.dwellers?.dwellers.find((d) => d.serializeId === 2);
    expect(orphan?.savedRoom).toBe(-1);
    expect(fixed.dwellers?.dwellers.find((d) => d.serializeId === 1)?.savedRoom).toBe(10);
  });

  it('does not flag a Mr. Handy that no room references (it waits outside the vault)', () => {
    // Previously flagged as "orphaned" + auto-reattached; user-verified in-game that an
    // unreferenced robot simply waits at the vault door forever, so it is NOT an error
    // and repairs must leave it alone.
    const repaired = repairAll(brokenSave());
    const lists = (repaired.vault?.rooms ?? []).flatMap((r) => r.mrHandyList ?? []);
    expect(lists).not.toContain(4);
    expect(repaired.dwellers?.actors?.find((a) => a.serializeId === 4)).toBeDefined();
  });
});

describe('diagnostics - repairAll', () => {
  it('produces a save with no remaining structural issues', () => {
    const repaired = repairAll(brokenSave());
    expect(diagnose(repaired)).toHaveLength(0);
  });

  it('removes impossible roster entries (bogus id 77) but keeps real workers', () => {
    const repaired = repairAll(brokenSave());
    const room = repaired.vault?.rooms?.find((r) => r.deserializeID === 10);
    expect(room?.dwellers).not.toContain(77);
    expect(room?.dwellers).toContain(1);
  });

  it('does not mutate the input save', () => {
    const start = brokenSave();
    const json = JSON.stringify(start);
    repairAll(start);
    expect(JSON.stringify(start)).toBe(json);
  });

  it('is a no-op on an already-clean save (returns it unchanged by reference)', () => {
    const clean: SaveData = {
      dwellers: { id: 1, dwellers: [{ serializeId: 1, savedRoom: -1 }] },
      vault: {
        rooms: [],
        storage: { resources: { Food: 1 } },
        LunchBoxesByType: [],
        LunchBoxesCount: 0,
      },
    } as unknown as SaveData;
    expect(repairAll(clean)).toBe(clean);
  });
});
