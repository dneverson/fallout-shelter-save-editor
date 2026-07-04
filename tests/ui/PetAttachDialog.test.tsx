import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  PetAttachDialog,
  type CurrentPet,
} from '../../src/ui/components/dwellers/PetAttachDialog.tsx';
import type { PetRow } from '../../src/domain/selectors/petSelectors.ts';
import { parseGameData, type GameData } from '../../src/domain/gamedata/gameData.ts';

// A minimal but schema-valid game-data set: two Husky rarities (one breed, two
// rarities) so the Create-new breed/rarity selectors have something to resolve.
function pet(id: string, rarity: string, rarityCode: number, min: number, max: number) {
  return {
    id,
    name: 'Husky',
    baseName: 'Husky',
    breed: 'Husky',
    breedCode: 7,
    type: 'Dog',
    typeCode: 0,
    rarity,
    rarityCode,
    bonus: 'XPBoost',
    bonusCode: 2097152,
    bonusMin: min,
    bonusMax: max,
    sprite: 'x',
    headSprite: 'x',
    poolName: 'Dog001',
    codeId: 1,
    sellPrice: 100,
    petCarrierOdds: 0.01,
    descriptionLocalization: '',
    isHidden: false,
    craftOnly: false,
    lunchboxOnly: false,
    sortIndex: 1,
  };
}

function makeGameData(): GameData {
  return parseGameData({
    weapons: [],
    outfits: [],
    junk: [],
    pets: [pet('husky_c', 'Normal', 2, 6, 10), pet('husky_r', 'Rare', 3, 16, 20)],
    hair: [],
    enums: {},
    meta: { gameVersion: 't', unityVersion: 't', generatedAt: 't', counts: {} },
    unlockables: { recipes: [], roomUnlocks: [] },
    roomCapacity: {
      base: { resources: {}, items: 0, maxPetCount: 0, mrHandyHealth: 5000 },
      perDweller: {},
      rooms: {},
    },
    roomMetadata: { rooms: {} },
    roomProduction: {
      globals: {
        taskCycle: 0.1,
        noRushResourcesMultiplier: 1,
        foodConsumptionPerDweller: 0.06,
        waterConsumptionPerDweller: 0.06,
        dwellerConsumptionPeriod: 10,
        energyConsumptionPeriod: 8,
        happinessFactorList: [],
      },
      rooms: {},
    },
    uniqueDwellers: {},
  });
}

const OWNED: PetRow[] = [
  {
    rowId: 's:3',
    location: { kind: 'stored', index: 3 },
    id: 'persian_l',
    uniqueName: 'Mr. Pebbles',
    breed: 'Persian',
    type: 'Cat',
    rarity: 'Legendary',
    bonus: 'HappinessBoost',
    bonusValue: 95,
    bonusMax: 100,
    assignedTo: 'Storage',
  },
];

describe('PetAttachDialog - catalog', () => {
  it('mints + equips a fresh instance at the breed top value when a catalog row is clicked', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <PetAttachDialog
        onClose={() => {}}
        gameData={makeGameData()}
        ownedPets={[]}
        current={null}
        allowOutOfRange={false}
        onAssign={() => {}}
        onCreate={onCreate}
        onEdit={() => {}}
        onDetach={() => {}}
        onDelete={() => {}}
        virtualized={false}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Catalog' }));
    // Two breed×rarity rows both named "Husky"; the first is the Normal (husky_c) entry.
    await user.click(screen.getAllByText('Husky')[0]);
    expect(onCreate).toHaveBeenCalledWith({
      petId: 'husky_c',
      uniqueName: 'Husky',
      bonus: 'XPBoost',
      bonusValue: 10, // the top of the [6,10] range
    });
  });
});

describe('PetAttachDialog - owned', () => {
  it('reassigns the clicked owned pet onto this dweller', async () => {
    const user = userEvent.setup();
    const onAssign = vi.fn();
    render(
      <PetAttachDialog
        onClose={() => {}}
        gameData={makeGameData()}
        ownedPets={OWNED}
        current={null}
        allowOutOfRange={false}
        onAssign={onAssign}
        onCreate={() => {}}
        onEdit={() => {}}
        onDetach={() => {}}
        onDelete={() => {}}
        virtualized={false}
      />,
    );
    await user.click(screen.getByText('Mr. Pebbles'));
    expect(onAssign).toHaveBeenCalledWith(OWNED[0]);
  });
});

describe('PetAttachDialog - edit equipped', () => {
  it('edits the value and detaches, keeping the bonus locked', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDetach = vi.fn();
    const onDelete = vi.fn();
    const current: CurrentPet = {
      id: 'husky_r',
      uniqueName: 'Rex',
      bonus: 'XPBoost',
      bonusValue: 18,
    };
    render(
      <PetAttachDialog
        onClose={() => {}}
        gameData={makeGameData()}
        ownedPets={[]}
        current={current}
        allowOutOfRange={false}
        onAssign={() => {}}
        onCreate={() => {}}
        onEdit={onEdit}
        onDetach={onDetach}
        onDelete={onDelete}
        virtualized={false}
      />,
    );
    const value = screen.getByRole('spinbutton', { name: 'Bonus value' });
    await user.clear(value);
    await user.type(value, '20');
    await user.tab();
    expect(onEdit).toHaveBeenCalledWith({ bonusValue: 20 });
    await user.click(screen.getByRole('button', { name: /Detach pet/ }));
    expect(onDetach).toHaveBeenCalled();
  });

  it('deletes the equipped pet outright when Delete pet is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const current: CurrentPet = {
      id: 'husky_r',
      uniqueName: 'Rex',
      bonus: 'XPBoost',
      bonusValue: 18,
    };
    render(
      <PetAttachDialog
        onClose={() => {}}
        gameData={makeGameData()}
        ownedPets={[]}
        current={current}
        allowOutOfRange={false}
        onAssign={() => {}}
        onCreate={() => {}}
        onEdit={() => {}}
        onDetach={() => {}}
        onDelete={onDelete}
        virtualized={false}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Delete pet' }));
    expect(onDelete).toHaveBeenCalled();
  });
});
