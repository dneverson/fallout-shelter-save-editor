import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomSidePanel } from '../../src/ui/components/rooms/RoomSidePanel.tsx';
import { buildLayout } from '../../src/domain/rooms/layout.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';

// A staffed Diner so the loadout action renders (UX-A finding 4 - the button must explain
// what it equips and link to the Bulk loadout panel).
const save = {
  vault: {
    rooms: [
      {
        type: 'Cafeteria',
        class: 'Production',
        deserializeID: 5,
        row: 1,
        col: 0,
        level: 1,
        mergeLevel: 1,
        dwellers: [10],
      },
    ],
  },
} as unknown as SaveData;

const node = buildLayout(save).byId.get(5)!;

function renderPanel(overrides: Partial<Parameters<typeof RoomSidePanel>[0]> = {}) {
  const props = {
    node,
    label: 'Diner',
    maxLevel: 3,
    maxDwellers: 2,
    occupants: [{ id: 10, name: 'Bob' }],
    canRemove: { ok: true } as const,
    mergeable: { ok: false, reason: 'no neighbour' } as const,
    onClose: vi.fn(),
    onSetLevel: vi.fn(),
    onMaxLevel: vi.fn(),
    onRepair: vi.fn(),
    onSetPower: vi.fn(),
    themeOptions: [],
    currentTheme: 'None',
    onSetTheme: vi.fn(),
    onMerge: vi.fn(),
    onUnassign: vi.fn(),
    onOpenAssign: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<RoomSidePanel {...props} />);
  return props;
}

describe('RoomSidePanel loadout clarity (finding 4)', () => {
  it('shows a help tooltip describing exactly what the loadout equips', async () => {
    const user = userEvent.setup();
    renderPanel({
      onApplyLoadout: vi.fn(),
      loadoutLabel: 'Apply Agility loadout',
      loadoutHelp: 'Equips Sturdy Wrestler (the strongest Agility outfit) + Fat Man.',
      onOpenBulkLoadouts: vi.fn(),
    });
    await user.hover(screen.getByRole('button', { name: 'What this loadout equips' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('the strongest Agility outfit');
  });

  it('the Bulk loadouts link invokes onOpenBulkLoadouts', async () => {
    const user = userEvent.setup();
    const onOpenBulkLoadouts = vi.fn();
    renderPanel({
      onApplyLoadout: vi.fn(),
      loadoutLabel: 'Apply Agility loadout',
      onOpenBulkLoadouts,
    });
    await user.click(screen.getByRole('button', { name: /Customize in Bulk/ }));
    expect(onOpenBulkLoadouts).toHaveBeenCalledOnce();
  });

  it('the loadout button invokes onApplyLoadout', async () => {
    const user = userEvent.setup();
    const onApplyLoadout = vi.fn();
    renderPanel({ onApplyLoadout, loadoutLabel: 'Apply Agility loadout' });
    await user.click(screen.getByRole('button', { name: 'Apply Agility loadout' }));
    expect(onApplyLoadout).toHaveBeenCalledOnce();
  });
});

describe('RoomSidePanel timers', () => {
  it('renders nothing without timers', () => {
    renderPanel();
    expect(screen.queryByText('Timers')).not.toBeInTheDocument();
  });

  it('lists timer rows and fires the per-kind completion', async () => {
    const user = userEvent.setup();
    const props = renderPanel({
      timers: [
        { kind: 'production', remainingSeconds: 120 },
        { kind: 'crafting', remainingSeconds: 3_700, itemName: 'Fat Man' },
        { kind: 'rush', remainingSeconds: 60 },
      ],
      onCompleteTimers: vi.fn(),
      onCompleteTrainingSlot: vi.fn(),
    });
    expect(screen.getByText('Timers')).toBeInTheDocument();
    expect(screen.getByText(/production cycle/i)).toBeInTheDocument();
    expect(screen.getByText(/crafting fat man/i)).toBeInTheDocument();
    expect(screen.getByText(/rush cost cooldown/i)).toBeInTheDocument();
    const finishButtons = screen.getAllByRole('button', { name: /finish now/i });
    await user.click(finishButtons[1]!);
    expect(props.onCompleteTimers).toHaveBeenCalledExactlyOnceWith(['crafting']);
    await user.click(screen.getByRole('button', { name: /reset now/i }));
    expect(props.onCompleteTimers).toHaveBeenLastCalledWith(['rush']);
  });

  it('routes training rows through the per-slot callback and offers finish-all', async () => {
    const user = userEvent.setup();
    const props = renderPanel({
      timers: [
        { kind: 'training', remainingSeconds: 900, slotDwellerId: 10, slotDwellerName: 'Bob' },
        { kind: 'training', remainingSeconds: 1_800, slotDwellerId: 11, slotDwellerName: 'Ann' },
      ],
      onCompleteTimers: vi.fn(),
      onCompleteTrainingSlot: vi.fn(),
    });
    expect(screen.getByText(/bob training/i)).toBeInTheDocument();
    const finishButtons = screen.getAllByRole('button', { name: /^finish now$/i });
    await user.click(finishButtons[0]!);
    expect(props.onCompleteTrainingSlot).toHaveBeenCalledExactlyOnceWith(10);
    await user.click(screen.getByRole('button', { name: /finish all training/i }));
    expect(props.onCompleteTimers).toHaveBeenCalledExactlyOnceWith(['training']);
  });
});

describe('RoomSidePanel timers - finished and awaiting-collect states', () => {
  it('a finished timer shows its state instead of a dead button', () => {
    renderPanel({
      timers: [{ kind: 'crafting', remainingSeconds: 0, itemName: 'Fat Man' }],
      onCompleteTimers: vi.fn(),
    });
    expect(screen.getByText(/finishes on next load/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /finish now/i })).not.toBeInTheDocument();
  });

  it('a full production room explains why no timer is stored', () => {
    renderPanel({ productionAwaitingCollect: true });
    expect(screen.getByText('Timers')).toBeInTheDocument();
    expect(screen.getByText(/output full - collect in game/i)).toBeInTheDocument();
    expect(screen.getByText(/no cycle timer is stored/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /finish now/i })).not.toBeInTheDocument();
  });
});
