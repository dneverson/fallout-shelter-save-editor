import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisastersCard } from '../../src/ui/components/vault/DisastersCard.tsx';

function renderCard(overrides: Partial<Parameters<typeof DisastersCard>[0]> = {}) {
  const props = {
    deathclaw: 'enabled' as const,
    deathclawRemaining: null,
    canToggleDeathclaw: true,
    onSetDeathclaw: vi.fn(),
    bottleAndCappy: true,
    onSetBottleAndCappy: vi.fn(),
    ...overrides,
  };
  render(<DisastersCard {...props} />);
  return props;
}

describe('DisastersCard', () => {
  it('shows the three deathclaw states', () => {
    renderCard();
    expect(screen.getByText(/attacks can occur/i)).toBeInTheDocument();
  });

  it('shows a natural cooldown with remaining time', () => {
    renderCard({ deathclaw: 'cooldown', deathclawRemaining: 900 });
    expect(screen.getByText(/natural cooldown, 15m 0s left/i)).toBeInTheDocument();
    // Still reads as ON: the cooldown is the game's own state, not our block.
    expect(screen.getByRole('switch', { name: /deathclaw attacks/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('shows the editor block distinctly', () => {
    renderCard({ deathclaw: 'disabled', deathclawRemaining: 4_000_000_000 });
    expect(screen.getByText(/blocked by this editor/i)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /deathclaw attacks/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('toggling deathclaws flips the current state', async () => {
    const user = userEvent.setup();
    const props = renderCard();
    await user.click(screen.getByRole('switch', { name: /deathclaw attacks/i }));
    expect(props.onSetDeathclaw).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('disables the deathclaw switch when the save has no task list', () => {
    renderCard({ canToggleDeathclaw: false });
    expect(screen.getByRole('switch', { name: /deathclaw attacks/i })).toBeDisabled();
  });

  it('toggles Bottle & Cappy and explains the off state', async () => {
    const user = userEvent.setup();
    const props = renderCard({ bottleAndCappy: false });
    expect(screen.getByText(/visits prevented/i)).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: /bottle & cappy/i }));
    expect(props.onSetBottleAndCappy).toHaveBeenCalledExactlyOnceWith(true);
  });
});
