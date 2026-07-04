import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeasonExportBar } from '../../src/ui/components/season/SeasonExportBar.tsx';
import { useSaveStore } from '../../src/state/saveStore.ts';
import { useUIStore } from '../../src/state/uiStore.ts';

// The bar no longer exports on its own - a single "Export" button opens the one shared export
// chooser (ExportDialog) via the uiStore `openExport` flag, the same mechanism the TopBar uses.
// So the tests cover the contextual labelling and that the button opens that shared dialog.

function setStore(over: Partial<ReturnType<typeof useSaveStore.getState>> = {}) {
  useSaveStore.setState({
    fileName: 'Vault1.sav',
    seasonSource: 'catalog',
    seasonFileName: null,
    ...over,
  });
}

beforeEach(() => {
  useUIStore.setState({ exportOpen: false });
  setStore();
});

describe('SeasonExportBar', () => {
  it('shows the file source for an uploaded spd.dat vs the catalog', () => {
    setStore({ seasonSource: 'file', seasonFileName: 'spd.dat' });
    const { rerender } = render(<SeasonExportBar />);
    expect(screen.getByText('Editing spd.dat')).toBeInTheDocument();

    setStore({ seasonSource: 'catalog' });
    rerender(<SeasonExportBar />);
    expect(screen.getByText(/New season pass/)).toBeInTheDocument();
  });

  it('opens the shared export dialog when Export is clicked', async () => {
    const user = userEvent.setup();
    render(<SeasonExportBar />);

    expect(useUIStore.getState().exportOpen).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(useUIStore.getState().exportOpen).toBe(true);
  });
});
