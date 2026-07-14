import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SurvivalGuideView } from '../../src/ui/views/SurvivalGuideView.tsx';
import { useSaveStore } from '../../src/state/saveStore.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';

// Survival Guide section: the game-data collection catalog joined to per-save
// `survivalW` list state, with row + bulk Collect / Mark seen / Remove actions.
// Game data is mocked (no /gamedata fetch); jsdom has no layout, so render
// non-virtualized.

vi.mock('../../src/ui/hooks/useGameData.ts', () => ({
  useGameData: () => ({
    data: {
      weapons: [{ id: 'LaserPistol', name: 'Laser Pistol', rarity: 'Rare', codeId: '24' }],
      outfits: [
        { id: 'BOSUniform', name: 'BOS Uniform', rarity: 'Rare', category: 2, codeId: '103' },
      ],
      junk: [{ id: 'AlarmClock', name: 'Alarm Clock', rarity: 'Normal', codeId: 'AlarmClock' }],
      pets: [
        {
          id: 'cx404_l',
          name: 'German Shepherd',
          baseName: 'Dogmeat',
          breedCode: 5,
          rarity: 'Legendary',
          rarityCode: 4,
          codeId: 77,
        },
      ],
      uniqueDwellers: { L_NickValentine: { name: 'Nick', lastName: 'Valentine' } },
      enums: { EPetBreed: { GermanShepherd: 5 } },
    },
    status: 'ready',
    error: null,
  }),
}));

const save = () => useSaveStore.getState().save;
const list = (key: 'weapons' | 'outfits' | 'dwellers' | 'pets' | 'breeds' | 'junk') =>
  save()?.survivalW?.[key] ?? [];

const bodyRows = (): HTMLElement[] => {
  const groups = screen.getAllByRole('rowgroup');
  return within(groups[1]).getAllByRole('row');
};
const rowFor = (text: string): HTMLElement =>
  bodyRows().find((r) => within(r).queryByText(text)) as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  useSaveStore.setState({
    save: { survivalW: { weapons: ['N24'] } } as SaveData,
    fileName: 'Vault1.sav',
    status: 'loaded',
    past: [],
    future: [],
  });
});

const renderView = () => render(<SurvivalGuideView virtualized={false} />);

describe('SurvivalGuideView', () => {
  it('renders every category with the collected count', () => {
    renderView();
    expect(screen.getByText('Laser Pistol')).toBeInTheDocument();
    expect(screen.getByText('BOS Uniform')).toBeInTheDocument();
    expect(screen.getByText('Nick Valentine')).toBeInTheDocument();
    expect(screen.getByText('Dogmeat (German Shepherd)')).toBeInTheDocument();
    expect(screen.getByText('Alarm Clock')).toBeInTheDocument();
    // 6 rows (weapon/outfit/dweller/pet/breed/junk), only the N24 weapon collected.
    expect(screen.getByText('1/6 collected')).toBeInTheDocument();
  });

  it('row Collect writes an "N"-prefixed entry to the right survivalW list', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(
      within(rowFor('Nick Valentine')).getByRole('button', { name: 'Collect Nick Valentine' }),
    );
    expect(list('dwellers')).toEqual(['NL_NickValentine']);
  });

  it('row Mark seen flips N → O; Mark new flips it back', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(
      within(rowFor('Laser Pistol')).getByRole('button', { name: 'Mark Laser Pistol seen' }),
    );
    expect(list('weapons')).toEqual(['O24']);
    await user.click(
      within(rowFor('Laser Pistol')).getByRole('button', { name: 'Mark Laser Pistol new' }),
    );
    expect(list('weapons')).toEqual(['N24']);
  });

  it('row Remove drops the entry', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(
      within(rowFor('Laser Pistol')).getByRole('button', {
        name: 'Remove Laser Pistol from the guide',
      }),
    );
    expect(list('weapons')).toEqual([]);
  });

  it('Collect all fills every missing list in one edit, then disables', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'Collect all (5)' }));
    expect(list('weapons')).toEqual(['N24']); // untouched - was already collected
    expect(list('outfits')).toEqual(['N103']);
    expect(list('dwellers')).toEqual(['NL_NickValentine']);
    expect(list('pets')).toEqual(['N77']);
    expect(list('breeds')).toEqual(['N5']);
    expect(list('junk')).toEqual(['NAlarmClock']);
    expect(screen.getByRole('button', { name: 'Collect all' })).toBeDisabled();
    // One applyEdit == one undo step.
    expect(useSaveStore.getState().past).toHaveLength(1);
  });

  it('Mark all seen clears every NEW badge, then disables', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'Mark all seen (1)' }));
    expect(list('weapons')).toEqual(['O24']);
    expect(screen.getByRole('button', { name: 'Mark all seen' })).toBeDisabled();
  });

  it('selection bulk actions group mixed categories into one edit', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('checkbox', { name: 'Select BOS Uniform' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Alarm Clock' }));
    await user.click(screen.getByRole('button', { name: 'Collect (2)' }));
    expect(list('outfits')).toEqual(['N103']);
    expect(list('junk')).toEqual(['NAlarmClock']);
    expect(useSaveStore.getState().past).toHaveLength(1);
  });
});
