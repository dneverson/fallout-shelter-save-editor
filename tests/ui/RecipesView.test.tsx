import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInSectionRoute } from './routerTestUtils.tsx';
import { RecipesView } from '../../src/ui/views/RecipesView.tsx';
import { useSaveStore } from '../../src/state/saveStore.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';

// Recipes catalog section: full recipe reference joined to weapon/outfit names, with
// bulk add/remove against `survivalW.recipes` and the theme get → build → apply lifecycle.
// Game data is mocked (no /gamedata fetch); jsdom has no layout, so render non-virtualized.

vi.mock('../../src/ui/hooks/useGameData.ts', () => ({
  useGameData: () => ({
    data: {
      enums: {},
      unlockables: { recipes: ['Laser', 'BOSUniform', 'CafeteriaInstitute'] },
      weaponById: new Map([
        [
          'Laser',
          {
            id: 'Laser',
            name: 'Laser Pistol',
            damageMin: 5,
            damageMax: 7,
            type: 0,
            rarity: 'Rare',
          },
        ],
      ]),
      outfitById: new Map([
        [
          'BOSUniform',
          {
            id: 'BOSUniform',
            name: 'BOS Uniform',
            category: 0,
            rarity: 'Rare',
            special: { S: 0, P: 1, E: 0, C: 0, I: 2, A: 0, L: 0 },
          },
        ],
      ]),
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

const renderView = () =>
  renderInSectionRoute(<RecipesView virtualized={false} />, { initialPath: '/recipes' });

describe('RecipesView', () => {
  it('renders the joined recipe catalog with a count', () => {
    renderView();
    expect(screen.getByText('Laser Pistol')).toBeInTheDocument();
    expect(screen.getByText('BOS Uniform')).toBeInTheDocument();
    expect(screen.getByText('Cafeteria: Institute')).toBeInTheDocument();
    expect(screen.getByText('3 recipes')).toBeInTheDocument();
  });

  it('shows a rarity column joined from the item', () => {
    renderView();
    // Rarity comes from the joined weapon/outfit; the theme row has none.
    expect(within(rowFor('Laser Pistol')).getByText('Rare')).toBeInTheDocument();
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

  describe('detail side panel', () => {
    it('clicking a weapon recipe row opens the panel with the item stats', async () => {
      const user = userEvent.setup();
      renderView();
      await user.click(within(rowFor('Laser Pistol')).getByText('Laser Pistol'));
      const panel = screen.getByRole('complementary');
      expect(within(panel).getByText('5–7')).toBeInTheDocument(); // damage range
      expect(within(panel).getByRole('button', { name: 'Close recipe panel' })).toBeInTheDocument();
    });

    it('an outfit recipe panel jumps to the Outfits tab', async () => {
      const user = userEvent.setup();
      renderView();
      await user.click(within(rowFor('BOS Uniform')).getByText('BOS Uniform'));
      await user.click(screen.getByRole('button', { name: /View in Outfits tab/ }));
      expect(screen.getByTestId('location')).toHaveTextContent('/outfits/BOSUniform');
    });

    it('a weapon recipe panel jumps to the Weapons tab', async () => {
      const user = userEvent.setup();
      renderView();
      await user.click(within(rowFor('Laser Pistol')).getByText('Laser Pistol'));
      await user.click(screen.getByRole('button', { name: /View in Weapons tab/ }));
      expect(screen.getByTestId('location')).toHaveTextContent('/weapons/Laser');
    });

    it('adds/removes the recipe straight from the panel', async () => {
      const user = userEvent.setup();
      renderView();
      await user.click(within(rowFor('Laser Pistol')).getByText('Laser Pistol'));
      await user.click(
        within(screen.getByRole('complementary')).getByRole('button', {
          name: 'Add to collection',
        }),
      );
      expect(recipes()).toContain('Laser');
      // The panel now offers Remove; toggling it off removes the recipe again.
      await user.click(
        within(screen.getByRole('complementary')).getByRole('button', {
          name: 'Remove from collection',
        }),
      );
      expect(recipes()).not.toContain('Laser');
    });

    it('a theme recipe panel offers no jump (themes have no catalog item)', async () => {
      const user = userEvent.setup();
      renderView();
      await user.click(within(themeRow()).getByText('Cafeteria: Institute'));
      const panel = screen.getByRole('complementary');
      expect(within(panel).getByRole('button', { name: 'Close recipe panel' })).toBeInTheDocument();
      expect(within(panel).queryByRole('button', { name: /View in/ })).toBeNull();
    });
  });
});
