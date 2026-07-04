import { createHashRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { SectionRedirect, SectionRoute } from './routing/SectionRoute.tsx';

// Hash-based router. Hash routing - not the History API - because the app
// is a client-only SPA deployed to static hosts at arbitrary paths (base:'./', e.g. a
// GitHub Pages project subpath). The hash never reaches the server, so reloads and deep
// links resolve to index.html with no SPA-fallback/rewrite config. Each top-level section
// is a route under the <App> shell; mouse/browser back-forward work for free via history.
//
// The optional `:detail` segment carries the master-detail selection (a dweller/room/pet),
// making selections deep-linkable. The URL is the single source of truth for it - views
// read `useParams()` rather than holding selection in a store. Both routes resolve to the
// same <SectionRoute>; the view inspects `detail` itself (only Dwellers/Family/Rooms/Pets
// have a meaningful selection).
export const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <SectionRedirect /> },
      // Single optional-param route (not two) so the view stays mounted when a selection is
      // added/cleared - only the `detail` param changes, no remount of table/scroll state.
      { path: ':section/:detail?', element: <SectionRoute /> },
      { path: '*', element: <SectionRedirect /> },
    ],
  },
]);
