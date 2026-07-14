import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { CharacterSheet } from '../../src/ui/components/dwellers/CharacterSheet.tsx';
import { useSaveStore } from '../../src/state/saveStore.ts';
import { useUIStore } from '../../src/state/uiStore.ts';
import type { Dweller, SaveData } from '../../src/domain/model/saveSchema.ts';

// Game data is mocked to null: the sheet then degrades hair/face to raw text inputs
// (the documented fallback) and equipment shows raw ids. Gender filtering of the
// catalog picker is covered separately in tests/domain/gamedata.test.ts.
vi.mock('../../src/ui/hooks/useGameData.ts', () => ({
  useGameData: () => ({ data: null, status: 'ready', error: null }),
}));

function stat(value: number) {
  return { value };
}

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
          hair: '03',
          faceMask: 'wrinkles',
          pregnant: false,
          babyReady: false,
          skinColor: 0xffaabbcc,
          hairColor: 0xff112233,
          outfitColor: 0xffffffff,
          happiness: { happinessValue: 50 },
          health: { healthValue: 80, maxHealth: 100, radiationValue: 0 },
          experience: { currentLevel: 5, experienceValue: 1234, needLvUp: true },
          stats: {
            stats: [stat(0), stat(3), stat(3), stat(3), stat(3), stat(3), stat(3), stat(3)],
          },
          equipedWeapon: { id: 'Laser', type: 'Weapon' },
        },
        { serializeId: 2, name: 'Bob', gender: 2, stats: { stats: [stat(0), stat(1)] } },
      ],
    },
  } as SaveData;
}

const dwellerById = (id: number): Dweller | undefined =>
  useSaveStore.getState().save?.dwellers?.dwellers.find((d) => d.serializeId === id);

beforeEach(() => {
  localStorage.clear();
  useUIStore.setState({ allowOutOfRange: false });
  useSaveStore.setState({
    save: makeSave(),
    originalSave: null,
    status: 'loaded',
    past: [],
    future: [],
  });
});

// Re-derive the dweller from the store on each render, as DwellersView does, so
// controlled inputs reflect committed edits (mirrors the real master-detail wiring).
function Harness({ id }: { id: number }) {
  const dweller = useSaveStore((s) => s.save?.dwellers?.dwellers.find((d) => d.serializeId === id));
  return dweller ? <CharacterSheet dweller={dweller} onClose={() => {}} /> : null;
}

// FamilyBlock (rendered inside the sheet) uses router hooks, so wrap in a Router context.
const renderSheet = (id: number) => render(<Harness id={id} />, { wrapper: MemoryRouter });

describe('CharacterSheet - identity', () => {
  it('renders the dweller and commits a name edit on blur', async () => {
    const user = userEvent.setup();
    renderSheet(1);
    const first = screen.getByRole('textbox', { name: 'First name' });
    expect(first).toHaveValue('Alice');
    await user.clear(first);
    await user.type(first, 'Renamed');
    await user.tab(); // blur commits
    expect(dwellerById(1)?.name).toBe('Renamed');
  });

  it('changes rarity through the store', async () => {
    const user = userEvent.setup();
    renderSheet(1);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rarity' }), 'Legendary');
    expect(dwellerById(1)?.rarity).toBe('Legendary');
  });
});

describe('CharacterSheet - delete', () => {
  it('deletes the dweller after confirming', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CharacterSheet dweller={dwellerById(1)!} onClose={onClose} />, {
      wrapper: MemoryRouter,
    });

    await user.click(screen.getByRole('button', { name: 'Delete dweller' }));
    await user.click(screen.getByRole('button', { name: 'Delete' })); // confirm

    expect(dwellerById(1)).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('hovering Delete dweller shows the full scrubbing help as an on-screen tooltip', async () => {
    const user = userEvent.setup();
    renderSheet(1);
    // Viewport-clamped bubble, not a native `title` (which the page cannot keep on screen).
    await user.hover(screen.getByRole('button', { name: 'Delete dweller' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(/cleans up every trace/i);
    await user.unhover(screen.getByRole('button', { name: 'Delete dweller' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not delete when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    render(<CharacterSheet dweller={dwellerById(1)!} onClose={() => {}} />, {
      wrapper: MemoryRouter,
    });

    await user.click(screen.getByRole('button', { name: 'Delete dweller' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(dwellerById(1)).toBeDefined();
  });
});

describe('CharacterSheet - SPECIAL', () => {
  it('clamps a stat to 10 by default on commit', async () => {
    const user = userEvent.setup();
    renderSheet(1);
    const strength = screen.getByRole('spinbutton', { name: 'S' });
    await user.clear(strength);
    await user.type(strength, '99');
    await user.tab();
    expect(dwellerById(1)?.stats?.stats[1].value).toBe(10);
  });

  it('"Max all" sets every SPECIAL to 10 in one edit', async () => {
    const user = userEvent.setup();
    renderSheet(1);
    await user.click(screen.getByRole('button', { name: 'Max all' }));
    const stats = dwellerById(1)?.stats?.stats ?? [];
    expect(stats.slice(1, 8).map((s) => s.value)).toEqual([10, 10, 10, 10, 10, 10, 10]);
    expect(useSaveStore.getState().past).toHaveLength(1); // a single undo step
  });
});

describe('CharacterSheet - out-of-range toggle', () => {
  it('writes a SPECIAL past 10 once the cheat toggle is on', async () => {
    const user = userEvent.setup();
    renderSheet(1);
    await user.click(screen.getByRole('checkbox', { name: /allow out-of-range/i }));
    const strength = screen.getByRole('spinbutton', { name: 'S' });
    await user.clear(strength);
    await user.type(strength, '99');
    await user.tab();
    expect(dwellerById(1)?.stats?.stats[1].value).toBe(99);
  });
});

describe('CharacterSheet - appearance', () => {
  it('clearing facial hair deletes the faceMask key (round-trip fidelity)', async () => {
    const user = userEvent.setup();
    renderSheet(1);
    const face = screen.getByRole('textbox', { name: 'Face accessory' });
    expect(face).toHaveValue('wrinkles');
    await user.clear(face); // empty + allowNone → null → delete key
    const d = dwellerById(1);
    expect(d && 'faceMask' in d).toBe(false);
  });
});

describe('CharacterSheet - pregnancy gating', () => {
  it('shows pregnancy controls for a female dweller and toggles the flag', async () => {
    const user = userEvent.setup();
    renderSheet(1);
    const pregnant = screen.getByRole('checkbox', { name: 'Pregnant' });
    await user.click(pregnant);
    expect(dwellerById(1)?.pregnant).toBe(true);
  });

  it('hides pregnancy controls for a male dweller', () => {
    renderSheet(2);
    expect(screen.queryByRole('checkbox', { name: 'Pregnant' })).not.toBeInTheDocument();
  });

  it('Babies expected appears for an editor-forced pregnancy and creates the partnership', async () => {
    const user = userEvent.setup();
    const base = makeSave();
    // A living quarters with no partnership recorded: ticking Pregnant is flag-only.
    useSaveStore.setState({
      save: {
        ...base,
        vault: { rooms: [{ type: 'LivingQuarters', deserializeID: 10, partners: [] }] },
      } as SaveData,
      originalSave: null,
      status: 'loaded',
      past: [],
      future: [],
    });
    renderSheet(1);
    expect(screen.queryByRole('combobox', { name: /babies expected/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Pregnant' }));
    // The selector shows immediately - no round trip through the game to get the entry.
    const select = screen.getByRole('combobox', { name: /babies expected/i });
    await user.selectOptions(select, '3');
    const partner = useSaveStore.getState().save?.vault?.rooms?.[0]?.partners?.[0];
    expect(partner?.s).toBe('RaisingBaby');
    expect(partner?.f).toBe(1);
    expect(partner?.pendingChildren).toBe(3);
    // Ticking Pregnant auto-picked Bob, so the created entry records him as the father.
    expect(partner?.m).toBe(2);
  });
});

describe('CharacterSheet - equipment pickers', () => {
  it('shows the raw weapon id on a clickable chip when game data is unavailable', () => {
    renderSheet(1);
    expect(screen.getByRole('button', { name: 'Laser' })).toBeInTheDocument();
  });

  it('opens the weapon picker and "Reset to Fist" unequips to the default', async () => {
    const user = userEvent.setup();
    renderSheet(1);
    await user.click(screen.getByRole('button', { name: 'Laser' }));
    expect(screen.getByText('Equip weapon')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset to Fist' }));
    expect(dwellerById(1)?.equipedWeapon?.id).toBe('Fist');
  });

  it('opens the pet attach dialog from the empty pet slot', async () => {
    const user = userEvent.setup();
    renderSheet(2); // Bob has no pet
    await user.click(screen.getByRole('button', { name: 'Attach a pet…' }));
    expect(screen.getByRole('button', { name: 'Catalog' })).toBeInTheDocument();
  });
});

describe('CharacterSheet - timers', () => {
  function seedTimers() {
    const base = makeSave();
    // Seeded as BOTH save and originalSave (an import's initial state): unticking
    // "Baby ready" restores timers from originalSave.
    const seeded = {
      ...base,
      dwellers: {
        dwellers: [
          ...(base.dwellers?.dwellers ?? []),
          { serializeId: 3, name: 'Kid', gender: 2, stats: { stats: [stat(0), stat(1)] } },
          { serializeId: 4, name: 'Scout', gender: 2, stats: { stats: [stat(0), stat(1)] } },
        ],
      },
      taskMgr: {
        id: 600,
        time: 1_000,
        tasks: [
          { startTime: 900, endTime: 4_600, id: 501, paused: false },
          { startTime: 900, endTime: 8_200, id: 502, paused: false },
        ],
      },
      vault: {
        rooms: [
          {
            type: 'LivingQuarters',
            deserializeID: 10,
            partners: [{ m: 2, f: 1, s: 'RaisingBaby', t: 501 }],
            children: [{ taskID: 502, dwellerID: 3, notificationID: -1 }],
          },
        ],
        wasteland: {
          teams: [
            {
              dwellers: [4],
              status: 'ReturningToVault',
              elapsedReturningTime: 100,
              returnTripDuration: 400,
            },
          ],
        },
      },
    } as SaveData;
    useSaveStore.setState({
      save: seeded,
      originalSave: seeded,
      status: 'loaded',
      past: [],
      future: [],
    });
  }

  it('Deliver now completes the timer AND ticks the Baby ready checkbox (kept in sync)', async () => {
    const user = userEvent.setup();
    seedTimers();
    // Alice must read as pregnant for the section to make sense in-game terms.
    renderSheet(1);
    expect(screen.getByText(/baby due in/i)).toBeInTheDocument();
    expect(screen.getByText('1h 0m')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /baby ready/i })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: /deliver now/i }));
    const task = useSaveStore.getState().save?.taskMgr?.tasks?.find((t) => t.id === 501);
    expect(task?.endTime).toBe(1_000);
    // The checkbox reflects the delivered state, and the row swaps to "due now" copy
    // instead of a dead "due in 0s" button.
    expect(screen.getByRole('checkbox', { name: /baby ready/i })).toBeChecked();
    expect(screen.getByText(/baby is due now/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /deliver now/i })).not.toBeInTheDocument();
  });

  it('ticking Baby ready delivers: flag and due timer complete together', async () => {
    const user = userEvent.setup();
    seedTimers();
    renderSheet(1);
    await user.click(screen.getByRole('checkbox', { name: /baby ready/i }));
    const task = useSaveStore.getState().save?.taskMgr?.tasks?.find((t) => t.id === 501);
    expect(task?.endTime).toBe(1_000);
    expect(screen.getByText(/baby is due now/i)).toBeInTheDocument();
  });

  it('unticking Baby ready cancels the delivery and restores the original due timer', async () => {
    const user = userEvent.setup();
    seedTimers();
    renderSheet(1);
    await user.click(screen.getByRole('button', { name: /deliver now/i }));
    expect(screen.getByText(/baby is due now/i)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /baby ready/i }));
    // The flag clears and the countdown returns to the imported 1h - the timer is
    // NOT left stranded at 0s.
    expect(screen.getByRole('checkbox', { name: /baby ready/i })).not.toBeChecked();
    expect(screen.getByText(/baby due in/i)).toBeInTheDocument();
    expect(screen.getByText('1h 0m')).toBeInTheDocument();
    const task = useSaveStore.getState().save?.taskMgr?.tasks?.find((t) => t.id === 501);
    expect(task?.endTime).toBe(4_600);
    expect(task?.startTime).toBe(900);
  });

  it('Babies expected forces twins via the partnership pendingChildren field', async () => {
    const user = userEvent.setup();
    seedTimers();
    renderSheet(1);
    const select = screen.getByRole('combobox', { name: /babies expected/i });
    // Absent key reads as the natural birth-time roll.
    expect(select).toHaveValue('0');
    await user.selectOptions(select, '2');
    const partner = useSaveStore.getState().save?.vault?.rooms?.[0]?.partners?.[0];
    expect(partner?.pendingChildren).toBe(2);
  });

  it('hides Babies expected when there is no RaisingBaby partnership entry', () => {
    renderSheet(1); // base fixture: no vault rooms at all
    expect(screen.queryByRole('combobox', { name: /babies expected/i })).not.toBeInTheDocument();
  });

  it('shows the grow-up timer for a child and completes it', async () => {
    const user = userEvent.setup();
    seedTimers();
    renderSheet(3);
    expect(screen.getByText(/adult in/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /grow up now/i }));
    const task = useSaveStore.getState().save?.taskMgr?.tasks?.find((t) => t.id === 502);
    expect(task?.endTime).toBe(1_000);
    // The completed timer swaps to a status line - never a dead 0s button.
    expect(screen.getByText(/becomes an adult on next load/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /grow up now/i })).not.toBeInTheDocument();
  });

  it('shows a returning explorer and brings them home', async () => {
    const user = userEvent.setup();
    seedTimers();
    renderSheet(4);
    expect(screen.getByText(/returning home/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /return now/i }));
    const team = useSaveStore.getState().save?.vault?.wasteland?.teams?.[0];
    expect(team?.elapsedReturningTime).toBe(400);
  });

  it('renders no timer sections for a dweller without timers', () => {
    seedTimers();
    renderSheet(2);
    expect(screen.queryByText(/growing up/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/exploring/i)).not.toBeInTheDocument();
  });
});
