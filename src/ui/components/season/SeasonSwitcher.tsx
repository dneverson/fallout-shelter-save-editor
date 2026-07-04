import { seasonLabel } from './seasonText.ts';

// Season switcher: one pill per season, in catalog order. Selecting
// a pill changes which season's board you're VIEWING (local navigation - no edit/undo step);
// making a season active (`spd.currentSeason` + `nvf`) is a separate, explicit action in the
// status card. The currently-active season is marked so the two notions stay clear.

interface SeasonSwitcherProps {
  seasonIds: string[];
  /** The season currently being viewed/edited on the board. */
  viewed: string;
  /** The save's active season (`spd.currentSeason`). */
  active: string;
  onSelect: (id: string) => void;
}

export function SeasonSwitcher({ seasonIds, viewed, active, onSelect }: SeasonSwitcherProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {seasonIds.map((id) => {
        const isViewed = id === viewed;
        const isActive = id === active;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={isViewed}
            onClick={() => onSelect(id)}
            className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm transition-colors ${
              isViewed
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            {seasonLabel(id)}
            {isActive && (
              <span
                className="rounded bg-emerald-500/20 px-1 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300"
                title="The save's active season"
              >
                active
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
