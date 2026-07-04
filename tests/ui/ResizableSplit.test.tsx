import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResizableSplit } from '../../src/ui/components/ResizableSplit.tsx';

// jsdom has no layout, so getBoundingClientRect returns 0 width and the clamp would pin
// every result to `min`. Stub a wide container so the keyboard-resize math is meaningful.
function withWideContainer(width = 1200): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height: 600,
    top: 0,
    left: 0,
    right: width,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

afterEach(() => vi.restoreAllMocks());

describe('ResizableSplit', () => {
  it('renders the divider with the current width as ARIA value', () => {
    render(
      <ResizableSplit
        ariaLabel="Resize panel"
        width={384}
        onWidthChange={() => {}}
        left={<div>left</div>}
        right={<div>right</div>}
      />,
    );
    const sep = screen.getByRole('separator', { name: 'Resize panel' });
    expect(sep).toHaveAttribute('aria-orientation', 'vertical');
    expect(sep).toHaveAttribute('aria-valuenow', '384');
    expect(sep).toHaveAttribute('aria-valuemin', '280');
    expect(sep).toHaveAttribute('aria-valuemax', '720');
  });

  it('collapses to the left pane only (no divider) when right is null', () => {
    render(
      <ResizableSplit
        ariaLabel="Resize panel"
        width={384}
        onWidthChange={() => {}}
        left={<div>left</div>}
        right={null}
      />,
    );
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.getByText('left')).toBeInTheDocument();
  });

  it('grows the right pane on ArrowLeft and shrinks on ArrowRight', async () => {
    withWideContainer();
    const onWidthChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ResizableSplit
        ariaLabel="Resize panel"
        width={384}
        onWidthChange={onWidthChange}
        left={<div>left</div>}
        right={<div>right</div>}
      />,
    );
    const sep = screen.getByRole('separator');
    sep.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onWidthChange).toHaveBeenLastCalledWith(400);
    await user.keyboard('{ArrowRight}');
    // The component is controlled at width=384, so each press recomputes from 384.
    expect(onWidthChange).toHaveBeenLastCalledWith(368);
  });

  it('clamps to min on Home and max on End', async () => {
    withWideContainer();
    const onWidthChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ResizableSplit
        ariaLabel="Resize panel"
        width={384}
        onWidthChange={onWidthChange}
        left={<div>left</div>}
        right={<div>right</div>}
      />,
    );
    screen.getByRole('separator').focus();
    await user.keyboard('{Home}');
    expect(onWidthChange).toHaveBeenLastCalledWith(280);
    await user.keyboard('{End}');
    expect(onWidthChange).toHaveBeenLastCalledWith(720);
  });
});
