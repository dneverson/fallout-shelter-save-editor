import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderInSectionRoute } from './routerTestUtils.tsx';
import userEvent from '@testing-library/user-event';
import { DwellersView } from '../../src/ui/views/DwellersView.tsx';
import { useSaveStore } from '../../src/state/saveStore.ts';
import { useUIStore } from '../../src/state/uiStore.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';

// jsdom has no layout, so render the roster non-virtualized to assert on row content.
// Game data is mocked away - the roster works on raw ids and
// the selectors' enrichment is covered by dwellerSelectors.test.ts.
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
          rarity: 'Legendary',
          savedRoom: -1,
          happiness: { happinessValue: 90 },
          health: { healthValue: 100, maxHealth: 100, radiationValue: 0 },
          experience: { currentLevel: 50, experienceValue: 0, needLvUp: false },
          stats: {
            stats: [stat(0), stat(5), stat(5), stat(5), stat(5), stat(5), stat(5), stat(5)],
          },
          equipedWeapon: { id: 'Laser', type: 'Weapon' },
        },
        {
          serializeId: 2,
          name: 'Bob',
          gender: 2,
          rarity: 'Normal',
          savedRoom: -1,
          happiness: { happinessValue: 20 },
          health: { healthValue: 0, maxHealth: 80, radiationValue: 0 },
          experience: { currentLevel: 1, experienceValue: 0, needLvUp: false },
          stats: {
            stats: [stat(0), stat(1), stat(1), stat(1), stat(1), stat(1), stat(1), stat(1)],
          },
        },
        {
          serializeId: 3,
          name: 'Carol',
          gender: 1,
          rarity: 'Rare',
          savedRoom: -1,
          happiness: { happinessValue: 60 },
          health: { healthValue: 50, maxHealth: 100, radiationValue: 0 },
          experience: { currentLevel: 25, experienceValue: 0, needLvUp: false },
          stats: {
            stats: [stat(0), stat(3), stat(3), stat(3), stat(3), stat(3), stat(3), stat(3)],
          },
        },
      ],
    },
  } as SaveData;
}

function dwellerById(id: number) {
  return useSaveStore.getState().save?.dwellers?.dwellers.find((d) => d.serializeId === id);
}

const bodyRows = (): HTMLElement[] => {
  const groups = screen.getAllByRole('rowgroup');
  return within(groups[1]).getAllByRole('row');
};

beforeEach(() => {
  localStorage.clear();
  useUIStore.setState({
    tableLayouts: {},
    dwellerGlobalFilter: '',
    dwellerColumnFilters: [],
    dwellerQuickFilters: {
      fistOnly: false,
      vaultSuitOnly: false,
      emptyPet: false,
      deadOnly: false,
    },
  });
  useSaveStore.setState({
    save: makeSave(),
    fileName: 'Vault1.sav',
    status: 'loaded',
    past: [],
    future: [],
  });
});

// Selection is URL-driven (#/dwellers/:id) and CharacterSheet → FamilyBlock uses router
// hooks, so render inside the real `:section/:detail?` route. Clicking a row navigates to
// /dwellers/:id and the sheet opens off the param, exactly like production.
const renderView = () => renderInSectionRoute(<DwellersView virtualized={false} />);

describe('DwellersView - rendering', () => {
  it('renders one row per dweller with names and SPECIAL badges', () => {
    renderView();
    expect(bodyRows()).toHaveLength(3);
    expect(screen.getByText('Alice Cox')).toBeInTheDocument();
    // SPECIAL badges: Alice's seven 5s render as badges (title carries the value).
    expect(screen.getAllByTitle('5').length).toBeGreaterThanOrEqual(7);
  });

  it('exposes the full name and weapon name as hover titles (finding 4)', () => {
    renderView();
    // Name + weapon cells truncate in narrow/compact layouts; the title carries the
    // complete text so it stays reachable on hover.
    expect(screen.getByTitle('Alice Cox')).toBeInTheDocument();
    expect(screen.getByTitle('Laser')).toBeInTheDocument();
  });
});

describe('DwellersView - filtering', () => {
  it('global search narrows to matching dwellers', async () => {
    const user = userEvent.setup();
    renderView();
    await user.type(screen.getByRole('searchbox', { name: /search dwellers/i }), 'alice');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('Alice Cox')).toBeInTheDocument();
  });

  it('the "Dead only" quick chip shows only dead dwellers', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'Dead only' }));
    const rows = bodyRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('Bob')).toBeInTheDocument();
  });

  it('a per-column range filter (Level ≥ 40) narrows the roster', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'Filter Level' }));
    await user.type(screen.getByRole('spinbutton', { name: 'level minimum' }), '40');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('Alice Cox')).toBeInTheDocument();
  });
});

describe('DwellersView - revive', () => {
  it('reviving a dead dweller restores full health via the store', async () => {
    const user = userEvent.setup();
    renderView();
    const bobRow = bodyRows().find((r) => within(r).queryByText('Bob'));
    expect(bobRow).toBeDefined();
    await user.click(within(bobRow as HTMLElement).getByRole('button', { name: 'Revive' }));
    expect(dwellerById(2)?.health?.healthValue).toBe(80);
  });
});

describe('DwellersView - bulk actions', () => {
  it('select-all reveals the bulk bar and Max SPECIAL maxes the selection', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByText(/3 selected/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Max SPECIAL' }));
    const stats = dwellerById(2)?.stats?.stats ?? [];
    expect(stats.slice(1, 8).map((s) => s.value)).toEqual([10, 10, 10, 10, 10, 10, 10]);
  });
});

describe('DwellersView - selection of a row', () => {
  it('clicking a row opens the detail placeholder for that dweller', async () => {
    const user = userEvent.setup();
    renderView();
    const aliceRow = bodyRows().find((r) => within(r).queryByText('Alice Cox'));
    await user.click(within(aliceRow as HTMLElement).getByText('Alice Cox'));
    expect(screen.getByRole('button', { name: 'Close detail panel' })).toBeInTheDocument();
  });
});

describe('DwellersView - add dweller', () => {
  it('adds a level-1 dweller through the store and opens it in the sheet', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: '+ Add dweller' }));

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'First name' }), 'New');
    await user.click(within(dialog).getByRole('button', { name: 'Add dweller' }));

    // serializeIds are 1..3 in the fixture, no counter → the new dweller is 4.
    const created = dwellerById(4);
    expect(created?.name).toBe('New');
    expect(created?.experience?.currentLevel).toBe(1);
    expect(created?.savedRoom).toBe(-1);
    // It opens in the sheet for further editing.
    expect(screen.getByRole('button', { name: 'Close detail panel' })).toBeInTheDocument();
  });
});
