import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInSectionRoute } from './routerTestUtils.tsx';
import { RoomsView } from '../../src/ui/views/RoomsView.tsx';
import { useSaveStore } from '../../src/state/saveStore.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';

// Minimal game data: RoomsView reads roomMetadataByType / roomCapacity / roomProduction and
// computes the advisor report (resource strip + per-room badges), so roomProduction also needs
// its `globals` economy constants. Empty catalogs are fine for the Repair-all header (it reads
// damage off the save itself); the advisor just yields an empty report over them.
vi.mock('../../src/ui/hooks/useGameData.ts', () => ({
  useGameData: () => ({
    data: {
      roomMetadataByType: new Map(),
      roomCapacity: { rooms: {} },
      roomProduction: {
        rooms: {},
        globals: {
          taskCycle: 1,
          foodConsumptionPerDweller: 0,
          waterConsumptionPerDweller: 0,
          dwellerConsumptionPeriod: 1,
          energyConsumptionPeriod: 1,
          happinessFactorList: [0],
        },
      },
      unlockables: { recipes: [], roomUnlocks: [] },
    },
    status: 'ready',
    error: null,
  }),
}));

const damagedSave = () =>
  ({
    dwellers: { dwellers: [] },
    vault: {
      rooms: [
        { type: 'Entrance', class: 'Facility', deserializeID: 1, row: 0, col: 0, level: 1 },
        {
          type: 'Cafeteria',
          class: 'Production',
          deserializeID: 2,
          row: 1,
          col: 0,
          level: 1,
          mergeLevel: 1,
          broken: true,
          roomHealth: { damageValue: 200, initialValue: 80 },
        },
      ],
      rocks: [],
    },
  }) as unknown as SaveData;

// damagedSave plus one Mr. Handy on the Cafeteria's floor, for the rail's arm/disarm tests.
const handySave = () =>
  ({
    dwellers: {
      dwellers: [],
      actors: [{ characterType: 2, serializeId: 10, name: 'Butler', savedRoom: 2, health: 500 }],
    },
    vault: {
      rooms: [
        { type: 'Entrance', class: 'Facility', deserializeID: 1, row: 0, col: 0, level: 1 },
        {
          type: 'Cafeteria',
          class: 'Production',
          deserializeID: 2,
          row: 1,
          col: 0,
          level: 1,
          mergeLevel: 1,
          mrHandyList: [10],
        },
      ],
      rocks: [],
    },
  }) as unknown as SaveData;

beforeEach(() => {
  localStorage.clear();
  useSaveStore.setState({ save: damagedSave(), status: 'loaded', past: [], future: [] });
});

const rooms = () => useSaveStore.getState().save!.vault!.rooms!;

describe('RoomsView - Repair all (finding 5)', () => {
  it('enables Repair all with the damaged count and repairs every room on click', async () => {
    const user = userEvent.setup();
    renderInSectionRoute(<RoomsView />, { initialPath: '/rooms' });
    const btn = screen.getByRole('button', { name: /Repair all \(1\)/ });
    expect(btn).toBeEnabled();
    await user.click(btn);
    const cafeteria = rooms().find((r) => r.deserializeID === 2)!;
    expect(cafeteria.broken).toBe(false);
    expect(cafeteria.roomHealth?.damageValue).toBe(0);
  });

  it('disables Repair all when no room is damaged', () => {
    const save = damagedSave();
    save.vault!.rooms![1].broken = false;
    save.vault!.rooms![1].roomHealth = { damageValue: 0, initialValue: 0 };
    useSaveStore.setState({ save, status: 'loaded', past: [], future: [] });
    renderInSectionRoute(<RoomsView />, { initialPath: '/rooms' });
    expect(screen.getByRole('button', { name: /Repair all/ })).toBeDisabled();
  });
});

describe('RoomsView - sticky mode dismissal (build / terrain / armed robot share it)', () => {
  it('keeps terrain paint on its own cells, exits on an outside press or the toggle', async () => {
    const user = userEvent.setup();
    renderInSectionRoute(<RoomsView />, { initialPath: '/rooms' });
    await user.click(screen.getByRole('button', { name: '+ Rock' }));
    expect(screen.getAllByRole('button', { name: /^Place rock/ }).length).toBeGreaterThan(0);
    // Painting a cell keeps the mode active (sticky).
    await user.click(screen.getAllByRole('button', { name: /^Place rock/ })[0]);
    expect(screen.getAllByRole('button', { name: /^Place rock/ }).length).toBeGreaterThan(0);
    // A press anywhere else (the heading) exits the mode.
    await user.click(screen.getByRole('heading', { name: 'Rooms' }));
    expect(screen.queryAllByRole('button', { name: /^Place rock/ })).toHaveLength(0);
    // Clicking the toggle again also exits.
    await user.click(screen.getByRole('button', { name: '+ Rock' }));
    await user.click(screen.getByRole('button', { name: '+ Rock' }));
    expect(screen.queryAllByRole('button', { name: /^Place rock/ })).toHaveLength(0);
  });

  it('disarms an armed Mr. Handy on a press outside the rail and outside zone', async () => {
    const user = userEvent.setup();
    useSaveStore.setState({ save: handySave(), status: 'loaded', past: [], future: [] });
    renderInSectionRoute(<RoomsView />, { initialPath: '/rooms' });
    // Arm the robot: eligible floors light up on the rail.
    await user.click(screen.getByRole('button', { name: /Butler on floor 2/ }));
    expect(screen.getByRole('button', { name: 'Move Mr. Handy to floor 1' })).toBeInTheDocument();
    // A press anywhere else (the heading) disarms it.
    await user.click(screen.getByRole('heading', { name: 'Rooms' }));
    expect(screen.queryByRole('button', { name: 'Move Mr. Handy to floor 1' })).toBeNull();
    // Clicking the robot's own chip again also disarms (toggle).
    await user.click(screen.getByRole('button', { name: /Butler on floor 2/ }));
    await user.click(screen.getByRole('button', { name: /Butler on floor 2 \(selected\)/ }));
    expect(screen.queryByRole('button', { name: 'Move Mr. Handy to floor 1' })).toBeNull();
  });
});
