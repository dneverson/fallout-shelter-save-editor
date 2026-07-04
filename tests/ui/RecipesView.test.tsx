import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipesView } from '../../src/ui/views/RecipesView.tsx';
import { useSaveStore } from '../../src/state/saveStore.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';

// Recipes catalog section: full recipe reference joined to weapon/outfit names, with
// bulk add/remove against `survivalW.recipes` and the theme get → build → apply lifecycle.
// Game data is mocked (no /gamedata fetch); jsdom has no layout, so render non-virtualized.

vi.mock('../../src/ui/hooks/useGameData.ts', () => ({
  useGameData: () => ({
    data: {
      unlockables: { recipes: ['Laser', 'BOSUniform', 'CafeteriaInstitute'] },
      weaponById: new Map([['Laser', { name: 'Laser Pistol' }]]),
      outfitById: new Map([['BOSUniform', { name: 'BOS Uniform' }]]),
    },
    status: 'ready',
    error: null,
  }),
}));

const save = () => useSaveStore.getState().save;
const recipes = () => save()?.survivalW?.recipes ?? [];
const themeList = () => save()?.survivalW?.collectedThemes?.themeList ?? [];
const themeByRoomType = () => save()?.specialTheme?.themeByRoomType ?? {};

const bodyRows = (): HTMLElement[] => {
  const groups = screen.getAllByRole('rowgroup');
  return within(groups[1]).getAllByRole('row');
};
const rowFor = (text: string): HTMLElement =>
  bodyRows().find((r) => within(r).queryByText(text)) as HTMLElement;
const themeRow = (): HTMLElement => rowFor('Cafeteria: Institute');

beforeEach(() => {
  localStorage.clear();
  useSaveStore.setState({
    save: { survivalW: { recipes: [] } } as SaveData,
    fileName: 'Vault1.sav',
    status: 'loaded',
    past: [],
    future: [],
  });
});

const renderView = () => render(<RecipesView virtualized={false} />);

describe('RecipesView', () => {
  it('renders the joined recipe catalog with a count', () => {
    renderView();
    expect(screen.getByText('Laser Pistol')).toBeInTheDocument();
    expect(screen.getByText('BOS Uniform')).toBeInTheDocument();
    expect(screen.getByText('Cafeteria: Institute')).toBeInTheDocument();
    expect(screen.getByText('3 recipes')).toBeInTheDocument();
  });

  it('select + Add to collection writes the chosen ids to survivalW.recipes', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('checkbox', { name: 'Select Laser Pistol' }));
    await user.click(screen.getByRole('button', { name: 'Add to collection (1)' }));
    expect(recipes()).toContain('Laser');
  });

  it('each row has its own Add/Remove collection toggle', async () => {
    const user = userEvent.setup();
    renderView();
    const laser = rowFor('Laser Pistol');
    await user.click(within(laser).getByRole('button', { name: 'Add' }));
    expect(recipes()).toContain('Laser');

    // The button flips to Remove and toggles back off.
    await user.click(within(rowFor('Laser Pistol')).getByRole('button', { name: 'Remove' }));
    expect(recipes()).not.toContain('Laser');
  });

  it('theme Build crafts a themeList entry and learns the recipe', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(within(themeRow()).getByRole('button', { name: 'Build' }));
    expect(recipes()).toContain('CafeteriaInstitute');
    expect(themeList().some((t) => t.id === 'CafeteriaInstitute')).toBe(true);
    // Built ⇒ shown as known: the collection toggle now offers Remove.
    expect(within(themeRow()).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('Unlock all adds every missing recipe in one click, then disables', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'Unlock all (3)' }));
    expect(recipes()).toEqual(
      expect.arrayContaining(['Laser', 'BOSUniform', 'CafeteriaInstitute']),
    );
    expect(screen.getByRole('button', { name: 'Unlock all' })).toBeDisabled();
  });

  it('Build all themes crafts every unbuilt theme in one click, then disables', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'Build all themes (1)' }));
    expect(themeList().some((t) => t.id === 'CafeteriaInstitute')).toBe(true);
    expect(screen.getByRole('button', { name: 'Build all themes' })).toBeDisabled();
  });

  it('theme Apply themes the room type, and removal cascades it away', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(within(themeRow()).getByRole('button', { name: 'Apply' }));
    expect(themeByRoomType().Cafeteria).toBe('Institute');

    await user.click(screen.getByRole('checkbox', { name: 'Select Cafeteria: Institute' }));
    await user.click(screen.getByRole('button', { name: 'Remove from collection (1)' }));
    expect(recipes()).not.toContain('CafeteriaInstitute');
    expect(themeList().some((t) => t.id === 'CafeteriaInstitute')).toBe(false);
    expect(themeByRoomType().Cafeteria).not.toBe('Institute');
  });
});
