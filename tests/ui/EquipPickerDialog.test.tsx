import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EquipPickerDialog } from '../../src/ui/components/dwellers/EquipPickerDialog.tsx';
import { weaponSchema } from '../../src/ui/components/table/schemas/itemSchemas.tsx';
import type { Weapon } from '../../src/domain/gamedata/schemas.ts';

// jsdom has no layout, so the DataTable virtualizer renders 0 rows; pass
// virtualized={false} and assert on the rendered content (the DataTable gotcha).

const weapon = (id: string, name: string, damageMin: number, damageMax: number): Weapon => ({
  id,
  name,
  damageMin,
  damageMax,
  type: 0,
  tier: 1,
  rarity: 'Rare',
  sprite: 'x',
});

const WEAPONS: Weapon[] = [
  weapon('Laser', 'Laser Pistol', 5, 7),
  weapon('Plasma', 'Plasma Rifle', 10, 14),
];

function renderDialog(overrides: Partial<Parameters<typeof EquipPickerDialog<Weapon>>[0]> = {}) {
  const onEquip = vi.fn();
  const onReset = vi.fn();
  const onClose = vi.fn();
  render(
    <EquipPickerDialog<Weapon>
      open
      virtualized={false}
      onClose={onClose}
      title="Equip weapon"
      currentSummary="Laser Pistol"
      data={WEAPONS}
      schema={weaponSchema()}
      persistKey="test.equip.weapon"
      getRowId={(w) => w.id}
      equippedId="Laser"
      onEquip={onEquip}
      onReset={onReset}
      resetLabel="Reset to Fist"
      {...overrides}
    />,
  );
  return { onEquip, onReset, onClose };
}

describe('EquipPickerDialog', () => {
  it('renders the catalog rows and badges the equipped one', () => {
    renderDialog();
    expect(screen.getByText('Laser Pistol')).toBeInTheDocument();
    expect(screen.getByText('Plasma Rifle')).toBeInTheDocument();
    expect(screen.getByText('Equipped')).toBeInTheDocument();
  });

  it('equips the clicked row and closes', async () => {
    const user = userEvent.setup();
    const { onEquip, onClose } = renderDialog();
    await user.click(screen.getByText('Plasma Rifle'));
    expect(onEquip).toHaveBeenCalledWith('Plasma');
    expect(onClose).toHaveBeenCalled();
  });

  it('resets to default via the footer action', async () => {
    const user = userEvent.setup();
    const { onReset } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Reset to Fist' }));
    expect(onReset).toHaveBeenCalled();
  });
});
