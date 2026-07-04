import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Single source of truth for the app version: package.json. Injected as the compile-time
// constant __APP_VERSION__ so nothing else hardcodes a version - a version bump to
// package.json (see .github/workflows/release.yml) propagates everywhere on rebuild.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Client-only SPA: no backend, no proxy.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Relative base so the built site works when served from ANY path (a static host's
  // root, a GitHub Pages project subpath, etc.) without rebuilding.
  base: './',
  build: {
    // The PixiJS renderer is code-split (lazy DwellerPreview + dynamic thumbnail import),
    // so the initial chunk is the React/TanStack/Radix app core - legitimately ~575 kB.
    chunkSizeWarningLimit: 700,
  },
  plugins: [react(), tailwindcss()],
  test: {
    globals: true, // enables React Testing Library's automatic per-test cleanup
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    // Unit/integration tests use `.test.ts(x)`; Playwright e2e uses `.spec.ts`.
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
