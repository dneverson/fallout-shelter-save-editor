import { lazy, Suspense } from 'react';
import type { Section } from '../state/uiStore.ts';

// Route-based code splitting keeps the initial bundle small. Each section view is its own
// lazy chunk, so the initial bundle is just the app shell (TopBar/Sidebar/Import) + the
// framework - not all 15 sections with their tables, dialogs, and canvas code. A view's
// chunk is fetched on first navigation to its section; <Suspense> shows a light placeholder
// (the section list lives in ui/routing/sections.ts - the single source of nav order).
// during the (local, fast) load. Named exports are mapped to `default` for React.lazy.
const VaultView = lazy(() =>
  import('./views/VaultView.tsx').then((m) => ({ default: m.VaultView })),
);
const AdvancedView = lazy(() =>
  import('./views/AdvancedView.tsx').then((m) => ({ default: m.AdvancedView })),
);
const DwellersView = lazy(() =>
  import('./views/DwellersView.tsx').then((m) => ({ default: m.DwellersView })),
);
const FamilyTreeView = lazy(() =>
  import('./views/FamilyTreeView.tsx').then((m) => ({ default: m.FamilyTreeView })),
);
const RoomsView = lazy(() =>
  import('./views/RoomsView.tsx').then((m) => ({ default: m.RoomsView })),
);
const WeaponsView = lazy(() =>
  import('./views/WeaponsView.tsx').then((m) => ({ default: m.WeaponsView })),
);
const OutfitsView = lazy(() =>
  import('./views/OutfitsView.tsx').then((m) => ({ default: m.OutfitsView })),
);
const RecipesView = lazy(() =>
  import('./views/RecipesView.tsx').then((m) => ({ default: m.RecipesView })),
);
const SurvivalGuideView = lazy(() =>
  import('./views/SurvivalGuideView.tsx').then((m) => ({ default: m.SurvivalGuideView })),
);
const PetsView = lazy(() => import('./views/PetsView.tsx').then((m) => ({ default: m.PetsView })));
const HandiesView = lazy(() =>
  import('./views/HandiesView.tsx').then((m) => ({ default: m.HandiesView })),
);
const JunkView = lazy(() => import('./views/JunkView.tsx').then((m) => ({ default: m.JunkView })));
const StorageView = lazy(() =>
  import('./views/StorageView.tsx').then((m) => ({ default: m.StorageView })),
);
const QuestsView = lazy(() =>
  import('./views/QuestsView.tsx').then((m) => ({ default: m.QuestsView })),
);
const BulkView = lazy(() => import('./views/BulkView.tsx').then((m) => ({ default: m.BulkView })));
const SeasonPassView = lazy(() =>
  import('./views/SeasonPassView.tsx').then((m) => ({ default: m.SeasonPassView })),
);
const PlaceholderView = lazy(() =>
  import('./views/PlaceholderView.tsx').then((m) => ({ default: m.PlaceholderView })),
);

function ViewLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-neutral-400">Loading…</div>
  );
}

function renderSection(section: Section) {
  if (section === 'dwellers') return <DwellersView />;
  if (section === 'family') return <FamilyTreeView />;
  if (section === 'rooms') return <RoomsView />;
  if (section === 'weapons') return <WeaponsView />;
  if (section === 'outfits') return <OutfitsView />;
  if (section === 'recipes') return <RecipesView />;
  if (section === 'survival-guide') return <SurvivalGuideView />;
  if (section === 'pets') return <PetsView />;
  if (section === 'handies') return <HandiesView />;
  if (section === 'junk') return <JunkView />;
  if (section === 'storage') return <StorageView />;
  if (section === 'quests') return <QuestsView />;
  if (section === 'bulk') return <BulkView />;
  if (section === 'season-pass') return <SeasonPassView />;
  if (section === 'advanced') return <AdvancedView />;
  if (section === 'vault') return <VaultView />;
  return (
    <div className="h-full overflow-auto">
      <PlaceholderView section={section} />
    </div>
  );
}

// Maps a (validated) section id to its lazily-loaded view. Rendered by the router's section
// route (router.tsx) into the <App> shell's <Outlet>. Every sidebar section routes to a live
// view; the <PlaceholderView> fallback is a defensive catch-all for an unrouted section (it
// should never be reached in normal use).
export function SectionContent({ section }: { section: Section }) {
  return <Suspense fallback={<ViewLoading />}>{renderSection(section)}</Suspense>;
}
