import { useMemo } from 'react';
import { useSaveStore } from '../../state/saveStore.ts';
import { pushToast } from '../../state/toastStore.ts';
import { useGameData } from '../hooks/useGameData.ts';
import { useSectionNavigate } from '../routing/useSectionNavigate.ts';
import { diagnose, repairAll, type Diagnosis } from '../../domain/health/diagnostics.ts';
import { computeAdvisor } from '../../domain/selectors/advisorSelectors.ts';
import { computePopulationCap, vaultMetrics } from '../../domain/selectors/vaultSelectors.ts';

// Vault overview (the "Vault" section): save metadata + vault sustainability stats, plus the
// full structural-health diagnostics - the issue list with per-issue Fix + Fix-all (moved here
// from the former Diagnostics section, which only duplicated this screen's metadata). Each fix
// is a single undoable applyEdit; unknown fields are never touched.

const SEVERITY_STYLE: Record<Diagnosis['severity'], string> = {
  error: 'border-red-500/40 bg-red-500/10',
  warning: 'border-amber-500/40 bg-amber-500/10',
};
const SEVERITY_BADGE: Record<Diagnosis['severity'], string> = {
  error: 'bg-red-500/20 text-red-300',
  warning: 'bg-amber-500/20 text-amber-300',
};

export function SaveOverview() {
  const save = useSaveStore((s) => s.save);
  const metadata = useSaveStore((s) => s.health?.metadata);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const { data: gameData } = useGameData();
  const goToSection = useSectionNavigate();

  const issues = useMemo(() => (save ? diagnose(save) : []), [save]);
  const totalAffected = issues.reduce((n, d) => n + d.count, 0);
  // Vault sustainability & staffing stats (moved here from the former Advisor tab). Only the
  // delta vs. the metadata row above is shown - "Alive dwellers" overlaps the Dwellers tile.
  const advisor = useMemo(
    () => (save && gameData ? computeAdvisor(save, gameData) : null),
    [save, gameData],
  );
  // Overview tiles (rooms / population / pets / storage). The population cap is derived
  // from living quarters via the room-capacity catalog (200-ceiling fallback until game
  // data resolves). Vacant work slots need room capacity, so they're folded in from the
  // advisor's per-room analysis: empty slots across stat-driven rooms (statKey !== null
  // skips elevators / no-stat facilities).
  const metrics = useMemo(
    () => (save ? vaultMetrics(save, gameData?.roomCapacity) : null),
    [save, gameData],
  );
  // Dweller counts render as "X/cap" wherever they appear; count-only until the
  // room-capacity catalog resolves (no 200 fallback here - it would flash a wrong cap).
  const populationCap = useMemo(
    () => (save && gameData ? computePopulationCap(save, gameData.roomCapacity) : null),
    [save, gameData],
  );
  const vacantSlots = useMemo(
    () =>
      (advisor?.rooms ?? []).reduce(
        (n, r) => (r.statKey !== null ? n + Math.max(0, r.maxDwellers - r.assigned) : n),
        0,
      ),
    [advisor],
  );

  const fixOne = (d: Diagnosis): void => {
    applyEdit(d.repair, `Repair: ${d.title}`);
    pushToast(`Fixed: ${d.title}.`, 'success');
  };

  const fixAll = (): void => {
    applyEdit((s) => repairAll(s), 'Repair all issues');
    pushToast('Applied all repairs.', 'success');
  };

  return (
    <div>
      <h2 className="text-lg font-semibold">Vault overview</h2>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Vault"
          value={metadata?.vaultName ?? '–'}
          onClick={() => goToSection('rooms')}
        />
        <Stat
          label="Dwellers"
          value={
            metadata?.dwellerCount != null
              ? populationCap !== null
                ? `${metadata.dwellerCount}/${populationCap}`
                : metadata.dwellerCount
              : '–'
          }
          onClick={() => goToSection('dwellers')}
        />
        <Stat
          label="Total items"
          value={metadata?.itemCount ?? '–'}
          onClick={() => goToSection('storage')}
        />
        <Stat label="App version" value={metadata?.appVersion ?? '–'} />
        {advisor && (
          <>
            <Stat
              label="Advisories"
              value={advisor.issueCount}
              onClick={() => goToSection('rooms')}
            />
            <Stat
              label="Avg happiness"
              value={`${advisor.averageHappiness.toFixed(0)}%`}
              onClick={() => goToSection('dwellers')}
            />
            <Stat
              label="Happiness bonus"
              value={`+${(advisor.happinessBonus * 100).toFixed(0)}%`}
              onClick={() => goToSection('dwellers')}
            />
          </>
        )}
        {metrics && (
          <>
            <Stat label="Rooms" value={metrics.roomCount} onClick={() => goToSection('rooms')} />
            <Stat label="Vacant slots" value={vacantSlots} onClick={() => goToSection('rooms')} />
            <Stat
              label="Population"
              value={`${metrics.population}${populationCap !== null ? `/${populationCap}` : ''}`}
              onClick={() => goToSection('dwellers')}
            />
            <Stat
              label="Avg level"
              value={metrics.avgLevel.toFixed(0)}
              onClick={() => goToSection('dwellers')}
            />
            <Stat
              label="Pets owned"
              value={metrics.petsOwned}
              onClick={() => goToSection('storage', 'Pet')}
            />
            <Stat
              label="Weapons"
              value={metrics.weapons}
              onClick={() => goToSection('storage', 'Weapon')}
            />
            <Stat
              label="Outfits"
              value={metrics.outfits}
              onClick={() => goToSection('storage', 'Outfit')}
            />
            <Stat
              label="Junk"
              value={metrics.junk}
              onClick={() => goToSection('storage', 'Junk')}
            />
          </>
        )}
      </div>

      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium text-neutral-400">Health check</h3>
          {issues.length > 0 && (
            <button
              type="button"
              onClick={fixAll}
              className="rounded bg-amber-500 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-amber-400"
            >
              Fix all ({issues.length})
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-neutral-400">
          Structural checks on the loaded save. Each fix is a single undoable edit; unknown fields
          are never touched.
        </p>

        {issues.length === 0 ? (
          <div className="mt-4 rounded border border-green-500/40 bg-green-500/10 p-4 text-sm text-green-300">
            ✓ No structural issues detected. This save looks healthy.
          </div>
        ) : (
          <>
            <p className="mt-4 text-xs uppercase tracking-wide text-neutral-400">
              {issues.length} issue type(s) · {totalAffected} affected
            </p>
            <ul className="mt-2 space-y-3">
              {issues.map((d) => (
                <li key={d.kind} className={`rounded-lg border p-4 ${SEVERITY_STYLE[d.severity]}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${SEVERITY_BADGE[d.severity]}`}
                        >
                          {d.severity}
                        </span>
                        <h4 className="text-sm font-semibold text-neutral-100">{d.title}</h4>
                        <span className="text-xs text-neutral-400">×{d.count}</span>
                      </div>
                      <p className="mt-1.5 text-sm text-neutral-300">{d.detail}</p>
                      {d.details && d.details.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs text-neutral-400">
                          {d.details.map((line, i) => (
                            <li key={`${line.text}-${i}`}>
                              {line.text}
                              {line.dwellers?.map((dw) => (
                                <button
                                  key={dw.id}
                                  type="button"
                                  onClick={() => goToSection('dwellers', dw.id)}
                                  className="ml-2 text-amber-300 underline-offset-2 hover:underline"
                                >
                                  View {dw.name}
                                </button>
                              ))}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => fixOne(d)}
                      className="shrink-0 rounded border border-neutral-600 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
                    >
                      Fix
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string | number;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="block text-xs uppercase tracking-wide text-neutral-400">{label}</span>
      <span className="mt-1 block text-base text-neutral-100">{value}</span>
    </>
  );
  if (!onClick) {
    return <div className="rounded border border-neutral-800 bg-neutral-900/40 p-3">{body}</div>;
  }
  // Clickable tiles deep-link to the relevant section (overview → tab navigation).
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-neutral-800 bg-neutral-900/40 p-3 text-left transition-colors hover:border-amber-500/50 hover:bg-neutral-800/60"
    >
      {body}
    </button>
  );
}
