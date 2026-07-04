import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderInSectionRoute } from './routerTestUtils.tsx';
import userEvent from '@testing-library/user-event';
import { PetsView } from '../../src/ui/views/PetsView.tsx';
import { useSaveStore } from '../../src/state/saveStore.ts';
import { useUIStore } from '../../src/state/uiStore.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';

// The Pets section gains a "Catalog" tab (all breeds×rarity) alongside the existing
// owned-pet master-detail editor ("Owned"). Catalog actions mint instances: bulk
// add-to-storage and single-pet → multi-dweller equip. Game data is mocked; jsdom has
// no layout, so render non-virtualized.
// Real data convention: `name` is the breed display name, `baseName` the special in-game
// name (e.g. "Dogmeat") when a legendary has one. The catalog surfaces the special name.
const PETS = [
  {
    id: 'dog_l',
    name: 'German Shepherd',
    baseName: 'Dogmeat',
    breed: 'German Shepherd',
    type: 'Damage',
    rarity: 'Legendary',
    bonus: 'DamageBoost',
    bonusMin: 5,
    bonusMax: 10,
  },
  {
    id: 'cat_c',
    name: 'Whiskers',
    baseName: 'Whiskers',
    breed: 'Tabby',
    type: 'Junk',
    rarity: 'Common',
    bonus: 'ExtraStimpak',
    bonusMin: 1,
    bonusMax: 2,
  },
];

vi.mock('../../src/ui/hooks/useGameData.ts', () => ({
  useGameData: () => ({
    data: {
      enums: {},
      pets: PETS,
      weaponById: new Map(),
      outfitById: new Map(),
      petById: new Map(PETS.map((p) => [p.id, p])),
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
          lastName: '',
          gender: 1,
          rarity: 'Normal',
          savedRoom: -1,
          stats: { stats: Array.from({ length: 8 }, () => ({ value: 1 })) },
          experience: { currentLevel: 5 },
          health: { healthValue: 100, maxHealth: 100, radiationValue: 0 },
          happiness: { happinessValue: 50 },
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
  useUIStore.setState({
    tableLayouts: {},
    petGlobalFilter: '',
    petColumnFilters: [],
  });
  useSaveStore.setState({
    save: makeSave(),
    fileName: 'Vault1.sav',
    status: 'loaded',
    past: [],
    future: [],
  });
});

const openCatalog = async (user: ReturnType<typeof userEvent.setup>) => {
  renderInSectionRoute(<PetsView virtualized={false} />, { initialPath: '/pets' });
  await user.click(screen.getByRole('tab', { name: 'Catalog' }));
};

describe('PetsView - Catalog tab', () => {
  it('the Owned tab is shown first; the Catalog tab reveals the full breed catalog', async () => {
    const user = userEvent.setup();
    renderInSectionRoute(<PetsView virtualized={false} />, { initialPath: '/pets' });
    // Owned tab (default): the owned roster (0 owned), not the catalog rows.
    expect(screen.getByText('0 owned')).toBeInTheDocument();
    expect(screen.queryByText('Dogmeat')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Catalog' }));
    expect(screen.getByText('Dogmeat')).toBeInTheDocument(); // special name surfaced
    expect(screen.getByText('Whiskers')).toBeInTheDocument();
    expect(screen.getByText('2 pets')).toBeInTheDocument();
  });

  it('Add to storage grants a fresh pet instance at its top legal value', async () => {
    const user = userEvent.setup();
    await openCatalog(user);
    await user.click(screen.getByRole('checkbox', { name: 'Select Dogmeat' }));
    await user.click(screen.getByRole('button', { name: 'Add to storage (1)' }));
    const pets = inventory().filter((i) => i.type === 'Pet');
    expect(pets).toHaveLength(1);
    expect(pets[0].id).toBe('dog_l');
    expect(pets[0].extraData?.bonusValue).toBe(10);
    expect(pets[0].extraData?.uniqueName).toBe('Dogmeat'); // named after the special name
  });

  it('the per-row Add button grants a single pet without multi-select', async () => {
    const user = userEvent.setup();
    await openCatalog(user);
    await user.click(screen.getByRole('button', { name: 'Add Dogmeat to storage' }));
    const pets = inventory().filter((i) => i.type === 'Pet');
    expect(pets).toHaveLength(1);
    expect(pets[0].id).toBe('dog_l');
  });

  it('equips a created pet onto the selected dweller', async () => {
    const user = userEvent.setup();
    await openCatalog(user);
    const dogRow = bodyRows().find((r) => within(r).queryByText('Dogmeat'));
    await user.click(within(dogRow as HTMLElement).getByRole('button', { name: 'Equip…' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Select Alice' }));
    await user.click(within(dialog).getByRole('button', { name: 'Equip on 1 dweller' }));
    expect(dwellerById(1)?.equippedPet?.id).toBe('dog_l');
  });
});
