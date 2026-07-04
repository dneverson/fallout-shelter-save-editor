import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BuildPalette, type BuildableRoom } from '../../src/ui/components/rooms/BuildPalette.tsx';

// The Build palette uses the user-specified compact card: "Name (S) 🔒" over
// "cost · 👥 n · w× wide", plus a third "+Food" production line for producers. The title
// line carries Sort by / Filter dropdowns over the room facts.
const ROOMS: BuildableRoom[] = [
  {
    type: 'Cafeteria',
    name: 'Diner',
    cost: 100,
    capacity: 2,
    primaryStat: 'Agility',
    size: 1,
    produces: ['Food'],
    locked: false,
    roomClass: 'Production',
  },
  {
    type: 'Elevator',
    name: 'Elevator',
    cost: 100,
    capacity: 0,
    primaryStat: 'None',
    size: 1,
    produces: [],
    locked: false,
    roomClass: 'Utility',
  },
];

describe('BuildPalette', () => {
  it('shows cost, capacity, stat letter, width, and production as visible text', () => {
    render(<BuildPalette rooms={ROOMS} activeType={null} onPick={() => {}} />);
    const diner = screen.getByRole('button', { name: /Diner/ });
    expect(diner).toHaveTextContent('100 caps');
    expect(diner).toHaveTextContent('👥 2');
    expect(diner).toHaveTextContent('(A)'); // Agility as a compact SPECIAL letter
    expect(diner).toHaveTextContent('1× wide');
    expect(diner).toHaveTextContent('+Food'); // third-line production fact
    expect(diner).toHaveAttribute('title', expect.stringContaining('Agility'));
  });

  it('omits capacity / stat / production facts for a facility with none (Elevator)', () => {
    render(<BuildPalette rooms={ROOMS} activeType={null} onPick={() => {}} />);
    const elevator = screen.getByRole('button', { name: /Elevator/ });
    expect(elevator).toHaveTextContent('100 caps');
    expect(elevator).not.toHaveTextContent('👥');
    expect(elevator).not.toHaveTextContent('None');
    expect(elevator).not.toHaveTextContent('+');
  });

  it('filters the boxes from the Filter dropdown (locked only)', async () => {
    const user = userEvent.setup();
    const rooms: BuildableRoom[] = [
      ROOMS[0],
      { ...ROOMS[0], type: 'Armory', name: 'Armory', locked: true },
    ];
    render(<BuildPalette rooms={rooms} activeType={null} onPick={() => {}} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter rooms' }), 'locked');
    expect(screen.queryByRole('button', { name: /Diner/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Armory/ })).toBeInTheDocument();
  });

  it('sorts the boxes from the Sort by dropdown (price)', async () => {
    const user = userEvent.setup();
    const rooms: BuildableRoom[] = [
      { ...ROOMS[0], type: 'Water', name: 'Aqua', cost: 900 },
      { ...ROOMS[0], type: 'Cafeteria', name: 'Diner', cost: 100 },
    ];
    render(<BuildPalette rooms={rooms} activeType={null} onPick={() => {}} />);
    // Default name sort: Aqua before Diner.
    let names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(names.findIndex((t) => t.includes('Aqua'))).toBeLessThan(
      names.findIndex((t) => t.includes('Diner')),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort rooms by' }), 'price');
    names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(names.findIndex((t) => t.includes('Diner'))).toBeLessThan(
      names.findIndex((t) => t.includes('Aqua')),
    );
  });

  it('marks a locked room with a lock icon but keeps it clickable', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const rooms: BuildableRoom[] = [{ ...ROOMS[0], type: 'Armory', name: 'Armory', locked: true }];
    render(<BuildPalette rooms={rooms} activeType={null} onPick={onPick} />);
    const armory = screen.getByRole('button', { name: /Armory/ });
    expect(armory).toHaveTextContent('🔒');
    expect(armory).not.toBeDisabled();
    await user.click(armory);
    expect(onPick).toHaveBeenCalledWith('Armory');
  });

  it('does not show a lock icon for an unlocked room', () => {
    render(<BuildPalette rooms={ROOMS} activeType={null} onPick={() => {}} />);
    expect(screen.getByRole('button', { name: /Diner/ })).not.toHaveTextContent('🔒');
  });

  it('calls onPick with the room type when a button is clicked', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<BuildPalette rooms={ROOMS} activeType={null} onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: /Diner/ }));
    expect(onPick).toHaveBeenCalledWith('Cafeteria');
  });

  // UX-G drag-to-build: dragging a box past the threshold hands the gesture to the grid via
  // onBuildDragStart and must NOT also toggle build mode (onPick) on the trailing click.
  it('hands a dragged box to the grid (onBuildDragStart), streaming the cursor and ending it', () => {
    const onPick = vi.fn();
    const onBuildDragStart = vi.fn();
    const onBuildDragMove = vi.fn();
    const onBuildDragEnd = vi.fn();
    render(
      <BuildPalette
        rooms={ROOMS}
        activeType={null}
        onPick={onPick}
        onBuildDragStart={onBuildDragStart}
        onBuildDragMove={onBuildDragMove}
        onBuildDragEnd={onBuildDragEnd}
      />,
    );
    const diner = screen.getByRole('button', { name: /Diner/ });
    fireEvent.pointerDown(diner, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(diner, { pointerId: 1, clientX: 60, clientY: 30 });
    fireEvent.pointerUp(diner, { pointerId: 1, clientX: 60, clientY: 30 });
    expect(onBuildDragStart).toHaveBeenCalledWith('Cafeteria');
    expect(onBuildDragMove).toHaveBeenCalledWith(60, 30);
    expect(onBuildDragEnd).toHaveBeenCalledWith(60, 30);
    fireEvent.click(diner); // the post-drag click is swallowed, not a build-mode toggle
    expect(onPick).not.toHaveBeenCalled();
  });

  it('treats a sub-threshold press as a click, not a drag', () => {
    const onPick = vi.fn();
    const onBuildDragStart = vi.fn();
    render(
      <BuildPalette
        rooms={ROOMS}
        activeType={null}
        onPick={onPick}
        onBuildDragStart={onBuildDragStart}
      />,
    );
    const diner = screen.getByRole('button', { name: /Diner/ });
    fireEvent.pointerDown(diner, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(diner, { pointerId: 1, clientX: 2, clientY: 1 });
    fireEvent.pointerUp(diner, { pointerId: 1, clientX: 2, clientY: 1 });
    fireEvent.click(diner);
    expect(onBuildDragStart).not.toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith('Cafeteria');
  });
});
