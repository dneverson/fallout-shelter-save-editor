import { test, expect, type Download } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decode, encode } from '../../src/domain/codec/saveCodec.ts';

// Full core loop in a real browser: disclaimer → import a .sav → export → verify the
// re-encoded download and the first-export auto-backup both decode back to the
// original (acceptance: import → export → re-import preserves data).
test('import → export round-trips the save and emits an auto-backup', async ({ page }) => {
  const original = {
    // `id` (the next-dweller counter) must be ≥ the highest serializeId or the health check
    // flags `dwellerIdCounterBehind`; keep the fixture structurally clean.
    dwellers: { id: 1, dwellers: [{ serializeId: 1, name: 'E2E' }] },
    vault: {
      VaultName: '321',
      inventory: { items: [{ id: 'TeddyBear', type: 'Junk' }] },
      storage: { resources: { Nuka: 7 } },
    },
    appVersion: '1.0',
  };

  const dir = mkdtempSync(join(tmpdir(), 'fsse-e2e-'));
  const inputPath = join(dir, 'Vault1.sav');
  writeFileSync(inputPath, await encode(original), 'utf8');

  // Force the download fallback by removing the File System Access API: Chromium otherwise
  // opens a native "save in place" picker for the edited file (which Playwright can't drive
  // and which emits no download event). With it gone, both the backup and the edited save go
  // through downloadText, so each surfaces as a capturable download.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'I understand and accept the risks' }).click();

  await page.locator('input[type="file"]').setInputFiles(inputPath);

  // Import lands on the default section; the structural-health summary lives on the Vault
  // overview, so open it to assert the save imported clean.
  await page.getByRole('link', { name: 'Vault' }).click();
  await expect(page.getByText('321')).toBeVisible();
  await expect(page.getByText('No structural issues detected.')).toBeVisible();

  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));

  // Export opens the change-review dialog; confirm it. The dialog's confirm button shares the
  // "Export" label with the toolbar button, so scope the second click to the dialog.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();

  // First export emits two files: the re-encoded save + the original backup.
  await expect.poll(() => downloads.length).toBeGreaterThanOrEqual(2);

  const exportDl = downloads.find((d) => d.suggestedFilename() === 'Vault1.sav');
  const backupDl = downloads.find((d) => d.suggestedFilename().includes('.backup-'));
  expect(exportDl, 'expected an exported Vault1.sav download').toBeTruthy();
  expect(backupDl, 'expected an auto-backup download').toBeTruthy();

  const exportedText = readFileSync(await exportDl!.path(), 'utf8');
  expect(await decode(exportedText)).toEqual(original);

  const backupText = readFileSync(await backupDl!.path(), 'utf8');
  expect(await decode(backupText)).toEqual(original);
});
