import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WeaponsView } from '../../src/ui/views/WeaponsView.tsx';
import { useSaveStore } from '../../src/state/saveStore.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';

// Standalone Weapons catalog section: full game-data catalog reference + bulk
// add-to-storage + single-item → multi-dweller equip. Game data is mocked so the test
// is hermetic (no /gamedata fetch); jsdom has no layout, so render non-virtualized.
const WEAPONS = [
  {
    id: 'Laser',
    name: 'Laser Pistol',
    damageMin: 5,
    damageMax: 7,
    type: 0,
    tier: 1,
    rarity: 'Rare',
    sprite: 'x',
  },
  {
    id: 'Plasma',
    name: 'Plasma Rifle',
    damageMin: 10,
    damageMax: 14,
    type: 0,
    tier: 1,
    rarity: 'Rare',
    sprite: 'x',
  },
];

vi.mock('../../src/ui/hooks/useGameData.ts', () => ({
  useGameData: () => ({
    data: {
      enums: {},
      weapons: WEAPONS,
      weaponById: new Map(WEAPONS.map((w) => [w.id, w])),
      outfitById: new Map(),
      petById: new Map(),
    },
    status: 'ready',
    error: null,
  }),
}));

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
          savedRoom: -1,
          stats: { stats: Array.from({ length: 8 }, () => ({ value: 1 })) },
          experience: { currentLevel: 5 },
          health: { healthValue: 100, maxHealth: 100, radiationValue: 0 },
          happiness: { happinessValue: 50 },
          equipedWeapon: { id: 'Fist', type: 'Weapon' },
        },
        {
          serializeId: 2,
          name: 'Bob',
          gender: 2,
          rarity: 'Normal',
          savedRoom: -1,
          stats: { stats: Array.from({ length: 8 }, () => ({ value: 1 })) },
          experience: { currentLevel: 3 },
          health: { healthValue: 100, maxHealth: 100, radiationValue: 0 },
          happiness: { happinessValue: 50 },
          equipedWeapon: { id: 'Fist', type: 'Weapon' },
        },
      ],
    },
  } as SaveData;
}

const inventory = () => useSaveStore.getState().save?.vault?.inventory?.items ?? [];
const dwellerById = (id: number) =>
  useSaveStore.getState().save?.dwellers?.dwellers.find((d) => d.serializeId === id);

const bodyRows = (): HTMLElement[] => {
  const groups = screen.getAllByRole('rowgroup');
  return within(groups[1]).getAllByRole('row');
};

beforeEach(() => {
  localStorage.clear();
  useSaveStore.setState({
    save: makeSave(),
    fileName: 'Vault1.sav',
    status: 'loaded',
    past: [],
    future: [],
  });
});

const renderView = () => render(<WeaponsView virtualized={false} />);

describe('WeaponsView', () => {
  it('renders the full weapon catalog', () => {
    renderView();
    expect(screen.getByText('Laser Pistol')).toBeInTheDocument();
    expect(screen.getByText('Plasma Rifle')).toBeInTheDocument();
    expect(screen.getByText('2 weapons')).toBeInTheDocument();
  });

  it('multi-select + Add to storage grants the selected weapons to the vault', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('checkbox', { name: 'Select Laser Pistol' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Plasma Rifle' }));
    await user.click(screen.getByRole('button', { name: 'Add to storage (2)' }));
    const ids = inventory().map((i) => i.id);
    expect(ids).toContain('Laser');
    expect(ids).toContain('Plasma');
  });

  it('equips one weapon onto multiple dwellers, replacing what they had', async () => {
    const user = userEvent.setup();
    renderView();
    const laserRow = bodyRows().find((r) => within(r).queryByText('Laser Pistol'));
    await user.click(within(laserRow as HTMLElement).getByRole('button', { name: 'Equip…' }));

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Select all' }));
    await user.click(within(dialog).getByRole('button', { name: 'Equip on 2 dwellers' }));

    expect(dwellerById(1)?.equipedWeapon?.id).toBe('Laser');
    expect(dwellerById(2)?.equipedWeapon?.id).toBe('Laser');
  });
});
