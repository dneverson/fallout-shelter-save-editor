import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EquipOnDwellersDialog } from '../../src/ui/components/items/EquipOnDwellersDialog.tsx';
import type { DwellerRow } from '../../src/domain/selectors/dwellerSelectors.ts';

function row(serializeId: number, name: string, weaponName: string): DwellerRow {
  return {
    serializeId,
    name,
    lastName: '',
    gender: 2,
    level: 10,
    rarity: 'Normal',
    special: { S: 1, P: 2, E: 3, C: 4, I: 5, A: 6, L: 7 },
    happiness: 50,
    health: 100,
    maxHealth: 100,
    radiation: 0,
    isDead: false,
    pregnant: false,
    babyReady: false,
    weapon: { id: 'w', name: weaponName, damageMin: 1, damageMax: 2 },
    outfit: null,
    pet: null,
    location: { savedRoom: -1, roomType: null, row: null, col: null, label: 'At Door' },
  };
}

const DWELLERS: DwellerRow[] = [row(1, 'Alice', 'Laser Pistol'), row(2, 'Bob', 'Fist')];

function renderDialog(overrides: Partial<Parameters<typeof EquipOnDwellersDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <EquipOnDwellersDialog
      open
      onClose={onClose}
      slot="Weapon"
      itemName="Plasma Rifle"
      dwellers={DWELLERS}
      onConfirm={onConfirm}
      virtualized={false}
      {...overrides}
    />,
  );
  return { onConfirm, onClose };
}

describe('EquipOnDwellersDialog', () => {
  it('lists every dweller with location + current slot item so the choice is informed', () => {
    renderDialog();
    expect(screen.getByText('Equip Plasma Rifle')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Laser Pistol')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Fist')).toBeInTheDocument();
    // Location is shown (matters most for outfit choice - finding 9).
    expect(screen.getAllByText('At Door').length).toBe(2);
    // SPECIAL is now seven distinct sortable columns, not a joined string. Match the
    // Agility header specifically (word boundary) so it isn't confused with "Assignment".
    expect(screen.getByRole('columnheader', { name: /^A\b/ })).toBeInTheDocument();
    // Each dweller's distinct stat badges render (Alice/Bob share these values).
    expect(screen.getAllByTitle('1').length).toBe(2);
    expect(screen.getAllByTitle('7').length).toBe(2);
  });

  it('confirms with the selected dweller ids (single item → multiple dwellers)', async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = renderDialog();
    await user.click(screen.getByRole('checkbox', { name: 'Select Alice' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Bob' }));
    await user.click(screen.getByRole('button', { name: 'Equip on 2 dwellers' }));
    expect(onConfirm).toHaveBeenCalledWith([1, 2]);
    expect(onClose).toHaveBeenCalled();
  });

  it('select-all toggles every dweller', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Equip on 2 dwellers' }));
    expect(onConfirm).toHaveBeenCalledWith([1, 2]);
  });

  it('confirm is disabled until at least one dweller is selected', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /Equip on/ })).toBeDisabled();
  });
});
