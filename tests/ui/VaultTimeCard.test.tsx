import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VaultTimeCard } from '../../src/ui/components/vault/VaultTimeCard.tsx';

function renderCard(overrides: Partial<Parameters<typeof VaultTimeCard>[0]> = {}) {
  const props = {
    canFastForward: true,
    clockAheadSeconds: 0,
    onFastForward: vi.fn(),
    dailyRewards: { total: 1, pending: 1, soonestSeconds: 7_200 },
    onMakeDailyRewardsClaimable: vi.fn(),
    ...overrides,
  };
  render(<VaultTimeCard {...props} />);
  return props;
}

describe('VaultTimeCard', () => {
  it('shows the untouched clock state and updates as fast-forwards accumulate', () => {
    renderCard();
    expect(screen.getByText(/unchanged from the imported save/i)).toBeInTheDocument();
  });

  it('shows the cumulative fast-forward as persistent feedback', () => {
    renderCard({ clockAheadSeconds: 86_400 + 8 * 3_600 });
    expect(screen.getByText(/1d 8h ahead of the imported save/i)).toBeInTheDocument();
  });

  it('fires one fast-forward per preset click with the right seconds', async () => {
    const user = userEvent.setup();
    const props = renderCard();
    await user.click(screen.getByRole('button', { name: '+1 h' }));
    expect(props.onFastForward).toHaveBeenCalledExactlyOnceWith(3_600, expect.any(String));
    await user.click(screen.getByRole('button', { name: '+1 w' }));
    expect(props.onFastForward).toHaveBeenLastCalledWith(7 * 86_400, expect.any(String));
  });

  it('applies the custom hours value', async () => {
    const user = userEvent.setup();
    const props = renderCard();
    const field = screen.getByRole('spinbutton', { name: /custom \(hours\)/i });
    await user.clear(field);
    await user.type(field, '36');
    await user.tab(); // NumberField commits on blur
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(props.onFastForward).toHaveBeenCalledExactlyOnceWith(36 * 3_600, 'Fast-forward +36h');
  });

  it('disables the fast-forward controls when the save has no readable clock', () => {
    renderCard({ canFastForward: false, clockAheadSeconds: null });
    for (const name of ['+1 h', '+8 h', '+1 d', '+1 w', 'Apply']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByText(/not readable in this save/i)).toBeInTheDocument();
  });

  it('offers the daily-reward reset with a countdown while one is pending', async () => {
    const user = userEvent.setup();
    const props = renderCard();
    expect(screen.getByText(/next reward in 2h 0m/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /make claimable now/i }));
    expect(props.onMakeDailyRewardsClaimable).toHaveBeenCalledOnce();
  });

  it('explains an already-claimable timer instead of showing a dead button', () => {
    renderCard({ dailyRewards: { total: 1, pending: 0, soonestSeconds: null } });
    expect(screen.queryByRole('button', { name: /make claimable now/i })).not.toBeInTheDocument();
    expect(screen.getByText(/already claimable/i)).toBeInTheDocument();
  });

  it('explains an absent timer (the game creates it claimable on load)', () => {
    renderCard({ dailyRewards: { total: 0, pending: 0, soonestSeconds: null } });
    expect(screen.queryByRole('button', { name: /make claimable now/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no timer recorded/i)).toBeInTheDocument();
  });
});
