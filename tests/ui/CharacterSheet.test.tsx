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
  useSaveStore.setState({ save: makeSave(), status: 'loaded', past: [], future: [] });
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
