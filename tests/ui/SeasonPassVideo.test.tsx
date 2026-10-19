import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SeasonPassVideo } from '../../src/ui/components/season/SeasonPassVideo.tsx';

describe('SeasonPassVideo', () => {
  it('renders the playable YouTube embed and external link', () => {
    render(<SeasonPassVideo />);

    const iframe = screen.getByTitle('How to Collect ALL Season Rewards in Fallout Shelter');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/4EcW8tpcF2g');

    const ytLink = screen.getByRole('link', { name: /Open in YouTube/i });
    expect(ytLink).toBeInTheDocument();
    expect(ytLink).toHaveAttribute('href', 'https://youtu.be/4EcW8tpcF2g');
  });

  it('can be toggled between hidden and shown', async () => {
    const user = userEvent.setup();
    render(<SeasonPassVideo />);

    expect(
      screen.getByTitle('How to Collect ALL Season Rewards in Fallout Shelter'),
    ).toBeInTheDocument();

    const toggleBtn = screen.getByRole('button', { name: /Hide video/i });
    await user.click(toggleBtn);

    expect(
      screen.queryByTitle('How to Collect ALL Season Rewards in Fallout Shelter'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show video/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show video/i }));
    expect(
      screen.getByTitle('How to Collect ALL Season Rewards in Fallout Shelter'),
    ).toBeInTheDocument();
  });
});
