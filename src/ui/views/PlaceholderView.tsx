import type { Section } from '../../state/uiStore.ts';

// Defensive fallback for an unrouted sidebar section (App.tsx). Every section ships a
// live view, so this is not reached in normal use; it stays as a graceful catch-all
// rather than rendering a blank screen if a future section is added to the nav before
// its view is wired.
export function PlaceholderView({ section }: { section: Section }) {
  return (
    <div className="p-8">
      <h2 className="text-lg font-semibold capitalize text-neutral-200">{section}</h2>
      <p className="mt-2 text-sm text-neutral-400">This section is not available yet.</p>
    </div>
  );
}
