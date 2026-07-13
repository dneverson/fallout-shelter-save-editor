import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkActionBar } from '../../src/ui/components/dwellers/BulkActionBar.tsx';
import { useSaveStore } from '../../src/state/saveStore.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';

// The selection action bar drives one applyEdit per button over the selected
// serializeIds. Heal and Cure are independent: Heal restores health without touching
// radiation, Cure zeroes radiationValue without touching health.

function makeSave(): SaveData {
  return {
    dwellers: {
      dwellers: [
        {
          serializeId: 1,
          name: 'Alice',
          gender: 1,
          rarity: 'Normal',
          health: { healthValue: 50, maxHealth: 100, radiationValue: 30 },
        },
        {
          serializeId: 2,
          name: 'Bob',
          gender: 2,
          rarity: 'Normal',
          health: { healthValue: 80, maxHealth: 80, radiationValue: 45 },
        },
      ],
    },
  } as SaveData;
}

const dwellerById = (id: number) =>
  useSaveStore.getState().save?.dwellers?.dwellers.find((d) => d.serializeId === id);

beforeEach(() => {
  useSaveStore.setState({ save: makeSave(), status: 'loaded', past: [], future: [] });
});

describe('BulkActionBar - heal / cure', () => {
  it('Cure zeroes radiationValue for the selection without changing health', async () => {
    const user = userEvent.setup();
    render(<BulkActionBar selectedIds={[1, 2]} onClear={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Cure' }));

    expect(dwellerById(1)?.health?.radiationValue).toBe(0);
    expect(dwellerById(2)?.health?.radiationValue).toBe(0);
    // Health untouched (cure is NOT heal).
    expect(dwellerById(1)?.health?.healthValue).toBe(50);
    expect(dwellerById(2)?.health?.healthValue).toBe(80);
  });

  it('Heal restores health to max without touching radiation', async () => {
    const user = userEvent.setup();
    render(<BulkActionBar selectedIds={[1]} onClear={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Heal' }));

    expect(dwellerById(1)?.health?.healthValue).toBe(100);
    // Radiation untouched (heal is NOT cure).
    expect(dwellerById(1)?.health?.radiationValue).toBe(30);
  });
});

describe('BulkActionBar - remove selected', () => {
  it('hovering Remove shows the full scrubbing help as an on-screen tooltip', async () => {
    const user = userEvent.setup();
    render(<BulkActionBar selectedIds={[1, 2]} onClear={vi.fn()} />);
    // Viewport-clamped bubble, not a native `title` (which the page cannot keep on screen).
    await user.hover(screen.getByRole('button', { name: 'Remove (2)' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(/cleans up every trace/i);
  });

  it('shows the count on the button and only removes after confirming', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<BulkActionBar selectedIds={[1, 2]} onClear={onClear} />);

    // Count rendered on the red button; nothing removed before the dialog confirm.
    await user.click(screen.getByRole('button', { name: 'Remove (2)' }));
    expect(useSaveStore.getState().save?.dwellers?.dwellers).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Remove 2 dwellers' }));
    expect(useSaveStore.getState().save?.dwellers?.dwellers).toHaveLength(0);
    expect(onClear).toHaveBeenCalled();
    // One undo step for the whole batch.
    expect(useSaveStore.getState().past).toHaveLength(1);
  });

  it('cancelling the confirmation removes nothing', async () => {
    const user = userEvent.setup();
    render(<BulkActionBar selectedIds={[1]} onClear={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Remove (1)' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(useSaveStore.getState().save?.dwellers?.dwellers).toHaveLength(2);
    expect(useSaveStore.getState().past).toHaveLength(0);
  });
});
