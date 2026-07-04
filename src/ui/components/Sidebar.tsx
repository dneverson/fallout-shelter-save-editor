import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { useSaveStore } from '../../state/saveStore.ts';
import { useGameData } from '../hooks/useGameData.ts';
import { diagnose } from '../../domain/health/diagnostics.ts';
import { computeAdvisor } from '../../domain/selectors/advisorSelectors.ts';
import { SECTION_NAV } from '../routing/sections.ts';

// Left section nav. Each entry is a <NavLink> to that section's hash route
// (`#/<id>`); NavLink applies the active styling + aria-current="page" automatically, so
// browser/mouse back-forward stay in sync with the highlight.
//
// Two distinct badges (kept separate on purpose):
//   • Vault  - red: structural diagnostics (save-health issues, `diagnose`).
//   • Rooms  - amber: advisor recommendations (optimization tips, `computeAdvisor`). This
//     replaces the old top-bar "advisories" button.

export function Sidebar() {
  const save = useSaveStore((s) => s.save);
  const { data: gameData } = useGameData();

  // Live count of diagnosed issue types, shown as a red badge on the Vault entry (the
  // structural health check lives on the Vault overview).
  const diagCount = useMemo(() => (save ? diagnose(save).length : 0), [save]);
  // Advisor recommendation count, shown as an amber badge on the Rooms entry. Needs game
  // data (room production/capacity); 0 until it loads. Cheap O(rooms×dwellers), memoized.
  const advisorCount = useMemo(
    () => (save && gameData ? computeAdvisor(save, gameData).issueCount : 0),
    [save, gameData],
  );

  const badgeFor = (id: string): { count: number; tone: string; aria: string } | null => {
    if (id === 'vault' && diagCount > 0) {
      return {
        count: diagCount,
        tone: 'bg-red-500/80 text-neutral-950',
        aria: `${diagCount} structural issues`,
      };
    }
    if (id === 'rooms' && advisorCount > 0) {
      return {
        count: advisorCount,
        tone: 'bg-amber-500/80 text-neutral-950',
        aria: `${advisorCount} advisor recommendations`,
      };
    }
    return null;
  };

  // md+: the classic fixed left rail. Below md: a horizontally scrollable tab strip along
  // the top, so every section stays one tap away on phones without a hamburger detour.
  return (
    <nav
      aria-label="Sections"
      className="w-full shrink-0 border-b border-neutral-800 p-2 md:w-44 md:border-b-0 md:border-r"
    >
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:space-y-1 md:overflow-visible">
        {SECTION_NAV.map(({ id, label }) => {
          const badge = badgeFor(id);
          return (
            <li key={id}>
              <NavLink
                to={`/${id}`}
                className={({ isActive }) =>
                  `flex w-full items-center justify-between whitespace-nowrap rounded px-3 py-2 text-left text-sm ${
                    isActive
                      ? 'bg-amber-500/15 font-medium text-amber-300'
                      : 'text-neutral-300 hover:bg-neutral-800'
                  }`
                }
              >
                <span>{label}</span>
                {badge && (
                  <span
                    className={`ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${badge.tone}`}
                    aria-label={badge.aria}
                  >
                    {badge.count}
                  </span>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
