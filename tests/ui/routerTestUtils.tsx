// Test-only helper module; Fast Refresh does not apply, so a local probe component can live
// alongside the render helper export.
/* eslint-disable react-refresh/only-export-components */
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

// A hidden probe that mirrors the current path into the DOM, so a test can assert that a
// cross-tab jump navigated (e.g. clicking "Craftable" -> `/recipes/Laser`). Read it with
// `screen.getByTestId('location').textContent`.
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location" hidden>{`${location.pathname}${location.search}`}</span>;
}

// Render a view inside the same `:section/:detail?` route the real hash router provides, so
// useParams()-driven selection (the deep-linkable master-detail) works in tests. Navigation
// inside the view (e.g. clicking a row -> /dwellers/42) re-matches the SAME route, so the
// view stays mounted and just sees the new `detail` param - exactly like production. The
// route element is fixed, so a jump to another section still renders `element`; assert the
// destination via the LocationProbe rather than the rendered view.
export function renderInSectionRoute(
  element: ReactElement,
  { initialPath = '/dwellers' }: { initialPath?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path=":section/:detail?"
          element={
            <>
              {element}
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}
