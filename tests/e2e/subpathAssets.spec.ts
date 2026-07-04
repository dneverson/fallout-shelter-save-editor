import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encode } from '../../src/domain/codec/saveCodec.ts';

// Regression guard for runtime asset-path resolution. The built site is served under a
// GitHub Pages PROJECT subpath
// (see playwright.config.ts). Game data is fetched at runtime; when its base was hardcoded
// absolute (`/gamedata`) the fetch 404'd on a project page. This asserts the fetch now
// resolves UNDER the subpath and the catalog renders from it. The dev server / `vite preview`
// both serve from `/`, so this is the only surface that can catch the bug.
test('game data loads from the served subpath, not the domain root', async ({ page, baseURL }) => {
  const subpathPrefix = new URL(baseURL!).pathname; // '/fallout-shelter-save-editor/'

  // Minimal valid save - enough to flip the app into the loaded state so the Sidebar (which
  // triggers the game-data load) mounts.
  const save = {
    dwellers: { dwellers: [{ serializeId: 1, name: 'Subpath' }] },
    vault: { VaultName: 'SUB', storage: { resources: {} } },
    appVersion: '1.0',
  };
  const dir = mkdtempSync(join(tmpdir(), 'fsse-subpath-'));
  const inputPath = join(dir, 'Vault1.sav');
  writeFileSync(inputPath, await encode(save), 'utf8');

  // Capture the weapons.json fetch BEFORE it can fire (it loads on Sidebar mount, i.e. right
  // after import). The URL pattern is the core assertion: it must sit under the subpath.
  const weaponsResponse = page.waitForResponse((r) => /\/gamedata\/weapons\.json$/.test(r.url()));

  await page.goto('./');
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.locator('input[type="file"]').setInputFiles(inputPath);

  const res = await weaponsResponse;
  expect(res.status(), 'weapons.json must load (not 404) under the project subpath').toBe(200);
  expect(new URL(res.url()).pathname, 'fetch must resolve under the served subpath, not /').toBe(
    `${subpathPrefix}gamedata/weapons.json`,
  );

  // End-to-end: the parsed catalog renders a non-zero count, proving the JSON was fetched,
  // parsed, and wired through the UI under the subpath (a 404 would show "0 weapons").
  await page.getByRole('link', { name: 'Weapons' }).click();
  await expect(page.getByText(/[1-9]\d* weapons/).first()).toBeVisible();
});
