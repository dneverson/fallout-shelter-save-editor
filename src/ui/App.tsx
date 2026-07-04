import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useSaveStore } from '../state/saveStore.ts';
import { isSection, rememberSection } from './routing/sections.ts';
import { DisclaimerDialog } from './components/DisclaimerDialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { ToastHost } from './components/ToastHost.tsx';
import { ImportView } from './views/ImportView.tsx';

const DISCLAIMER_KEY = 'fsse:disclaimer-accepted';

// App shell + layout route: disclaimer gate → import → top bar + sidebar
// nav + the active section's view (rendered into <Outlet> by the hash router). The active
// section lives in the URL; this only gates on disclaimer acceptance and whether a save is
// loaded.
export function App() {
  const [accepted, setAccepted] = useState(() => localStorage.getItem(DISCLAIMER_KEY) === '1');
  const hasSave = useSaveStore((s) => s.status === 'loaded');
  const location = useLocation();

  // Remember the last-visited section so a bare-root visit (no hash) reopens there. Take the
  // first path segment only - the URL may carry a `/:detail` selection (e.g. /dwellers/42).
  useEffect(() => {
    const segment = location.pathname.split('/')[1] ?? '';
    if (isSection(segment)) rememberSection(segment);
  }, [location.pathname]);

  const acceptDisclaimer = (): void => {
    localStorage.setItem(DISCLAIMER_KEY, '1');
    setAccepted(true);
  };

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      {/* Keyboard skip-link: first focusable element, visible on focus. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-amber-500 focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-neutral-900"
      >
        Skip to content
      </a>
      <TopBar />

      {accepted &&
        (hasSave ? (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <Sidebar />
            <main id="main-content" className="min-h-0 flex-1 overflow-hidden">
              <Outlet />
            </main>
          </div>
        ) : (
          <main id="main-content" className="min-h-0 flex-1 overflow-auto">
            <ImportView />
          </main>
        ))}

      <DisclaimerDialog open={!accepted} onAccept={acceptDisclaimer} />
      <ToastHost />
    </div>
  );
}
