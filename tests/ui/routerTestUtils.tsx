import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Render a view inside the same `:section/:detail?` route the real hash router provides, so
// useParams()-driven selection (the deep-linkable master-detail) works in tests. Navigation
// inside the view (e.g. clicking a row -> /dwellers/42) re-matches the SAME route, so the
// view stays mounted and just sees the new `detail` param - exactly like production.
export function renderInSectionRoute(
  element: ReactElement,
  { initialPath = '/dwellers' }: { initialPath?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path=":section/:detail?" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}
