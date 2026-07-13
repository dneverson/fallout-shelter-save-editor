import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeasonClockCard } from '../../src/ui/components/season/SeasonClockCard.tsx';

function renderCard(overrides: Partial<Parameters<typeof SeasonClockCard>[0]> = {}) {
  const props = {
    offsetDays: 0,
    activeLabel: 'Institute',
    endDate: '2026-07-13' as string | null,
    onAdvanceDays: vi.fn(),
    onSkipToEnd: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<SeasonClockCard {...props} />);
  return props;
}

describe('SeasonClockCard', () => {
  it('shows real time at zero offset and the scheduled end date', () => {
    renderCard();
    expect(screen.getByText(/at real time/i)).toBeInTheDocument();
    expect(screen.getByText(/season scheduled to end 2026-07-13/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset to real time/i })).toBeDisabled();
  });

  it('shows the current offset and advances by days', async () => {
    const user = userEvent.setup();
    const props = renderCard({ offsetDays: 3 });
    expect(screen.getByText(/3 days ahead/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /\+7 days/i }));
    expect(props.onAdvanceDays).toHaveBeenCalledExactlyOnceWith(7);
    await user.click(screen.getByRole('button', { name: /reset to real time/i }));
    expect(props.onReset).toHaveBeenCalledOnce();
  });

  it('skips to end only when the catalog knows the end date', async () => {
    const user = userEvent.setup();
    const props = renderCard();
    await user.click(screen.getByRole('button', { name: /skip past end of season/i }));
    expect(props.onSkipToEnd).toHaveBeenCalledOnce();
  });

  it('disables the skip without an end date', () => {
    renderCard({ endDate: null });
    expect(screen.getByRole('button', { name: /skip past end of season/i })).toBeDisabled();
  });
});
