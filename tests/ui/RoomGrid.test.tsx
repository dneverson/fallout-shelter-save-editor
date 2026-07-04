import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomGrid } from '../../src/ui/components/rooms/RoomGrid.tsx';
import { buildLayout } from '../../src/domain/rooms/layout.ts';
import { validMoveTargets } from '../../src/domain/rooms/placement.ts';
import { CELL_W, CELL_H } from '../../src/ui/components/rooms/roomVisuals.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';

// A tiny vault: an Entrance plus two rock cells, so we can verify rocks are excavatable
// (UX-A finding 2) and the selected room is marked (UX-A finding 6).
const save = {
  vault: {
    rooms: [{ type: 'Entrance', class: 'Facility', deserializeID: 1, row: 0, col: 0, level: 1 }],
    rocks: [
      { r: 1, c: 0 },
      { r: 1, c: 3 },
    ],
  },
} as unknown as SaveData;

const layout = buildLayout(save);
const noop = () => {};

describe('RoomGrid', () => {
  it('renders rock cells as buttons that excavate the clicked cell', async () => {
    const user = userEvent.setup();
    const onExcavateRock = vi.fn();
    render(
      <RoomGrid
        layout={layout}
        selectedId={null}
        onSelect={noop}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
        onExcavateRock={onExcavateRock}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Excavate rock at floor 2, column 3' }));
    expect(onExcavateRock).toHaveBeenCalledWith(1, 3);
  });

  it('disables rock excavation in build mode', () => {
    render(
      <RoomGrid
        layout={layout}
        selectedId={null}
        onSelect={noop}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
        buildOrigins={new Set()}
        onExcavateRock={noop}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Excavate rock at floor 2, column 0' }),
    ).toBeDisabled();
  });

  it('renders the palette drag-to-build ghost - emerald on a legal cell, rose on an illegal one', () => {
    const { container, rerender } = render(
      <RoomGrid
        layout={layout}
        selectedId={null}
        onSelect={noop}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
        buildOrigins={new Set(['1,0'])}
        buildWidth={3}
        buildGhost={{ row: 1, col: 0, legal: true }}
      />,
    );
    expect(container.querySelector('.border-emerald-400')).toBeTruthy();
    rerender(
      <RoomGrid
        layout={layout}
        selectedId={null}
        onSelect={noop}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
        buildOrigins={new Set(['1,0'])}
        buildWidth={3}
        buildGhost={{ row: 1, col: 0, legal: false }}
      />,
    );
    expect(container.querySelector('.border-rose-500')).toBeTruthy();
  });

  it('shows a needs-repair wrench badge and folds the state into the room aria-label', () => {
    render(
      <RoomGrid
        layout={layout}
        selectedId={null}
        onSelect={noop}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
        needsRepair={(n) => n.deserializeID === 1}
      />,
    );
    const room = screen.getByRole('button', { name: /Entrance.*needs repair/ });
    expect(room).toHaveTextContent('🔧');
  });

  it('omits the wrench badge for a healthy room', () => {
    render(
      <RoomGrid
        layout={layout}
        selectedId={null}
        onSelect={noop}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
        needsRepair={() => false}
      />,
    );
    expect(screen.getByRole('button', { name: /Entrance floor 1/ })).not.toHaveTextContent('🔧');
    expect(screen.queryByRole('button', { name: /needs repair/ })).toBeNull();
  });

  it('shows an emergency fire badge and folds the state into the room aria-label', () => {
    const { container } = render(
      <RoomGrid
        layout={layout}
        selectedId={null}
        onSelect={noop}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
        inEmergency={(n) => n.deserializeID === 1}
      />,
    );
    expect(screen.getByRole('button', { name: /Entrance.*emergency/ })).toBeInTheDocument();
    // The flame is a white inline SVG (not the colored emoji).
    expect(container.querySelector('svg.fill-white')).toBeTruthy();
  });

  it('omits the fire badge for a room with no emergency', () => {
    const { container } = render(
      <RoomGrid
        layout={layout}
        selectedId={null}
        onSelect={noop}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
        inEmergency={() => false}
      />,
    );
    expect(container.querySelector('svg.fill-white')).toBeNull();
    expect(screen.queryByRole('button', { name: /emergency/ })).toBeNull();
  });

  it('marks the selected room with aria-current and a strong outline', () => {
    render(
      <RoomGrid
        layout={layout}
        selectedId={1}
        onSelect={noop}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
      />,
    );
    const room = screen.getByRole('button', { name: /Entrance floor 1/ });
    expect(room).toHaveAttribute('aria-current', 'true');
    expect(room.className).toContain('outline-amber-300');
  });
});

// A two-floor vault sharing the col-3 shaft, so the Storage (id 3) has real move targets.
const moveSave = {
  vault: {
    rooms: [
      { type: 'Entrance', class: 'Facility', deserializeID: 1, row: 0, col: 0, level: 1 },
      { type: 'Elevator', class: 'Utility', deserializeID: 2, row: 0, col: 3, level: 1 },
      { type: 'Storage', class: 'Facility', deserializeID: 3, row: 0, col: 4, level: 1 },
      { type: 'Elevator', class: 'Utility', deserializeID: 5, row: 1, col: 3, level: 1 },
    ],
    rocks: [],
  },
} as unknown as SaveData;
const moveLayout = buildLayout(moveSave);

describe('RoomGrid drag-to-rearrange (UX-G)', () => {
  it('marks a movable room with a grab cursor and the fixed Entrance without', () => {
    render(
      <RoomGrid
        layout={moveLayout}
        selectedId={null}
        onSelect={noop}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
        canMove={(n) => n.type !== 'Entrance'}
      />,
    );
    expect(screen.getByRole('button', { name: /Storage floor 1/ }).className).toContain(
      'cursor-grab',
    );
    expect(screen.getByRole('button', { name: /Entrance floor 1/ }).className).not.toContain(
      'cursor-grab',
    );
  });

  it('still selects on a plain click (no drag) - keyboard/click select preserved', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RoomGrid
        layout={moveLayout}
        selectedId={null}
        onSelect={onSelect}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
        canMove={(n) => n.type !== 'Entrance'}
        moveTargetsFor={(id) => validMoveTargets(moveLayout, id)}
        onMoveRoom={noop}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Storage floor 1/ }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('anchors the grab offset to the press point, not a fast first move (no runaway ghost)', () => {
    const { container } = render(
      <RoomGrid
        layout={moveLayout}
        selectedId={null}
        onSelect={noop}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
        canMove={(n) => n.type !== 'Entrance'}
        moveTargetsFor={(id) => validMoveTargets(moveLayout, id)}
        onMoveRoom={noop}
      />,
    );
    // Pin the grid origin to (0,0) so client coords map straight to cells. The grid content
    // div is the relative one carrying the inline sizing style (the outer wrapper has none).
    const content = container.querySelector('div.relative[style]') as HTMLElement;
    content.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 600,
        bottom: 1000,
        width: 600,
        height: 1000,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;

    // Storage (id 3) sits at row 0, col 4. Press on its left edge.
    const storage = screen.getByRole('button', { name: /Storage floor 1/ });
    const pressX = 4 * CELL_W + 2,
      pressY = 0 * CELL_H + 2;
    fireEvent.pointerDown(storage, { button: 0, pointerId: 1, clientX: pressX, clientY: pressY });
    // FAST flick: the first move React sees is already far away (coalesced).
    fireEvent.pointerMove(storage, { pointerId: 1, clientX: pressX + 200, clientY: pressY + 100 });
    // Then settle the cursor on row 1, col 4.
    const cursorX = 4 * CELL_W + 2,
      cursorY = 1 * CELL_H + 2;
    fireEvent.pointerMove(storage, { pointerId: 1, clientX: cursorX, clientY: cursorY });

    // The snap-ghost carries a stable `drop-ghost` class regardless of its legal/pending color
    // (the validator sweep is deferred, so it's the neutral "pending" style in this sync test).
    const ghost = container.querySelector('div.drop-ghost') as HTMLElement;
    // Grab anchored to the left-edge press => offset 0 => ghost lands under the cursor cell
    // (col 4, row 1) = (96, 46), NOT clamped to (0,0) as the stale-grab bug produced.
    expect(parseFloat(ghost.style.left)).toBe(4 * CELL_W);
    expect(parseFloat(ghost.style.top)).toBe(1 * CELL_H);
  });

  it('move mode renders the validator-approved drop cells as clickable targets', async () => {
    const user = userEvent.setup();
    const onMoveRoom = vi.fn();
    render(
      <RoomGrid
        layout={moveLayout}
        selectedId={3}
        onSelect={noop}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
        canMove={(n) => n.type !== 'Entrance'}
        moveTargetsFor={(id) => validMoveTargets(moveLayout, id)}
        onMoveRoom={onMoveRoom}
        moveModeId={3}
      />,
    );
    // Targets are the legal drops minus the room's current cell (0,4): row-1 cols 0 and 4.
    expect(
      screen.getByRole('button', { name: 'Move Storage to floor 2, column 0' }),
    ).toBeInTheDocument();
    const target = screen.getByRole('button', { name: 'Move Storage to floor 2, column 4' });
    await user.click(target);
    expect(onMoveRoom).toHaveBeenCalledWith(3, 1, 4);
  });
});

const pinRect = (el: HTMLElement, r: Partial<DOMRect>): void => {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      ...r,
      toJSON() {},
    }) as DOMRect;
};

describe('RoomGrid drag-to-delete', () => {
  // Drag the Storage (id 3) onto the trash zone, which only renders while a drag is active.
  const startDrag = (deletable: boolean) => {
    const onDeleteRoom = vi.fn();
    const view = render(
      <RoomGrid
        layout={moveLayout}
        selectedId={null}
        onSelect={noop}
        labelOf={(t) => t}
        maxDwellersOf={() => 0}
        canMove={(n) => n.type !== 'Entrance'}
        moveTargetsFor={(id) => validMoveTargets(moveLayout, id)}
        onMoveRoom={noop}
        canRemove={() => deletable}
        onDeleteRoom={onDeleteRoom}
      />,
    );
    pinRect(view.container.querySelector('div.relative[style]') as HTMLElement, {
      right: 600,
      bottom: 1000,
      width: 600,
      height: 1000,
    });
    const storage = screen.getByRole('button', { name: /Storage floor 1/ });
    const pressX = 4 * CELL_W + 2;
    fireEvent.pointerDown(storage, { button: 0, pointerId: 1, clientX: pressX, clientY: 2 });
    // First move crosses the drag threshold and renders the trash zone.
    fireEvent.pointerMove(storage, { pointerId: 1, clientX: pressX + 20, clientY: 22 });
    const trash = view.container.querySelector('.bottom-4') as HTMLElement;
    pinRect(trash, { left: 200, top: 900, right: 400, bottom: 960, width: 200, height: 60 });
    return { storage, onDeleteRoom };
  };

  it('requests deletion when a removable room is released over the trash zone', () => {
    const { storage, onDeleteRoom } = startDrag(true);
    fireEvent.pointerMove(storage, { pointerId: 1, clientX: 300, clientY: 930 });
    fireEvent.pointerUp(storage, { pointerId: 1, clientX: 300, clientY: 930 });
    expect(onDeleteRoom).toHaveBeenCalledWith(3);
  });

  it('does not delete a non-removable room dropped on the trash (snaps back)', () => {
    const { storage, onDeleteRoom } = startDrag(false);
    fireEvent.pointerMove(storage, { pointerId: 1, clientX: 300, clientY: 930 });
    fireEvent.pointerUp(storage, { pointerId: 1, clientX: 300, clientY: 930 });
    expect(onDeleteRoom).not.toHaveBeenCalled();
  });
});
