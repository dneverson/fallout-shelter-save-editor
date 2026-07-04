import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoadoutPanel, type LoadoutRow } from '../../src/ui/components/bulk/LoadoutPanel.tsx';
import type { Outfit, Pet, Weapon } from '../../src/domain/gamedata/schemas.ts';

// jsdom has no layout, so the picker's DataTable virtualizer renders 0 rows; pass
// virtualized={false} and assert on the rendered content (the DataTable gotcha).

const outfit = (id: string, name: string, special: Partial<Outfit['special']>): Outfit => ({
  id,
  name,
  category: 0,
  special: { S: 0, P: 0, E: 0, C: 0, I: 0, A: 0, L: 0, ...special },
  hasHelmet: false,
  rarity: 'Rare',
  sprite: 'x',
  gender: null,
});

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

const pet = (id: string, name: string, bonus: string): Pet =>
  ({
    id,
    name,
    baseName: name,
    breed: 'Labrador',
    breedCode: 0,
    type: 'Dog',
    typeCode: 0,
    rarity: 'Legendary',
    rarityCode: 0,
    bonus,
    bonusCode: 0,
    bonusMin: 1,
    bonusMax: 3,
    sprite: 'x',
    headSprite: 'x',
    poolName: 'p',
    codeId: 0,
    sellPrice: 0,
    petCarrierOdds: 0,
    descriptionLocalization: '',
    isHidden: false,
    craftOnly: false,
    lunchboxOnly: false,
    sortIndex: 0,
  }) as Pet;

const OUTFITS: Outfit[] = [
  outfit('Heavy', 'Heavy Wasteland Gear', { S: 3 }),
  outfit('Lab', 'Lab Coat', { I: 5 }),
];
const WEAPONS: Weapon[] = [
  weapon('Laser', 'Laser Pistol', 5, 7),
  weapon('Plasma', 'Plasma Rifle', 10, 14),
];
const PETS: Pet[] = [pet('Dogmeat', 'Dogmeat', 'DamageBoost'), pet('Rex', 'Rex', 'HealthBoost')];

const ROW: LoadoutRow = {
  type: 'PowerRoom',
  name: 'Power Generator',
  primaryStat: 'Strength',
  statKey: 'S',
  dwellerIds: [11, 12],
  suggestedOutfitId: 'Heavy',
  suggestedWeaponId: 'Laser',
  suggestedPetId: null,
};

function renderPanel(overrides: Partial<Parameters<typeof LoadoutPanel>[0]> = {}) {
  const onApply = vi.fn();
  render(
    <LoadoutPanel
      rows={[ROW]}
      outfits={OUTFITS}
      weapons={WEAPONS}
      pets={PETS}
      onApply={onApply}
      virtualized={false}
      {...overrides}
    />,
  );
  return { onApply };
}

describe('LoadoutPanel - searchable pickers', () => {
  it('shows the suggested outfit/weapon names on the row buttons', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Power Generator outfit' })).toHaveTextContent(
      'Heavy Wasteland Gear',
    );
    expect(screen.getByRole('button', { name: 'Power Generator weapon' })).toHaveTextContent(
      'Laser Pistol',
    );
    expect(screen.getByRole('button', { name: 'Power Generator pet' })).toHaveTextContent(
      '(no pet)',
    );
  });

  it('pre-selects the suggested pet when the row has one', () => {
    renderPanel({ rows: [{ ...ROW, suggestedPetId: 'Rex' }] });
    expect(screen.getByRole('button', { name: 'Power Generator pet' })).toHaveTextContent('Rex');
  });

  it('opens the outfit picker with the Σ SPECIAL stat column and selects a different outfit', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Power Generator outfit' }));
    // The picker is the stat table, not a name-only list: the Σ header proves it.
    expect(screen.getByText('Σ')).toBeInTheDocument();
    expect(screen.getByText('Lab Coat')).toBeInTheDocument();

    await user.click(screen.getByText('Lab Coat'));
    // The row button now reflects the chosen outfit.
    expect(screen.getByRole('button', { name: 'Power Generator outfit' })).toHaveTextContent(
      'Lab Coat',
    );
  });

  it('lets a pet be chosen on its ability and includes it in the applied choice', async () => {
    const user = userEvent.setup();
    const { onApply } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Power Generator pet' }));
    expect(screen.getByText('Ability')).toBeInTheDocument(); // ability column present
    await user.click(screen.getByText('Dogmeat'));

    await user.click(screen.getByRole('button', { name: /Apply · 2/ }));
    expect(onApply).toHaveBeenCalledWith([11, 12], {
      outfitId: 'Heavy',
      weaponId: 'Laser',
      petId: 'Dogmeat',
    });
  });

  it('clears a slot via the picker reset action', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Power Generator weapon' }));
    await user.click(screen.getByRole('button', { name: 'Clear weapon' }));
    expect(screen.getByRole('button', { name: 'Power Generator weapon' })).toHaveTextContent(
      '(no weapon)',
    );
  });
});
