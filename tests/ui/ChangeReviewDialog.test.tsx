import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangeReviewDialog } from '../../src/ui/components/ChangeReviewDialog.tsx';
import type { ChangeSummary } from '../../src/domain/diff/changeSummary.ts';
import type { HealthReport } from '../../src/domain/health/healthCheck.ts';

const emptySummary: ChangeSummary = {
  dwellersAdded: [],
  dwellersRemoved: [],
  dwellersModified: [],
  roomsAdded: [],
  roomsRemoved: [],
  roomsModified: [],
  resourcesChanged: [],
  itemsChanged: [],
  boxesChanged: [],
  recipesAdded: [],
  recipesRemoved: [],
  guideChanged: [],
  inventoryDelta: null,
  otherChanges: [],
  otherChangesTruncated: 0,
  otherSectionsChanged: [],
  hasChanges: false,
};

const health: HealthReport = {
  metadata: { vaultName: '111', dwellerCount: 3, itemCount: 1, appVersion: '1.0' },
  issues: [{ severity: 'warning', message: '1 dweller(s) share a duplicate serializeId.' }],
};

function renderDialog(overrides: Partial<ComponentProps<typeof ChangeReviewDialog>> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    summary: emptySummary,
    health,
    exporting: false,
    error: null,
    fileName: 'Vault1.sav',
    includeSav: true,
    onIncludeSavChange: vi.fn(),
    seasonEdited: false,
    includeSeason: true,
    onIncludeSeasonChange: vi.fn(),
    isSandbox: false,
    hasOriginal: true,
    includeBackup: true,
    onIncludeBackupChange: vi.fn(),
    platform: 'pc' as const,
    onPlatformChange: vi.fn(),
    saveInPlaceSupported: false,
    ...overrides,
  };
  render(<ChangeReviewDialog {...props} />);
  return props;
}

describe('ChangeReviewDialog', () => {
  it('shows a condensed headline and reveals full detail behind "Show all changes"', async () => {
    const user = userEvent.setup();
    renderDialog({
      summary: {
        dwellersAdded: [{ serializeId: 4, name: 'New Comer' }],
        dwellersRemoved: [{ serializeId: 2, name: 'Bob' }],
        dwellersModified: [
          {
            serializeId: 1,
            name: 'Alice Cox',
            fields: [{ label: 'Level', before: '5', after: '50' }],
          },
        ],
        roomsAdded: [],
        roomsRemoved: [],
        roomsModified: [],
        resourcesChanged: [],
        itemsChanged: [],
        boxesChanged: [],
        recipesAdded: [],
        recipesRemoved: [],
        guideChanged: [],
        inventoryDelta: { before: 2, after: 1 },
        otherChanges: [],
        otherChangesTruncated: 0,
        otherSectionsChanged: [],
        hasChanges: true,
      },
    });

    // Condensed by default: counts + storage delta, but no per-field breakdown.
    expect(screen.getByText('Dwellers: 1 added, 1 removed, 1 edited')).toBeInTheDocument();
    expect(screen.getByText(/Storage items: 2 → 1/)).toBeInTheDocument();
    expect(screen.queryByText(/Level: 5 → 50/)).not.toBeInTheDocument();

    // Expanding reveals the granular change history.
    await user.click(screen.getByRole('button', { name: /Show all changes/i }));
    expect(screen.getByText('1 dweller(s) added')).toBeInTheDocument();
    expect(screen.getByText('1 dweller(s) removed')).toBeInTheDocument();
    expect(screen.getByText('1 dweller(s) edited')).toBeInTheDocument();
    expect(screen.getByText(/Level: 5 → 50/)).toBeInTheDocument();
  });

  it('shows the no-changes message, the health issue, and the backup option + revert help', () => {
    renderDialog();
    expect(screen.getByText(/No changes since import/)).toBeInTheDocument();
    expect(screen.getByText(/duplicate serializeId/)).toBeInTheDocument();
    expect(screen.getByText('A safety backup')).toBeInTheDocument();
    expect(screen.getByText(/If something goes wrong later/)).toBeInTheDocument();
  });

  it('confirm triggers onConfirm; cancel triggers onClose', async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(props.onConfirm).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('disables the export button while exporting', () => {
    renderDialog({ exporting: true });
    expect(screen.getByRole('button', { name: 'Exporting…' })).toBeDisabled();
  });

  it('hides the native save-dialog hint when save-in-place is unsupported', () => {
    renderDialog({ saveInPlaceSupported: false });
    expect(screen.queryByText(/window opens for your/i)).not.toBeInTheDocument();
  });

  it('shows the native save-dialog hint when save-in-place is supported', () => {
    renderDialog({ saveInPlaceSupported: true });
    expect(screen.getByText(/window opens for your/i)).toBeInTheDocument();
  });

  it('offers the season files only when season data was edited', () => {
    renderDialog({ seasonEdited: false });
    expect(screen.queryByText('Your season-pass progress')).not.toBeInTheDocument();

    renderDialog({ seasonEdited: true });
    expect(screen.getByText('Your season-pass progress')).toBeInTheDocument();
  });

  it('hides the backup for a sandbox save and explains why', () => {
    renderDialog({ isSandbox: true });
    expect(screen.queryByText('A safety backup')).not.toBeInTheDocument();
    expect(screen.getByText(/no original file to back up/i)).toBeInTheDocument();
  });

  it('hides the backup when there is no original to protect', () => {
    renderDialog({ hasOriginal: false });
    expect(screen.queryByText('A safety backup')).not.toBeInTheDocument();
  });

  it('offers a Save everything toggle that flips every available file at once', async () => {
    const user = userEvent.setup();
    const props = renderDialog({ seasonEdited: true });
    await user.click(screen.getByRole('checkbox', { name: /Save everything/i }));
    // All three available files are currently on, so the master toggle turns them all off.
    expect(props.onIncludeSavChange).toHaveBeenCalledWith(false);
    expect(props.onIncludeSeasonChange).toHaveBeenCalledWith(false);
    expect(props.onIncludeBackupChange).toHaveBeenCalledWith(false);
  });

  it('hides the Save everything toggle when only the vault save is on offer', () => {
    renderDialog({ seasonEdited: false, hasOriginal: false });
    expect(screen.queryByRole('checkbox', { name: /Save everything/i })).not.toBeInTheDocument();
  });

  it('disables export when nothing is selected', () => {
    renderDialog({
      includeSav: false,
      seasonEdited: false,
      includeBackup: false,
    });
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('toggling a file checkbox calls its change handler', async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    await user.click(screen.getByRole('checkbox', { name: /Vault save/i }));
    expect(props.onIncludeSavChange).toHaveBeenCalledWith(false);
  });
});
