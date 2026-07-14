import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CatalogTableView } from '../../src/ui/components/items/CatalogTableView.tsx';
import { weaponSchema } from '../../src/ui/components/table/schemas/itemSchemas.tsx';
import type { Weapon } from '../../src/domain/gamedata/schemas.ts';

// jsdom has no layout, so the DataTable virtualizer renders 0 rows; pass
// virtualized={false} and assert on the rendered content (the DataTable gotcha).

const weapon = (id: string, name: string): Weapon => ({
  id,
  name,
  damageMin: 1,
  damageMax: 2,
  type: 0,
  tier: 1,
  rarity: 'Rare',
  sprite: 'x',
  codeId: '0',
});

const WEAPONS: Weapon[] = [weapon('Laser', 'Laser Pistol'), weapon('Plasma', 'Plasma Rifle')];

const bodyRows = (): HTMLElement[] => {
  const groups = screen.getAllByRole('rowgroup');
  return within(groups[1]).getAllByRole('row');
};

function renderView(overrides: Partial<Parameters<typeof CatalogTableView<Weapon>>[0]> = {}) {
  const onAddToStorage = vi.fn();
  const onEquip = vi.fn();
  render(
    <CatalogTableView<Weapon>
      title="Weapons"
      unitNoun="weapons"
      data={WEAPONS}
      schema={weaponSchema()}
      persistKey="test.catalog.weapons"
      getRowId={(w) => w.id}
      getRowLabel={(w) => w.name}
      searchLabel="Search weapons"
      searchPlaceholder="Search weapons…"
      gameDataStatus="ready"
      onAddToStorage={onAddToStorage}
      onEquip={onEquip}
      virtualized={false}
      {...overrides}
    />,
  );
  return { onAddToStorage, onEquip };
}

describe('CatalogTableView', () => {
  it('renders the full catalog with a count', () => {
    renderView();
    expect(screen.getByText('Laser Pistol')).toBeInTheDocument();
    expect(screen.getByText('Plasma Rifle')).toBeInTheDocument();
    expect(screen.getByText('2 weapons')).toBeInTheDocument();
  });

  it('search narrows the catalog', async () => {
    const user = userEvent.setup();
    renderView();
    await user.type(screen.getByRole('searchbox', { name: 'Search weapons' }), 'plasma');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('Plasma Rifle')).toBeInTheDocument();
  });

  it('multi-select then Add to storage reports the selected ids with a default count of 1', async () => {
    const user = userEvent.setup();
    const { onAddToStorage } = renderView();
    await user.click(screen.getByRole('checkbox', { name: 'Select Laser Pistol' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Plasma Rifle' }));
    await user.click(screen.getByRole('button', { name: 'Add to storage (2)' }));
    expect(onAddToStorage).toHaveBeenCalledWith(
      expect.arrayContaining([
        { id: 'Laser', count: 1 },
        { id: 'Plasma', count: 1 },
      ]),
    );
    expect(onAddToStorage.mock.calls[0][0]).toHaveLength(2);
  });

  it('the per-row Add action reports that single item id with a default count of 1', async () => {
    const user = userEvent.setup();
    const { onAddToStorage } = renderView();
    const plasmaRow = bodyRows().find((r) => within(r).queryByText('Plasma Rifle'));
    await user.click(
      within(plasmaRow as HTMLElement).getByRole('button', { name: 'Add Plasma Rifle to storage' }),
    );
    expect(onAddToStorage).toHaveBeenCalledWith([{ id: 'Plasma', count: 1 }]);
  });

  it('the per-row count feeds the quantity passed to Add and survives the add', async () => {
    const user = userEvent.setup();
    const { onAddToStorage } = renderView();
    const plasmaRow = bodyRows().find((r) => within(r).queryByText('Plasma Rifle')) as HTMLElement;
    const countInput = within(plasmaRow).getByRole('spinbutton', { name: 'Count' });
    await user.clear(countInput);
    await user.type(countInput, '5');
    await user.tab(); // blur commits the buffered value
    await user.click(
      within(plasmaRow).getByRole('button', { name: 'Add Plasma Rifle to storage' }),
    );
    expect(onAddToStorage).toHaveBeenCalledWith([{ id: 'Plasma', count: 5 }]);
    // The count persists for repeated adds (it is not reset to 1).
    expect((countInput as HTMLInputElement).value).toBe('5');
  });

  it('the per-row Equip action reports that single item id', async () => {
    const user = userEvent.setup();
    const { onEquip } = renderView();
    const plasmaRow = bodyRows().find((r) => within(r).queryByText('Plasma Rifle'));
    await user.click(within(plasmaRow as HTMLElement).getByRole('button', { name: 'Equip…' }));
    expect(onEquip).toHaveBeenCalledWith('Plasma');
  });

  it('omits the Equip action when onEquip is not supplied (storage-only catalogs)', () => {
    // Junk has no equip slot: render without onEquip and assert the action is absent.
    render(
      <CatalogTableView<Weapon>
        title="Junk"
        unitNoun="junk"
        data={WEAPONS}
        schema={weaponSchema()}
        persistKey="test.catalog.junk"
        getRowId={(w) => w.id}
        searchLabel="Search junk"
        searchPlaceholder="Search junk…"
        gameDataStatus="ready"
        onAddToStorage={vi.fn()}
        virtualized={false}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Equip…' })).not.toBeInTheDocument();
  });
});
