import { defineConfig, devices } from '@playwright/test';

// Two e2e surfaces:
//  • chromium - full import→export loop against the dev server at root (`/`).
//  • subpath  - serves the BUILT dist under a GitHub Pages project subpath and asserts the
//    runtime game-data fetch resolves under it. This guards a past regression (asset paths
//    were hardcoded absolute `/gamedata`, which 404s on a project page); the dev server and
//    `vite preview` both serve from `/`, so only a non-root mount can catch it.
const PAGES_SUBPATH = '/fallout-shelter-save-editor/';
const PREVIEW_PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: ['importExport.spec.ts', 'seasonPass.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' },
    },
    {
      name: 'subpath',
      testMatch: 'subpathAssets.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${PREVIEW_PORT}${PAGES_SUBPATH}`,
      },
    },
  ],
  webServer: [
    {
      // Corepack works both locally (pnpm not on PATH) and in CI (after corepack enable).
      command: 'corepack pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
    {
      // Serve the BUILT site under a project subpath, exactly like a GitHub Pages project page.
      // `vite preview --base` mounts dist at the subpath; the build `base: './'` keeps assets
      // relative so they resolve under any mount without rebuilding.
      command: `corepack pnpm build && corepack pnpm preview --port ${PREVIEW_PORT} --strictPort --base ${PAGES_SUBPATH}`,
      url: `http://localhost:${PREVIEW_PORT}${PAGES_SUBPATH}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
