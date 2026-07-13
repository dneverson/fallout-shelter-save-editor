import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddSpecialDwellerDialog } from '../../src/ui/components/dwellers/AddSpecialDwellerDialog.tsx';
import type { UniqueDweller } from '../../src/domain/gamedata/schemas.ts';

// Multi-select add: tick any number of catalog rows (or click rows), one onAdd with
// every selected uniqueId. gameData is null here - names fall back to raw ids, which
// is all the selection flow needs.

function entry(name: string, lastName: string): UniqueDweller {
  return {
    name,
    lastName,
    gender: 2,
    stats: [1, 2, 3, 4, 5, 6, 7],
    outfitId: 'jobinvestigator',
    weaponId: '',
    skinColor: 4294923605,
    hairColor: 4278233700,
    hair: null,
    faceMask: null,
  } as UniqueDweller;
}

const CATALOG: Record<string, UniqueDweller> = {
  L_Max: entry('Max', 'Power'),
  L_Piper: entry('Piper', 'Wright'),
};

function renderDialog() {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(
    <AddSpecialDwellerDialog
      open
      onClose={onClose}
      catalog={CATALOG}
      gameData={null}
      onAdd={onAdd}
      virtualized={false}
    />,
  );
  return { onAdd, onClose };
}

describe('AddSpecialDwellerDialog', () => {
  it('adds every checked character in one confirm', async () => {
    const user = userEvent.setup();
    const { onAdd, onClose } = renderDialog();

    await user.click(screen.getByRole('checkbox', { name: 'Select Max Power' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Piper Wright' }));
    await user.click(screen.getByRole('button', { name: 'Add 2 dwellers' }));

    expect(onAdd).toHaveBeenCalledWith(['L_Max', 'L_Piper']);
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking a row toggles its selection', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderDialog();

    await user.click(screen.getByText('Max Power'));
    await user.click(screen.getByRole('button', { name: 'Add 1 dweller' }));

    expect(onAdd).toHaveBeenCalledWith(['L_Max']);
  });

  it('the add button is disabled until something is selected', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /^Add 0/ })).toBeDisabled();
  });
});
