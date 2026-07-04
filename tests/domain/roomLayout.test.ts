import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  buildLayout,
  reachesEntrance,
  roomCellWidth,
  toNode,
  ELEVATOR_TYPE,
} from '../../src/domain/rooms/layout.ts';
import {
  canBuildRoom,
  canMergeRoom,
  canMoveRoom,
  canRemoveRoom,
  canSetRoomLevel,
  strandedIfRemoved,
  validateLayout,
} from '../../src/domain/rooms/validator.ts';
import {
  baseMergeLevel,
  validBuildOrigins,
  validMoveTargets,
} from '../../src/domain/rooms/placement.ts';

// The validator is the product's highest-corruption-risk component, so it is
// tested both against the REAL Vault1.sav layout (tests/fixtures/vault1-layout.json) and
// against hand-built synthetic layouts that isolate each rule.

interface FixtureRoom {
  type: string;
  deserializeID: number;
  row: number;
  col: number;
  level: number;
  mergeLevel: number;
}
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/vault1-layout.json'), 'utf8'),
) as { rooms: FixtureRoom[]; rocks: { r: number; c: number }[] };

const fixtureSave = {
  vault: { rooms: fixture.rooms, rocks: fixture.rocks },
} as unknown as SaveData;

/** Build a SaveData from a compact room list (+ optional rocks/ultracite) for synthetic tests. */
function saveOf(
  rooms: Array<{
    type: string;
    deserializeID: number;
    row: number;
    col: number;
    mergeLevel?: number;
    level?: number;
  }>,
  rocks: { r: number; c: number }[] = [],
  ultracite: { r: number; c: number }[] = [],
): SaveData {
  return { vault: { rooms, rocks, ultracite } } as unknown as SaveData;
}

// A minimal valid vault: Entrance - Elevator - Storage on floor 0.
const minimalSave = saveOf([
  { type: 'Entrance', deserializeID: 1, row: 0, col: 0, mergeLevel: 1, level: 1 },
  { type: 'Elevator', deserializeID: 2, row: 0, col: 3, mergeLevel: 1, level: 1 },
  { type: 'Storage', deserializeID: 3, row: 0, col: 4, mergeLevel: 1, level: 1 },
]);

describe('layout geometry', () => {
  it('computes footprint width: elevator = 1 cell, room = 3 × mergeLevel', () => {
    expect(roomCellWidth(ELEVATOR_TYPE, 1)).toBe(1);
    expect(roomCellWidth('Storage', 1)).toBe(3);
    expect(roomCellWidth('Storage', 2)).toBe(6);
    expect(roomCellWidth('WeaponFactory', 3)).toBe(9);
  });

  it('always uses the game-fixed 26 × 25 grid (VaultLogic.prefab), never the silhouette', () => {
    const layout = buildLayout(fixtureSave);
    expect(layout.nodes.length).toBe(87);
    expect(layout.cols).toBe(26);
    expect(layout.rows).toBe(25);
    // A young/minimal vault gets the SAME grid. Deriving width from rooms + rocks collapsed
    // the buildable playground (worst after "Remove all rocks"), killing right-edge builds.
    expect(buildLayout(minimalSave).cols).toBe(26);
    expect(buildLayout(minimalSave).rows).toBe(25);
  });

  it('keeps the full grid after rocks are excavated (no playground collapse)', () => {
    // Rocks fill the undug lower floors; excavating them must NOT shrink the buildable grid.
    const withRocks = saveOf(
      [{ type: 'Entrance', deserializeID: 1, row: 0, col: 0 }],
      [{ r: 20, c: 0 }],
    );
    const excavated = saveOf([{ type: 'Entrance', deserializeID: 1, row: 0, col: 0 }], []);
    expect(buildLayout(withRocks).rows).toBe(25);
    expect(buildLayout(excavated).rows).toBe(25);
    expect(buildLayout(excavated).cols).toBe(26);
  });
});

describe('connectivity (reach the entrance)', () => {
  it('accepts the real Vault1.sav layout as fully valid', () => {
    expect(validateLayout(buildLayout(fixtureSave))).toEqual({ ok: true });
  });

  it('every real room can reach the entrance', () => {
    const layout = buildLayout(fixtureSave);
    expect(layout.nodes.every((n) => reachesEntrance(layout.nodes, n))).toBe(true);
  });

  it('flags an overlap', () => {
    const layout = buildLayout(
      saveOf([
        { type: 'Entrance', deserializeID: 1, row: 0, col: 0 },
        { type: 'Storage', deserializeID: 2, row: 0, col: 2 }, // overlaps cell 2
      ]),
    );
    const res = validateLayout(layout);
    expect(res.ok).toBe(false);
  });

  it('flags a room stranded from the entrance', () => {
    // Storage on floor 1 with no elevator linking up = unreachable.
    const layout = buildLayout(
      saveOf(
        [
          { type: 'Entrance', deserializeID: 1, row: 0, col: 0 },
          { type: 'Storage', deserializeID: 2, row: 1, col: 0 },
        ],
        [{ r: 1, c: 5 }], // a rock extends the grid to floor 1
      ),
    );
    expect(validateLayout(layout).ok).toBe(false);
  });
});

describe('canBuildRoom', () => {
  const layout = buildLayout(fixtureSave);

  it('allows filling an empty inter-elevator zone next to a shaft', () => {
    // Floor 4 cols 10–18 are empty dirt; col 9 is an elevator shaft. A room at col 10
    // is left-adjacent to that shaft (which reaches the entrance).
    expect(canBuildRoom(layout, { type: 'Storage', row: 4, col: 10, mergeLevel: 1 })).toEqual({
      ok: true,
    });
  });

  it('allows digging a new elevator below an existing shaft', () => {
    expect(canBuildRoom(layout, { type: ELEVATOR_TYPE, row: 18, col: 9, mergeLevel: 1 })).toEqual({
      ok: true,
    });
  });

  it('blocks a floating room with no path to the entrance', () => {
    const res = canBuildRoom(layout, { type: 'Storage', row: 20, col: 12, mergeLevel: 1 });
    expect(res.ok).toBe(false);
  });

  it('blocks building on an occupied cell', () => {
    const res = canBuildRoom(layout, { type: 'Storage', row: 0, col: 0, mergeLevel: 1 });
    expect(res.ok).toBe(false);
  });

  it('blocks out-of-bounds placement', () => {
    expect(canBuildRoom(layout, { type: 'Storage', row: 99, col: 0, mergeLevel: 1 }).ok).toBe(
      false,
    );
    expect(canBuildRoom(layout, { type: 'Storage', row: 0, col: 24, mergeLevel: 2 }).ok).toBe(
      false,
    );
  });

  it('blocks a gapped (non-flush) position on connectivity, like the game', () => {
    // Floor 4 cols 10–18 are empty; a room at col 11 leaves a 1-cell gap to the col-9 shaft,
    // so no build zone would exist there in-game. It fails because it touches nothing.
    const res = canBuildRoom(layout, { type: 'Storage', row: 4, col: 11, mergeLevel: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/connect/i);
  });

  it('blocks a room overlapping an elevator cell on the same floor', () => {
    // A merge-3 (9-cell) room at col 4 would span cells 4–12, overlapping the col-9 shaft
    // cell on this floor.
    expect(canBuildRoom(layout, { type: 'Storage', row: 4, col: 4, mergeLevel: 3 }).ok).toBe(false);
  });

  it('allows building below a single extended shaft (adjacency, not alignment)', () => {
    // Real report: extend ONLY the right shaft (col 19) into a cleared lower floor. A new
    // room at cols 16–18 touches that elevator, so it must be a legal build.
    const rooms = [
      ...fixture.rooms,
      { type: 'Elevator', deserializeID: 9001, row: 18, col: 19, level: 1, mergeLevel: 1 },
    ];
    const layout = buildLayout({ vault: { rooms, rocks: [] } } as unknown as SaveData);
    expect(validBuildOrigins(layout, 'Storage', 1).has('18,16')).toBe(true);
    // A cell that doesn't touch the shaft must fail on CONNECTIVITY, not alignment.
    const mid = canBuildRoom(layout, { type: 'Storage', row: 18, col: 10, mergeLevel: 1 });
    expect(mid.ok).toBe(false);
    if (!mid.ok) expect(mid.reason).toMatch(/connect/i);
  });

  it('allows building at the right edge of a young vault (fixed-grid regression)', () => {
    // minimalSave's silhouette ends at col 7 (Storage colEnd). With silhouette-derived width
    // this legal flush-right build was blocked with "runs past the vault edge".
    expect(
      canBuildRoom(buildLayout(minimalSave), { type: 'Storage', row: 0, col: 7, mergeLevel: 1 }),
    ).toEqual({
      ok: true,
    });
  });

  it('does not treat an elevator column as a wall on OTHER floors', () => {
    // Elevator at (1,7) exists only on floor 1. On floor 0 a room spanning cols 7–9 is legal
    // (flush right of the floor-0 Storage). The old global-shaft-column rule falsely blocked
    // it with "cannot cross an elevator shaft": the user's "rooms just cannot be added after
    // a lot of modifications" bug.
    const layout = buildLayout(
      saveOf([
        { type: 'Entrance', deserializeID: 1, row: 0, col: 0 },
        { type: 'Elevator', deserializeID: 2, row: 0, col: 3 },
        { type: 'Storage', deserializeID: 3, row: 0, col: 4 },
        { type: 'Elevator', deserializeID: 4, row: 1, col: 3 },
        { type: 'Storage', deserializeID: 5, row: 1, col: 4 },
        { type: 'Elevator', deserializeID: 6, row: 1, col: 7 },
      ]),
    );
    expect(canBuildRoom(layout, { type: 'Storage', row: 0, col: 7, mergeLevel: 1 })).toEqual({
      ok: true,
    });
  });

  it('blocks building on an ultracite deposit cell', () => {
    const layout = buildLayout(
      saveOf(
        [
          { type: 'Entrance', deserializeID: 1, row: 0, col: 0 },
          { type: 'Elevator', deserializeID: 2, row: 0, col: 3 },
        ],
        [],
        [{ r: 0, c: 4 }],
      ),
    );
    const res = canBuildRoom(layout, { type: 'Storage', row: 0, col: 4, mergeLevel: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/ultracite/i);
  });

  it('blocks building on an unexcavated rock cell (excavate first)', () => {
    // Floor 1 next to the down-shaft would be a legal build - except cells 4 and 6 are rock.
    const rocky = buildLayout(
      saveOf(
        [
          { type: 'Entrance', deserializeID: 1, row: 0, col: 0 },
          { type: 'Elevator', deserializeID: 2, row: 0, col: 3 },
          { type: 'Elevator', deserializeID: 3, row: 1, col: 3 },
        ],
        [
          { r: 1, c: 4 },
          { r: 1, c: 6 },
        ],
      ),
    );
    const res = canBuildRoom(rocky, { type: 'Storage', row: 1, col: 4, mergeLevel: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/rock/i);
  });
});

describe('canRemoveRoom', () => {
  it('refuses to remove the entrance', () => {
    const layout = buildLayout(minimalSave);
    expect(canRemoveRoom(layout, 1).ok).toBe(false);
  });

  it('blocks removing an elevator that strands rooms', () => {
    const layout = buildLayout(minimalSave);
    // Removing the elevator (#2) cuts Storage (#3) off from the entrance.
    expect(canRemoveRoom(layout, 2).ok).toBe(false);
  });

  it('allows removing a terminal room', () => {
    const layout = buildLayout(minimalSave);
    expect(canRemoveRoom(layout, 3)).toEqual({ ok: true });
  });
});

describe('canMergeRoom', () => {
  it('merges two adjacent same-type, same-level rooms (≤ 3 total)', () => {
    const layout = buildLayout(
      saveOf([
        { type: 'Entrance', deserializeID: 1, row: 0, col: 0 },
        { type: 'Elevator', deserializeID: 2, row: 0, col: 3 },
        { type: 'Storage', deserializeID: 3, row: 0, col: 4, mergeLevel: 1, level: 1 },
        { type: 'Storage', deserializeID: 4, row: 0, col: 7, mergeLevel: 1, level: 1 },
      ]),
    );
    const res = canMergeRoom(layout, 4);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.neighbourId).toBe(3);
  });

  it('refuses to merge across different types or levels', () => {
    const layout = buildLayout(
      saveOf([
        { type: 'Entrance', deserializeID: 1, row: 0, col: 0 },
        { type: 'Elevator', deserializeID: 2, row: 0, col: 3 },
        { type: 'Storage', deserializeID: 3, row: 0, col: 4, mergeLevel: 1, level: 1 },
        { type: 'Storage', deserializeID: 4, row: 0, col: 7, mergeLevel: 1, level: 2 },
      ]),
    );
    expect(canMergeRoom(layout, 4).ok).toBe(false);
  });
});

describe('canMoveRoom', () => {
  const layout = buildLayout(minimalSave);

  it('keeps a valid in-place move valid', () => {
    expect(canMoveRoom(layout, 3, 0, 4)).toEqual({ ok: true });
  });

  it('blocks a move that strands the moved room', () => {
    // Moving Storage to col 7 leaves it touching only empty cells (the elevator is at col
    // 3), so it can no longer reach the entrance.
    expect(canMoveRoom(layout, 3, 0, 7).ok).toBe(false);
  });

  it('gates an elevator move by the same connectivity rule - blocked when load-bearing', () => {
    // The minimal vault's only elevator (id 2) connects Storage to the Entrance; moving it
    // anywhere strands Storage, so the validator must refuse (elevators are not special-cased).
    expect(canMoveRoom(layout, 2, 0, 5).ok).toBe(false);
  });

  it('permits an elevator move when a redundant shaft keeps every room reachable', () => {
    // Double-shaft vault: the row-1 Storage (id 7) reaches the Entrance through BOTH the
    // col-3 shaft (id 5) and the col-7 shaft (id 6), so id 6 is free to slide to row-1 col-2
    // (where it stays connected via the col-3 elevator) without stranding anything.
    const redundant = buildLayout(
      saveOf([
        { type: 'Entrance', deserializeID: 1, row: 0, col: 0 },
        { type: 'Elevator', deserializeID: 2, row: 0, col: 3 },
        { type: 'Storage', deserializeID: 3, row: 0, col: 4 },
        { type: 'Elevator', deserializeID: 4, row: 0, col: 7 },
        { type: 'Elevator', deserializeID: 5, row: 1, col: 3 },
        { type: 'Elevator', deserializeID: 6, row: 1, col: 7 },
        { type: 'Storage', deserializeID: 7, row: 1, col: 4 },
      ]),
    );
    expect(canMoveRoom(redundant, 6, 1, 2)).toEqual({ ok: true });
  });

  it('blocks moving a room onto an unexcavated rock cell', () => {
    // Storage could slide down beside the shaft, but floor 1 cells 4 and 6 are rock.
    const rocky = buildLayout(
      saveOf(
        [
          { type: 'Entrance', deserializeID: 1, row: 0, col: 0 },
          { type: 'Elevator', deserializeID: 2, row: 0, col: 3 },
          { type: 'Elevator', deserializeID: 3, row: 1, col: 3 },
          { type: 'Storage', deserializeID: 4, row: 0, col: 4, mergeLevel: 1 },
        ],
        [
          { r: 1, c: 4 },
          { r: 1, c: 6 },
        ],
      ),
    );
    const res = canMoveRoom(rocky, 4, 1, 4);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/rock/i);
  });
});

describe('strandedIfRemoved', () => {
  it('names the rooms left unreachable when a load-bearing room is lifted', () => {
    // minimal vault: removing the elevator (#2) cuts Storage (#3) off from the entrance.
    expect(strandedIfRemoved(buildLayout(minimalSave), 2)).toEqual([3]);
  });

  it('returns empty for a terminal room (lifting it strands nothing)', () => {
    expect(strandedIfRemoved(buildLayout(minimalSave), 3)).toEqual([]);
  });
});

describe('FakeWasteland is a locked structural tile', () => {
  // The auto-placed scenery tile (real Vault1.sav: id 2, row 0 col 0) is not a real room:
  // it must never be moved or removed even though it carries normal room geometry.
  const fwLayout = buildLayout(
    saveOf([
      { type: 'FakeWasteland', deserializeID: 1, row: 0, col: 0 },
      { type: 'Entrance', deserializeID: 2, row: 0, col: 3 },
      { type: 'Elevator', deserializeID: 3, row: 0, col: 6 },
      { type: 'Storage', deserializeID: 4, row: 0, col: 7 },
    ]),
  );

  it('refuses to move the wasteland tile', () => {
    const res = canMoveRoom(fwLayout, 1, 1, 7);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/wasteland/i);
  });

  it('offers no move targets for the wasteland tile', () => {
    expect(validMoveTargets(fwLayout, 1).size).toBe(0);
  });

  it('refuses to remove the wasteland tile', () => {
    const res = canRemoveRoom(fwLayout, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/wasteland/i);
  });
});

describe('canSetRoomLevel', () => {
  it('enforces 1..maxLevel', () => {
    expect(canSetRoomLevel(3, 2)).toEqual({ ok: true });
    expect(canSetRoomLevel(3, 0).ok).toBe(false);
    expect(canSetRoomLevel(3, 4).ok).toBe(false);
  });
});

describe('placement helpers', () => {
  it('baseMergeLevel: small rooms = 1, wide rooms = width/3, elevator = 1', () => {
    expect(baseMergeLevel('Storage', 3)).toBe(1);
    expect(baseMergeLevel('Overseer', 6)).toBe(2);
    expect(baseMergeLevel('WeaponFactory', 9)).toBe(3);
    expect(baseMergeLevel(ELEVATOR_TYPE, 1)).toBe(1);
  });

  it('validBuildOrigins returns only validator-approved cells', () => {
    const layout = buildLayout(fixtureSave);
    const origins = validBuildOrigins(layout, 'Storage', 1);
    expect(origins.has('4,10')).toBe(true); // empty zone next to the col-9 shaft
    expect(origins.has('0,0')).toBe(false); // occupied by FakeWasteland
    expect(origins.has('20,12')).toBe(false); // floating, unreachable
    // Every returned origin must independently pass the validator.
    for (const key of origins) {
      const [row, col] = key.split(',').map(Number);
      expect(canBuildRoom(layout, { type: 'Storage', row, col, mergeLevel: 1 }).ok).toBe(true);
    }
  });

  it('validMoveTargets returns exactly the validator-approved drop origins for a room', () => {
    // Two-floor vault sharing the col-3 shaft: the Storage (id 3) can legally sit at its
    // current row-0 col-4 spot, or drop to row-1 col-0 (right-adjacent to the shaft) or
    // row-1 col-4 (left-adjacent to the shaft). Every other cell overlaps, runs off the
    // edge, or would strand the room.
    const twoFloor = buildLayout(
      saveOf([
        { type: 'Entrance', deserializeID: 1, row: 0, col: 0 },
        { type: 'Elevator', deserializeID: 2, row: 0, col: 3 },
        { type: 'Storage', deserializeID: 3, row: 0, col: 4 },
        { type: 'Elevator', deserializeID: 5, row: 1, col: 3 },
      ]),
    );
    const targets = validMoveTargets(twoFloor, 3);
    expect(targets).toEqual(new Set(['0,4', '1,0', '1,4']));
    // Every returned target must independently pass the validator.
    for (const key of targets) {
      const [row, col] = key.split(',').map(Number);
      expect(canMoveRoom(twoFloor, 3, row, col).ok).toBe(true);
    }
  });

  it('validMoveTargets is empty for an id not in the layout', () => {
    expect(validMoveTargets(buildLayout(minimalSave), 999).size).toBe(0);
  });
});

describe('toNode', () => {
  it('projects a room to geometry with defaults', () => {
    const node = toNode({ type: 'Storage', deserializeID: 9, row: 2, col: 6 } as never);
    expect(node).toMatchObject({ row: 2, col: 6, width: 3, colEnd: 9, mergeLevel: 1, level: 1 });
  });
});
