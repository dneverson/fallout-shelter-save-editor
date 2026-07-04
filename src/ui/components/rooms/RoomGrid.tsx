import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
  displayFloor,
  ELEVATOR_TYPE,
  type Layout,
  type RoomNode,
} from '../../../domain/rooms/layout.ts';
import type { RecommendationSeverity } from '../../../domain/selectors/advisorSelectors.ts';
import { CELL_H, CELL_W, cellFromClient, roomClassStyle } from './roomVisuals.ts';

/** An alert-triangle's color by advisory severity (top-right room badge). */
const ADVISORY_TRIANGLE: Record<RecommendationSeverity, string> = {
  high: 'fill-red-400',
  medium: 'fill-amber-400',
  low: 'fill-neutral-300',
};

// The vault floor grid: rooms as blocks positioned by (row, col) with merge
// width, elevators as shafts, rocks as excavatable dirt. Click-select + drag-to-rearrange
// (UX-G): a room can be dragged to any validator-approved empty span; its dwellers come along
// because the move keeps the room's deserializeID. In build mode the grid overlays the
// validator's approved drop cells; clicking one places the room there.

/** Below this pointer travel (px) a press is a click-select, not a drag. */
const DRAG_THRESHOLD = 5;
const clampN = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

interface DragState {
  id: number;
  /** Footprint width in cells of the dragged room. */
  width: number;
  /** Pointer cell minus room origin at grab time, so the room stays under the cursor. */
  grabRow: number;
  grabCol: number;
  /** Validator-approved drop origins ("row,col") for this room. */
  targets: ReadonlySet<string>;
  /** Current snapped drop origin. */
  dropRow: number;
  dropCol: number;
  /** Whether the current drop origin is a legal target. */
  legal: boolean;
  /** Whether this room may be deleted (validator-approved at grab time). */
  deletable: boolean;
  /** Whether the pointer is currently over the trash drop zone. */
  overTrash: boolean;
  /** Whether the (deferred) validator sweep for `targets` has completed. Until then the drag
   *  is live but legal-target highlights/legality are pending - keeps grab start instant. */
  targetsReady: boolean;
}

interface PendingPress {
  id: number;
  node: RoomNode;
  startX: number;
  startY: number;
}

/** A pressed (not yet dragged) Mr. Handy chip - rail or outside zone. */
interface HandyPress {
  id: number;
  startX: number;
  startY: number;
}

/** An in-flight Mr. Handy drag: the chip follows the cursor as a ghost. */
interface HandyDragState {
  id: number;
  x: number;
  y: number;
}

/** A pressed (not yet dragged) rock / ultracite cell. */
interface TerrainPress {
  kind: 'rock' | 'ultracite';
  row: number;
  col: number;
  startX: number;
  startY: number;
}

/** An in-flight rock / ultracite drag-to-move, mirroring the room drag's snap ghost. */
interface TerrainDragState {
  kind: 'rock' | 'ultracite';
  fromRow: number;
  fromCol: number;
  /** Empty cells ("row,col") the piece may move to (computed once at grab). */
  targets: ReadonlySet<string>;
  dropRow: number;
  dropCol: number;
  legal: boolean;
}

interface RoomGridProps {
  layout: Layout;
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Click on empty (non-room) grid space - deselects and closes the side panel. */
  onDeselect?: () => void;
  labelOf: (type: string) => string;
  maxDwellersOf: (node: RoomNode) => number;
  /** Whether a room needs repair - drives the corner wrench badge. */
  needsRepair?: (node: RoomNode) => boolean;
  /** Whether a room is in an active emergency - drives the corner fire badge. */
  inEmergency?: (node: RoomNode) => boolean;
  /** Advisor recommendation for a room (severity + summary) - drives the corner alert
   *  triangle. Returns null when the room has no outstanding advisory. */
  roomAdvisory?: (node: RoomNode) => { severity: RecommendationSeverity; title: string } | null;
  /** Build mode when set: the validator-approved origin cells ("row,col"). */
  buildOrigins?: ReadonlySet<string> | null;
  /** Footprint width (cells) of the room being placed, for the highlight span. */
  buildWidth?: number;
  onPlace?: (row: number, col: number) => void;
  /** Excavate a single rock cell (the per-rock click). Disabled in build mode. */
  onExcavateRock?: (row: number, col: number) => void;
  /** Remove a single ultracite-deposit cell. Disabled in build mode. */
  onRemoveUltracite?: (row: number, col: number) => void;
  /** Terrain-edit mode: when set, empty cells become click targets that place this. */
  terrainMode?: 'rock' | 'ultracite' | null;
  /** Place the active terrain at (row, col) (terrain mode only). */
  onPlaceTerrain?: (row: number, col: number) => void;
  /** Whether a room can be dragged/moved (the fixed Entrance is not). */
  canMove?: (node: RoomNode) => boolean;
  /** Validator-approved drop origins ("row,col") for moving the given room id. */
  moveTargetsFor?: (id: number) => ReadonlySet<string>;
  /** Commit a move: place room `id` at (row, col). Both drag-drop and move-mode use this. */
  onMoveRoom?: (id: number, row: number, col: number) => void;
  /** Validator's reason a drop of room `id` at (row, col) is illegal - drives the live drag
   *  feedback banner. Returns null when the cell is a legal target. */
  moveBlockReason?: (id: number, row: number, col: number) => string | null;
  /** Whether a room may be deleted (gates the drag-to-trash drop). */
  canRemove?: (node: RoomNode) => boolean;
  /** Request deletion of room `id` (dragged onto the trash zone). Caller confirms. */
  onDeleteRoom?: (id: number) => void;
  /** Keyboard/non-drag move mode: render this room's drop targets as clickable cells. */
  moveModeId?: number | null;
  /** Shared ref to the positioned grid container, so the parent can map client coords to
   *  cells for the palette drag-to-build. Falls back to an internal ref when omitted. */
  gridRef?: RefObject<HTMLDivElement | null>;
  /** Palette drag-to-build snap-ghost: where the dragged room would land, and if it's legal. */
  buildGhost?: { row: number; col: number; legal: boolean } | null;
  /** Mr. Handy rail: one slot per floor on the RIGHT of the playground. `handy` = the robot
   *  on that floor (max ONE per floor, the game rule); `eligible` = an armed/dragged robot
   *  may move here. */
  handyRail?: ReadonlyArray<{
    row: number;
    handy?: { id: number; name: string };
    eligible: boolean;
  }>;
  /** The picked-up (armed) Mr. Handy id, highlighted in the rail. */
  armedHandyId?: number | null;
  /** Click a rail slot (arm/disarm a robot, or drop the armed one on an eligible floor). */
  onHandySlotClick?: (row: number) => void;
  /** UNASSIGNED robots waiting outside the vault, shown in a zone on the LEFT of the
   *  playground (outside it), expanding outward (leftward) away from the vault. */
  outsideHandies?: ReadonlyArray<{ id: number; name: string }>;
  /** The wasteland/surface row the outside robots line up with (vertical position). */
  outsideRow?: number;
  /** Arm/disarm an outside robot (then click an eligible floor on the rail to place). */
  onOutsideHandyClick?: (id: number) => void;
  /** Send the armed PLACED robot outside the vault (the dashed drop slot on the left). */
  onSendArmedOutside?: () => void;
  /** Whether the armed robot is currently placed on a floor (enables the outside drop slot). */
  armedHandyIsPlaced?: boolean;
  /** A robot drag began (parent arms it so eligible floors light up). */
  onHandyDragStart?: (id: number) => void;
  /** A robot drag ended on the given target ('none' = cancelled; parent disarms). */
  onHandyDrop?: (
    id: number,
    target: { type: 'floor'; row: number } | { type: 'outside' } | { type: 'none' },
  ) => void;
  /** Move a rock / ultracite deposit to another empty cell (drag-to-move, like rooms). */
  onMoveTerrain?: (
    kind: 'rock' | 'ultracite',
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number,
  ) => void;
}

export function RoomGrid({
  layout,
  selectedId,
  onSelect,
  onDeselect,
  labelOf,
  maxDwellersOf,
  needsRepair,
  inEmergency,
  roomAdvisory,
  buildOrigins = null,
  buildWidth = 3,
  onPlace,
  onExcavateRock,
  onRemoveUltracite,
  terrainMode = null,
  onPlaceTerrain,
  canMove,
  moveTargetsFor,
  onMoveRoom,
  moveBlockReason,
  canRemove,
  onDeleteRoom,
  moveModeId = null,
  gridRef: externalGridRef,
  buildGhost = null,
  handyRail,
  armedHandyId = null,
  onHandySlotClick,
  outsideHandies,
  outsideRow = 0,
  onOutsideHandyClick,
  onSendArmedOutside,
  armedHandyIsPlaced = false,
  onHandyDragStart,
  onHandyDrop,
  onMoveTerrain,
}: RoomGridProps) {
  const buildMode = buildOrigins !== null;

  const internalGridRef = useRef<HTMLDivElement>(null);
  const gridRef = externalGridRef ?? internalGridRef;
  const trashRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<PendingPress | null>(null);
  // Pending deferred validMoveTargets sweep (see onRoomPointerMove). Cleared on drop.
  const deferRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True for the click that immediately follows a drag, so it doesn't also select.
  const draggedRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);

  // --- Mr. Handy drag-and-drop (works alongside click-to-arm) ---------------------------
  const handyPressRef = useRef<HandyPress | null>(null);
  const handyDraggedRef = useRef(false);
  const [handyDrag, setHandyDrag] = useState<HandyDragState | null>(null);

  const onHandyPointerDown = (e: ReactPointerEvent, id: number): void => {
    if (buildMode || e.button !== 0 || !onHandyDrop) return;
    handyPressRef.current = { id, startX: e.clientX, startY: e.clientY };
    handyDraggedRef.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* environments without pointer capture (e.g. jsdom) - drag still tracks via events */
    }
  };

  const onHandyPointerMove = (e: ReactPointerEvent): void => {
    const press = handyPressRef.current;
    if (!press) return;
    if (!handyDrag) {
      if (Math.hypot(e.clientX - press.startX, e.clientY - press.startY) < DRAG_THRESHOLD) return;
      handyDraggedRef.current = true;
      // Arming on drag start makes the eligible floors light up, like the click flow.
      onHandyDragStart?.(press.id);
    }
    setHandyDrag({ id: press.id, x: e.clientX, y: e.clientY });
  };

  const endHandyDrag = (e: ReactPointerEvent): void => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const press = handyPressRef.current;
    handyPressRef.current = null;
    if (!press || !handyDrag) return; // sub-threshold: the trailing click arms/disarms
    setHandyDrag(null);
    // The ghost is pointer-events-none, so the element under the cursor is the drop target.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const floorEl = el?.closest('[data-handy-floor]') as HTMLElement | null;
    const row = floorEl ? Number(floorEl.dataset['handyFloor']) : null;
    const slot =
      row !== null && Number.isFinite(row) ? handyRail?.find((s) => s.row === row) : undefined;
    if (slot && slot.handy?.id !== press.id && slot.eligible) {
      onHandyDrop?.(press.id, { type: 'floor', row: slot.row });
    } else if (el?.closest('[data-handy-outside]')) {
      onHandyDrop?.(press.id, { type: 'outside' });
    } else {
      onHandyDrop?.(press.id, { type: 'none' });
    }
  };

  /** Runs a chip's click action unless the click is the tail end of a drag. */
  const onHandyChipClick = (action: () => void): void => {
    if (handyDraggedRef.current) {
      handyDraggedRef.current = false;
      return;
    }
    action();
  };

  // --- Rock / ultracite drag-to-move (like rooms; click still excavates/removes) --------
  const terrainPressRef = useRef<TerrainPress | null>(null);
  const terrainDraggedRef = useRef(false);
  const [terrainDrag, setTerrainDrag] = useState<TerrainDragState | null>(null);

  /** Empty below-surface cells a terrain piece may occupy (same rule as terrain-edit mode). */
  const freeTerrainCells = (): Set<string> => {
    const occupied = new Set<string>([...layout.rocks, ...layout.ultracite]);
    for (const n of layout.nodes) {
      for (let c = n.col; c < n.colEnd; c++) occupied.add(`${n.row},${c}`);
    }
    const free = new Set<string>();
    for (let r = 1; r < layout.rows; r++) {
      for (let c = 0; c < layout.cols; c++) {
        const key = `${r},${c}`;
        if (!occupied.has(key)) free.add(key);
      }
    }
    return free;
  };

  const onTerrainPointerDown = (
    e: ReactPointerEvent,
    kind: 'rock' | 'ultracite',
    row: number,
    col: number,
  ): void => {
    if (buildMode || e.button !== 0 || !onMoveTerrain) return;
    terrainPressRef.current = { kind, row, col, startX: e.clientX, startY: e.clientY };
    terrainDraggedRef.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* environments without pointer capture (e.g. jsdom) - drag still tracks via events */
    }
  };

  const onTerrainPointerMove = (e: ReactPointerEvent): void => {
    const press = terrainPressRef.current;
    if (!press) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cell = cellFromClient(rect, e.clientX, e.clientY);
    const dropRow = clampN(cell.row, 0, layout.rows - 1);
    const dropCol = clampN(cell.col, 0, layout.cols - 1);
    if (!terrainDrag) {
      if (Math.hypot(e.clientX - press.startX, e.clientY - press.startY) < DRAG_THRESHOLD) return;
      terrainDraggedRef.current = true;
      const targets = freeTerrainCells();
      setTerrainDrag({
        kind: press.kind,
        fromRow: press.row,
        fromCol: press.col,
        targets,
        dropRow,
        dropCol,
        legal: targets.has(`${dropRow},${dropCol}`),
      });
      return;
    }
    setTerrainDrag((prev) =>
      prev ? { ...prev, dropRow, dropCol, legal: prev.targets.has(`${dropRow},${dropCol}`) } : prev,
    );
  };

  const endTerrainDrag = (e: ReactPointerEvent): void => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    terrainPressRef.current = null;
    if (!terrainDrag) return; // sub-threshold: the trailing click excavates/removes
    if (terrainDrag.legal) {
      onMoveTerrain?.(
        terrainDrag.kind,
        terrainDrag.fromRow,
        terrainDrag.fromCol,
        terrainDrag.dropRow,
        terrainDrag.dropCol,
      );
    }
    setTerrainDrag(null);
  };

  /** Runs a terrain cell's click action unless the click is the tail end of a drag. */
  const onTerrainClick = (action: () => void): void => {
    if (terrainDraggedRef.current) {
      terrainDraggedRef.current = false;
      return;
    }
    action();
  };

  // Keyboard move-mode targets (the selected room's legal drops, minus its current cell).
  const moveNode = moveModeId !== null ? (layout.byId.get(moveModeId) ?? null) : null;
  const moveTargets =
    moveNode && !buildMode
      ? [...(moveTargetsFor?.(moveNode.deserializeID) ?? [])].filter(
          (key) => key !== `${moveNode.row},${moveNode.col}`,
        )
      : [];

  // True when the pointer is over the (drag-only) trash drop zone. The room owns the pointer
  // capture, so the trash zone can't get its own events - we hit-test its rect instead.
  const isOverTrash = (clientX: number, clientY: number): boolean => {
    const t = trashRef.current?.getBoundingClientRect();
    return (
      !!t && clientX >= t.left && clientX <= t.right && clientY >= t.top && clientY <= t.bottom
    );
  };

  const onRoomPointerDown = (e: ReactPointerEvent, node: RoomNode): void => {
    if (buildMode || e.button !== 0 || !(canMove?.(node) ?? false)) return;
    pressRef.current = { id: node.deserializeID, node, startX: e.clientX, startY: e.clientY };
    draggedRef.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* environments without pointer capture (e.g. jsdom) - drag still tracks via events */
    }
  };

  const onRoomPointerMove = (e: ReactPointerEvent, node: RoomNode): void => {
    const press = pressRef.current;
    if (!press || press.id !== node.deserializeID) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (!drag) {
      if (Math.hypot(e.clientX - press.startX, e.clientY - press.startY) < DRAG_THRESHOLD) return;
      // Anchor the grab offset to where the user PRESSED on the room (press.startX/Y), not the
      // current pointer. Pointer moves are coalesced, so a fast flick delivers a first move
      // already far from the room; using it would bake that distance into grabRow/grabCol and
      // offset the ghost for the whole drag - the "gap grows the faster you drag" bug.
      const grab = cellFromClient(rect, press.startX, press.startY);
      const cell = cellFromClient(rect, e.clientX, e.clientY);
      const grabRow = grab.row - node.row;
      const grabCol = grab.col - node.col;
      const dropRow = clampN(cell.row - grabRow, 0, layout.rows - 1);
      const dropCol = clampN(cell.col - grabCol, 0, Math.max(0, layout.cols - node.width));
      const id = node.deserializeID;
      draggedRef.current = true;
      // NOTE: selection happens on RELEASE (endDrag), not here. Selecting at drag start
      // opened the side panel mid-drag, which on phones covered the grid and blocked the
      // drop the user was in the middle of.
      // Start the drag INSTANTLY: the room follows the cursor and the trash zone appears now.
      // The validator sweep (validMoveTargets) costs ~15ms on a full vault, so running it here
      // stalled grab start (the past "froze drag start" issue). Defer it to a macrotask so the
      // grab paints first; legal-target highlights fill in a frame later.
      setDrag({
        id,
        width: node.width,
        grabRow,
        grabCol,
        targets: new Set<string>(),
        dropRow,
        dropCol,
        legal: false,
        deletable: canRemove?.(node) ?? false,
        overTrash: false, // the trash zone isn't rendered until the drag exists
        targetsReady: false,
      });
      if (deferRef.current !== null) clearTimeout(deferRef.current);
      deferRef.current = setTimeout(() => {
        deferRef.current = null;
        const targets = moveTargetsFor?.(id) ?? new Set<string>();
        setDrag((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                targets,
                targetsReady: true,
                legal: targets.has(`${prev.dropRow},${prev.dropCol}`),
              }
            : prev,
        );
      }, 0);
      return;
    }
    const cell = cellFromClient(rect, e.clientX, e.clientY);
    const overTrash = isOverTrash(e.clientX, e.clientY);
    // Functional update: the legal-target sweep lands asynchronously (setTimeout above) via its
    // own setDrag. Writing from the captured `drag` here would clobber those freshly-populated
    // targets back to empty - and since the sweep runs only once per drag, they'd never come
    // back, killing the legal-cell highlights + green snap-ghost. Build on `prev` instead.
    setDrag((prev) => {
      if (!prev) return prev;
      const dropRow = clampN(cell.row - prev.grabRow, 0, layout.rows - 1);
      const dropCol = clampN(cell.col - prev.grabCol, 0, Math.max(0, layout.cols - prev.width));
      return {
        ...prev,
        dropRow,
        dropCol,
        legal: prev.targets.has(`${dropRow},${dropCol}`),
        overTrash,
      };
    });
  };

  const endDrag = (e: ReactPointerEvent, node: RoomNode): void => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    pressRef.current = null;
    if (deferRef.current !== null) {
      clearTimeout(deferRef.current);
      deferRef.current = null;
    }
    if (!drag) return;
    if (drag.overTrash) {
      // Dropped on the trash: request deletion (the caller confirms). Non-deletable rooms
      // (would strand others) just snap back - the zone showed the "can't delete" state.
      if (drag.deletable) onDeleteRoom?.(drag.id);
    } else {
      if (drag.dropRow !== node.row || drag.dropCol !== node.col) {
        // A very fast grab-and-drop can release before the deferred sweep ran; resolve legality
        // synchronously in that case so the move still commits (correctness over the 15ms saved).
        const targets = drag.targetsReady
          ? drag.targets
          : (moveTargetsFor?.(drag.id) ?? new Set<string>());
        if (targets.has(`${drag.dropRow},${drag.dropCol}`)) {
          onMoveRoom?.(drag.id, drag.dropRow, drag.dropCol);
        }
      }
      // Select on RELEASE (the post-drag click is swallowed): the side panel opens only once
      // the user lets go, so it can't cover the grid mid-drag on small screens.
      if (drag.id !== selectedId) onSelect(drag.id);
    }
    setDrag(null); // illegal / unmoved → snap back (no-op)
  };

  const onRoomClick = (node: RoomNode): void => {
    if (draggedRef.current) {
      draggedRef.current = false; // swallow the post-drag click
      return;
    }
    onSelect(node.deserializeID);
  };

  // Live drag feedback: when the snapped drop cell is illegal (and not over the trash), ask the
  // validator WHY so the banner can explain it ("contains rock", "crosses an elevator shaft",
  // "would cut a room off"). Skipped while the target sweep is still pending (no red flash) and
  // when legal. One O(n) validator call per render during an illegal hover - cheap.
  const dragReason =
    drag && drag.targetsReady && !drag.legal && !drag.overTrash
      ? (moveBlockReason?.(drag.id, drag.dropRow, drag.dropCol) ?? null)
      : null;

  return (
    // `isolate` contains every internal z-index (selected-room glow, drag ghosts, banners)
    // in this component's own stacking context, so a selected room can never paint above
    // the side panel or modal dialogs.
    <div
      className="relative isolate min-h-0 flex-1"
      // Clicking empty grid space (not a room/rock/drop cell - all <button>s) deselects the
      // current room and closes the side panel. Skipped in build mode, where a click outside a
      // tile is handled by RoomsView's exit-build logic instead.
      onClick={(e) => {
        if (buildMode || selectedId === null) return;
        if ((e.target as HTMLElement).closest('button')) return;
        onDeselect?.();
      }}
    >
      <div className="h-full overflow-auto rounded border border-neutral-800 bg-neutral-950 p-3">
        <div className="flex items-start gap-2">
          {/* OUTSIDE zone, LEFT of the playground (external to it): robots waiting outside
              the vault line up with the surface/wasteland row and expand OUTWARD (leftward,
              away from the vault). Click a chip to arm it (or drag it) onto an eligible
              floor slot on the right rail. While a PLACED robot is armed/dragged, a dashed
              drop slot appears here to send it back outside. */}
          {(() => {
            const chips = outsideHandies ?? [];
            const showOutsideDrop =
              !!onSendArmedOutside && armedHandyId !== null && armedHandyIsPlaced;
            const zoneCells = chips.length + (showOutsideDrop ? 1 : 0);
            if (zoneCells === 0) return null;
            return (
              <div
                data-handy-outside=""
                aria-label="Robots waiting outside the vault"
                className="relative shrink-0"
                style={{ width: zoneCells * CELL_W, height: layout.rows * CELL_H }}
              >
                {showOutsideDrop && (
                  <button
                    type="button"
                    aria-label="Send the selected Mr. Handy outside the vault"
                    title="Drop here: send the robot outside the vault (it waits at the door)"
                    onClick={() => onHandyChipClick(() => onSendArmedOutside?.())}
                    className="absolute flex items-center justify-center rounded-sm border border-dashed border-sky-400/70 bg-sky-500/10 text-sm leading-none hover:bg-sky-500/30"
                    style={{
                      right: chips.length * CELL_W,
                      top: outsideRow * CELL_H,
                      width: CELL_W,
                      height: CELL_H,
                    }}
                  />
                )}
                {chips.map((h, i) => {
                  const armed = h.id === armedHandyId;
                  return (
                    <button
                      key={`outside-handy-${h.id}`}
                      type="button"
                      aria-label={`${h.name} waiting outside the vault${armed ? ' (selected)' : ''}`}
                      title={`${h.name} (waiting outside) - drag it onto a floor slot, or click to ${armed ? 'cancel' : 'pick it up'}`}
                      onClick={() => onHandyChipClick(() => onOutsideHandyClick?.(h.id))}
                      onPointerDown={(e) => onHandyPointerDown(e, h.id)}
                      onPointerMove={onHandyPointerMove}
                      onPointerUp={endHandyDrag}
                      onPointerCancel={endHandyDrag}
                      className={`absolute flex touch-none items-center justify-center rounded-sm border text-sm leading-none ${
                        handyDrag?.id === h.id ? 'opacity-30' : ''
                      } ${
                        armed
                          ? 'border-amber-400 bg-amber-500/25'
                          : 'border-neutral-700 bg-neutral-900 hover:border-amber-500/70'
                      }`}
                      style={{
                        right: i * CELL_W,
                        top: outsideRow * CELL_H,
                        width: CELL_W,
                        height: CELL_H,
                      }}
                    >
                      🤖
                    </button>
                  );
                })}
              </div>
            );
          })()}

          <div
            ref={gridRef}
            className="relative"
            style={{
              width: layout.cols * CELL_W,
              height: layout.rows * CELL_H,
              // Faint cell grid spanning the FULL playground (cols × MAX_FLOORS) so the buildable
              // area reads at a glance, even on empty/undug floors with no rooms or rocks yet.
              backgroundImage:
                'linear-gradient(to right, rgba(148,163,184,0.08) 1px, transparent 1px), ' +
                'linear-gradient(to bottom, rgba(148,163,184,0.08) 1px, transparent 1px)',
              backgroundSize: `${CELL_W}px ${CELL_H}px`,
            }}
          >
            {/* Dirt / rock cells - click to excavate, or drag to MOVE the rock to another
                empty cell (like rooms). Disabled in build mode. */}
            {[...layout.rocks].map((key) => {
              const [r, c] = key.split(',').map(Number);
              const dragging =
                terrainDrag?.kind === 'rock' &&
                terrainDrag.fromRow === r &&
                terrainDrag.fromCol === c;
              return (
                <button
                  key={`rock-${key}`}
                  type="button"
                  data-terrain-cell=""
                  disabled={buildMode}
                  aria-label={`Excavate rock at floor ${displayFloor(r)}, column ${c}`}
                  title="Click to excavate, drag to move"
                  onClick={() => onTerrainClick(() => onExcavateRock?.(r, c))}
                  onPointerDown={(e) => onTerrainPointerDown(e, 'rock', r, c)}
                  onPointerMove={onTerrainPointerMove}
                  onPointerUp={endTerrainDrag}
                  onPointerCancel={endTerrainDrag}
                  className={`group absolute flex items-center justify-center rounded-sm bg-neutral-900 ${
                    dragging ? 'opacity-30' : ''
                  } ${
                    buildMode
                      ? 'pointer-events-none'
                      : 'cursor-grab touch-none hover:bg-amber-900/40 hover:ring-1 hover:ring-amber-600/70 active:cursor-grabbing'
                  }`}
                  style={{ left: c * CELL_W, top: r * CELL_H, width: CELL_W, height: CELL_H }}
                >
                  <span className="text-[10px] text-amber-300/0 group-hover:text-amber-300/90">
                    ⛏
                  </span>
                </button>
              );
            })}

            {/* Ultracite-deposit cells - block builds like rock; click to remove, drag to move. */}
            {[...layout.ultracite].map((key) => {
              const [r, c] = key.split(',').map(Number);
              const dragging =
                terrainDrag?.kind === 'ultracite' &&
                terrainDrag.fromRow === r &&
                terrainDrag.fromCol === c;
              return (
                <button
                  key={`ultracite-${key}`}
                  type="button"
                  data-terrain-cell=""
                  disabled={buildMode}
                  aria-label={`Remove ultracite deposit at floor ${displayFloor(r)}, column ${c}`}
                  title="Ultracite deposit - click to remove, drag to move"
                  onClick={() => onTerrainClick(() => onRemoveUltracite?.(r, c))}
                  onPointerDown={(e) => onTerrainPointerDown(e, 'ultracite', r, c)}
                  onPointerMove={onTerrainPointerMove}
                  onPointerUp={endTerrainDrag}
                  onPointerCancel={endTerrainDrag}
                  className={`group absolute flex items-center justify-center rounded-sm bg-fuchsia-950/70 ring-1 ring-inset ring-fuchsia-700/40 ${
                    dragging ? 'opacity-30' : ''
                  } ${
                    buildMode
                      ? 'pointer-events-none'
                      : 'cursor-grab touch-none hover:bg-fuchsia-900/60 hover:ring-fuchsia-500/70 active:cursor-grabbing'
                  }`}
                  style={{ left: c * CELL_W, top: r * CELL_H, width: CELL_W, height: CELL_H }}
                >
                  <span className="text-[10px] text-fuchsia-300/80">◆</span>
                </button>
              );
            })}

            {/* Terrain-edit mode: every empty cell below the surface is a placement target. */}
            {terrainMode &&
              !buildMode &&
              (() => {
                const occupied = new Set<string>([...layout.rocks, ...layout.ultracite]);
                for (const n of layout.nodes) {
                  for (let c = n.col; c < n.colEnd; c++) occupied.add(`${n.row},${c}`);
                }
                const cells = [];
                for (let r = 1; r < layout.rows; r++) {
                  for (let c = 0; c < layout.cols; c++) {
                    const key = `${r},${c}`;
                    if (occupied.has(key)) continue;
                    cells.push(
                      <button
                        key={`terrain-${key}`}
                        type="button"
                        data-terrain-cell=""
                        aria-label={`Place ${terrainMode} at floor ${displayFloor(r)}, column ${c}`}
                        onClick={() => onPlaceTerrain?.(r, c)}
                        className={`absolute rounded-sm border border-dashed ${
                          terrainMode === 'rock'
                            ? 'border-amber-600/50 hover:bg-amber-900/50'
                            : 'border-fuchsia-600/50 hover:bg-fuchsia-900/50'
                        }`}
                        style={{ left: c * CELL_W, top: r * CELL_H, width: CELL_W, height: CELL_H }}
                      />,
                    );
                  }
                }
                return cells;
              })()}

            {/* Build-mode drop targets */}
            {buildMode &&
              [...buildOrigins].map((key) => {
                const [r, c] = key.split(',').map(Number);
                return (
                  <button
                    key={`drop-${key}`}
                    type="button"
                    data-drop-cell=""
                    aria-label={`Build at floor ${displayFloor(r)}, column ${c}`}
                    onClick={() => onPlace?.(r, c)}
                    className="absolute rounded-sm border border-dashed border-emerald-500/80 bg-emerald-500/15 hover:bg-emerald-500/35"
                    style={{
                      left: c * CELL_W,
                      top: r * CELL_H,
                      width: buildWidth * CELL_W,
                      height: CELL_H,
                    }}
                  />
                );
              })}

            {/* Rooms */}
            {layout.nodes.map((node) => {
              const isElevator = node.type === ELEVATOR_TYPE;
              const selected = node.deserializeID === selectedId;
              const dragging = drag?.id === node.deserializeID;
              const draggable = !buildMode && (canMove?.(node) ?? false);
              const max = maxDwellersOf(node);
              const occ = node.room.dwellers?.length ?? 0;
              const damaged = !isElevator && (needsRepair?.(node) ?? false);
              const emergency = !isElevator && (inEmergency?.(node) ?? false);
              const advisory = isElevator ? null : (roomAdvisory?.(node) ?? null);
              return (
                <button
                  key={node.deserializeID}
                  type="button"
                  data-room-tile=""
                  aria-current={selected ? 'true' : undefined}
                  aria-label={`${labelOf(node.type)} floor ${displayFloor(node.row)}${
                    isElevator ? '' : ` level ${node.level}`
                  }${damaged ? ' - needs repair' : ''}${emergency ? ' - emergency' : ''}${
                    advisory ? ` - advisory: ${advisory.title}` : ''
                  }`}
                  onClick={() => onRoomClick(node)}
                  onPointerDown={(e) => onRoomPointerDown(e, node)}
                  onPointerMove={(e) => onRoomPointerMove(e, node)}
                  onPointerUp={(e) => endDrag(e, node)}
                  onPointerCancel={(e) => endDrag(e, node)}
                  className={`absolute flex flex-col items-center justify-center overflow-hidden rounded-sm border text-center ${roomClassStyle(
                    node.type === ELEVATOR_TYPE ? 'Elevator' : node.room.class,
                  )} ${
                    selected
                      ? 'z-20 outline outline-[3px] outline-amber-300 brightness-125 ring-2 ring-amber-300/60 shadow-lg shadow-amber-500/40'
                      : ''
                  } ${dragging ? 'opacity-30' : ''} ${
                    buildMode
                      ? // Dimmed but still clickable: a click on an already-built room exits build
                        // mode (handled in RoomsView) so it can be picked up again.
                        'cursor-pointer opacity-60'
                      : `hover:brightness-125 ${draggable ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`
                  }`}
                  style={{
                    left: node.col * CELL_W,
                    top: node.row * CELL_H,
                    width: node.width * CELL_W,
                    height: CELL_H,
                  }}
                >
                  {isElevator ? (
                    <span className="text-xs text-neutral-400">↕</span>
                  ) : (
                    <>
                      <span className="w-full truncate px-1 text-[10px] font-medium leading-tight">
                        {labelOf(node.type)}
                      </span>
                      <span className="text-[9px] text-current/80">
                        L{node.level}
                        {max > 0 ? ` · ${occ}/${max}` : ''}
                      </span>
                    </>
                  )}
                  {/* Needs-repair badge: a wrench in the bottom-right corner so damaged rooms read
                  at a glance, without clicking each one. State is also in the aria-label. */}
                  {damaged && (
                    <span
                      aria-hidden="true"
                      title="Needs repair"
                      className="absolute bottom-2 right-1 text-sm leading-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]"
                    >
                      🔧
                    </span>
                  )}
                  {/* Active-emergency badge: a white flame in the bottom-left corner so rooms in an
                  incident read at a glance (mirrors the wrench). State is also in the aria-label. */}
                  {emergency && (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="pointer-events-none absolute bottom-2 left-1 h-3.5 w-3.5 fill-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]"
                    >
                      <title>Emergency</title>
                      <path d="M12 23a7.5 7.5 0 0 0 7.5-7.5c0-2.7-1.2-4.8-2.7-6.7-.4 1.4-1.4 2-2.4 2 1.1-2.2.4-5.4-2.4-7.8-.4 3.2-2.6 4.4-4 6.9-1 1.6-1.5 3.2-1.5 5.6A7.5 7.5 0 0 0 12 23z" />
                    </svg>
                  )}
                  {/* Advisor badge: an alert triangle in the top-right corner so rooms with an
                  outstanding recommendation (understaffed / broken producer) read at a glance.
                  Selecting the room surfaces the full advisory text in the side panel. */}
                  {advisory && (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className={`pointer-events-none absolute right-1 top-1 h-3.5 w-3.5 ${ADVISORY_TRIANGLE[advisory.severity]} drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]`}
                    >
                      <title>{advisory.title}</title>
                      <path d="M12 2 1 21h22L12 2zm0 6 .9 8h-1.8L12 8zm0 10.5a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z" />
                    </svg>
                  )}
                </button>
              );
            })}

            {/* Keyboard / non-drag move mode: the selected room's legal drop cells, clickable. */}
            {moveNode &&
              moveTargets.map((key) => {
                const [r, c] = key.split(',').map(Number);
                return (
                  <button
                    key={`move-${key}`}
                    type="button"
                    aria-label={`Move ${labelOf(moveNode.type)} to floor ${displayFloor(r)}, column ${c}`}
                    onClick={() => onMoveRoom?.(moveNode.deserializeID, r, c)}
                    className="absolute z-30 rounded-sm border border-dashed border-sky-400/80 bg-sky-500/15 hover:bg-sky-500/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
                    style={{
                      left: c * CELL_W,
                      top: r * CELL_H,
                      width: moveNode.width * CELL_W,
                      height: CELL_H,
                    }}
                  />
                );
              })}

            {/* Live drag feedback: faint legal-target cells + a snap ghost at the drop origin. */}
            {drag && (
              <>
                {[...drag.targets].map((key) => {
                  const [r, c] = key.split(',').map(Number);
                  return (
                    <div
                      key={`dt-${key}`}
                      className="pointer-events-none absolute z-30 rounded-sm border border-dashed border-sky-400/50 bg-sky-500/10"
                      style={{
                        left: c * CELL_W,
                        top: r * CELL_H,
                        width: drag.width * CELL_W,
                        height: CELL_H,
                      }}
                    />
                  );
                })}
                {!drag.overTrash && (
                  <div
                    className={`drop-ghost pointer-events-none absolute z-40 rounded-sm border-2 ${
                      !drag.targetsReady
                        ? 'border-sky-400 bg-sky-500/20' // sweep pending → neutral, no red flash
                        : drag.legal
                          ? 'border-emerald-400 bg-emerald-500/30'
                          : 'border-rose-500 bg-rose-500/25'
                    }`}
                    style={{
                      left: drag.dropCol * CELL_W,
                      top: drag.dropRow * CELL_H,
                      width: drag.width * CELL_W,
                      height: CELL_H,
                    }}
                  />
                )}
              </>
            )}

            {/* Rock / ultracite drag-to-move snap ghost (green = legal empty cell). */}
            {terrainDrag && (
              <div
                className={`pointer-events-none absolute z-40 flex items-center justify-center rounded-sm border-2 text-[10px] ${
                  terrainDrag.legal
                    ? 'border-emerald-400 bg-emerald-500/30'
                    : 'border-rose-500 bg-rose-500/25'
                }`}
                style={{
                  left: terrainDrag.dropCol * CELL_W,
                  top: terrainDrag.dropRow * CELL_H,
                  width: CELL_W,
                  height: CELL_H,
                }}
              >
                {terrainDrag.kind === 'rock' ? '⛏' : '◆'}
              </div>
            )}

            {/* Palette drag-to-build snap-ghost: the would-be footprint, green = legal drop. */}
            {buildGhost && (
              <div
                className={`pointer-events-none absolute z-40 rounded-sm border-2 ${
                  buildGhost.legal
                    ? 'border-emerald-400 bg-emerald-500/30'
                    : 'border-rose-500 bg-rose-500/25'
                }`}
                style={{
                  left: buildGhost.col * CELL_W,
                  top: buildGhost.row * CELL_H,
                  width: buildWidth * CELL_W,
                  height: CELL_H,
                }}
              />
            )}
          </div>

          {/* Mr. Handy rail, RIGHT of the playground (external to it): one slot per floor
              for the robot ASSIGNED to that floor. A robot slot arms/disarms on click and
              is draggable; eligible empty floors light up as drop targets while a robot is
              armed or dragged (one robot per floor, the game rule). */}
          {handyRail && handyRail.length > 0 && (
            <div className="shrink-0" aria-label="Mr. Handy floors">
              {handyRail.map((slot) => {
                const armed = slot.handy && slot.handy.id === armedHandyId;
                const clickable = !!slot.handy || slot.eligible;
                return (
                  <button
                    key={`handy-${slot.row}`}
                    type="button"
                    data-handy-floor={slot.row}
                    disabled={!clickable}
                    aria-label={
                      slot.handy
                        ? `${slot.handy.name} on floor ${displayFloor(slot.row)}${armed ? ' (selected)' : ''}`
                        : slot.eligible
                          ? `Move Mr. Handy to floor ${displayFloor(slot.row)}`
                          : `Floor ${displayFloor(slot.row)}: no Mr. Handy`
                    }
                    title={
                      slot.handy
                        ? `${slot.handy.name} - drag it, or click to ${armed ? 'cancel' : 'move it'}`
                        : slot.eligible
                          ? `Move here (floor ${displayFloor(slot.row)})`
                          : undefined
                    }
                    onClick={() => onHandyChipClick(() => onHandySlotClick?.(slot.row))}
                    {...(slot.handy
                      ? {
                          onPointerDown: (e: ReactPointerEvent) =>
                            onHandyPointerDown(e, slot.handy!.id),
                          onPointerMove: onHandyPointerMove,
                          onPointerUp: endHandyDrag,
                          onPointerCancel: endHandyDrag,
                        }
                      : {})}
                    className={`flex w-8 items-center justify-center rounded-sm border text-sm leading-none ${
                      slot.handy
                        ? `touch-none ${handyDrag?.id === slot.handy.id ? 'opacity-30' : ''} ${
                            armed
                              ? 'border-amber-400 bg-amber-500/25'
                              : 'border-neutral-700 bg-neutral-900 hover:border-amber-500/70'
                          }`
                        : slot.eligible
                          ? 'border-dashed border-sky-400/70 bg-sky-500/10 hover:bg-sky-500/30'
                          : 'border-transparent'
                    }`}
                    style={{ height: CELL_H }}
                  >
                    {slot.handy ? '🤖' : slot.eligible ? '↳' : ''}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Dragged Mr. Handy ghost: follows the cursor; pointer-events-none so the element
          under the cursor (a floor slot / the outside zone) is the drop target. */}
      {handyDrag && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 text-xl drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]"
          style={{ left: handyDrag.x, top: handyDrag.y, transform: 'translate(-50%, -50%)' }}
        >
          🤖
        </div>
      )}

      {/* Live "why is this blocked?" banner: shown at the top while the dragged room hovers an
          illegal cell, surfacing the validator's reason so the red ghost isn't a silent dead end. */}
      {dragReason && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-4 z-50 flex max-w-[80%] -translate-x-1/2 items-center gap-2 rounded-lg border-2 border-dashed border-rose-500/70 bg-neutral-900/90 px-4 py-2 text-xs font-medium text-rose-200 shadow-lg backdrop-blur-sm"
        >
          <span aria-hidden="true" className="text-sm leading-none">
            ⚠
          </span>
          <span>{dragReason}</span>
        </div>
      )}

      {/* Drag-to-delete drop zone (UX): appears only while a room is being dragged. The room
          owns the pointer capture, so this is purely visual - the drop is hit-tested against
          its rect in the drag handlers. Red = release to delete; amber = this room can't be
          deleted (removing it would strand others), so a drop here just snaps back. */}
      {drag && onDeleteRoom && (
        <div
          ref={trashRef}
          aria-hidden="true"
          className={`pointer-events-none absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border-2 border-dashed px-5 py-3 text-sm font-medium shadow-lg backdrop-blur-sm transition-colors ${
            !drag.deletable
              ? 'border-amber-500/70 bg-amber-950/80 text-amber-300'
              : drag.overTrash
                ? 'border-red-400 bg-red-600/85 text-white'
                : 'border-red-500/60 bg-neutral-900/85 text-red-300'
          }`}
        >
          <span aria-hidden="true" className="text-base leading-none">
            🗑
          </span>
          <span>
            {!drag.deletable
              ? 'Can’t delete - would strand rooms'
              : drag.overTrash
                ? 'Release to delete'
                : 'Drag here to delete'}
          </span>
        </div>
      )}
    </div>
  );
}
