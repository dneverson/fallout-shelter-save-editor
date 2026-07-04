import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JunkView } from '../../src/ui/views/JunkView.tsx';
import { useSaveStore } from '../../src/state/saveStore.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';

// Junk catalog section: storage-only (junk can't be equipped → no Equip action).
const JUNK = [
  { id: 'Caps', name: 'Bottle Caps', rarity: 'Common', sprite: 'x' },
  { id: 'Yoyo', name: 'Yo-yo', rarity: 'Rare', sprite: 'x' },
];

vi.mock('../../src/ui/hooks/useGameData.ts', () => ({
  useGameData: () => ({
    data: {
      enums: {},
      junk: JUNK,
      weaponById: new Map(),
      outfitById: new Map(),
      petById: new Map(),
    },
    status: 'ready',
    error: null,
  }),
}));

const inventory = () => useSaveStore.getState().save?.vault?.inventory?.items ?? [];

beforeEach(() => {
  localStorage.clear();
  useSaveStore.setState({
    save: { dwellers: { dwellers: [] } } as SaveData,
    fileName: 'Vault1.sav',
    status: 'loaded',
    past: [],
    future: [],
  });
});

describe('JunkView', () => {
  it('renders the junk catalog with no equip action', () => {
    render(<JunkView virtualized={false} />);
    expect(screen.getByText('Bottle Caps')).toBeInTheDocument();
    expect(screen.getByText('2 junk')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Equip…' })).not.toBeInTheDocument();
  });

  it('adds selected junk to storage', async () => {
    const user = userEvent.setup();
    render(<JunkView virtualized={false} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select Bottle Caps' }));
    await user.click(screen.getByRole('button', { name: 'Add to storage (1)' }));
    expect(inventory().map((i) => i.id)).toContain('Caps');
  });
});
