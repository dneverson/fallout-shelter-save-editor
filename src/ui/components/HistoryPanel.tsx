import { useEffect, useMemo, useState } from 'react';
import { useSaveStore } from '../../state/saveStore.ts';
import { useSectionNavigate } from '../routing/useSectionNavigate.ts';
import { summarizeChanges, type ChangeSummary } from '../../domain/diff/changeSummary.ts';

// Slide-out undo-history timeline. Lists every point in the working
// session's history - the imported state, then each labelled edit - and lets you jump
// to any of them (saveStore.jumpTo). The current point is highlighted; points after it
// (reachable by redo) are dimmed. Each step past the import can be EXPANDED to show the
// granular changes that step made (derived on demand by diffing the two adjacent save
// snapshots - no journal is threaded through the ops), with dwellers deep-linked to
// their sheet. The panel sizes itself to its content (up to most of the viewport).

/** Dweller-name link that closes the panel and opens that dweller's sheet. */
function DwellerLink({
  id,
  name,
  onNavigate,
}: {
  id: number;
  name: string;
  onNavigate: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onNavigate(id);
      }}
      className="text-amber-300 underline-offset-2 hover:underline"
    >
      {name}
    </button>
  );
}

/** The granular per-step breakdown (computed from the two adjacent snapshots). */
function StepDetail({
  summary,
  onNavigate,
}: {
  summary: ChangeSummary;
  onNavigate: (id: number) => void;
}) {
  if (!summary.hasChanges) {
    return <p className="px-2 py-1 text-xs text-neutral-500">No visible field changes.</p>;
  }
  const fieldList = (fields: { label: string; before: string; after: string }[]): string =>
    fields.map((f) => `${f.label}: ${f.before} → ${f.after}`).join('; ');
  // Long id lists (e.g. "Unlock all recipes" adds 200+) show the first chunk + a count.
  const CAP = 25;
  const capped = (ids: string[]): string =>
    ids.length <= CAP
      ? ids.join(', ')
      : `${ids.slice(0, CAP).join(', ')} … and ${ids.length - CAP} more`;
  return (
    <ul className="flex flex-col gap-0.5 px-2 pb-1.5 text-xs text-neutral-400">
      {summary.dwellersAdded.map((d) => (
        <li key={`da-${d.serializeId}`}>
          <span className="text-emerald-400">+ Added dweller </span>
          <DwellerLink id={d.serializeId} name={d.name} onNavigate={onNavigate} />
        </li>
      ))}
      {summary.dwellersRemoved.map((d) => (
        <li key={`dr-${d.serializeId}`} className="text-red-400">
          − Removed dweller {d.name}
        </li>
      ))}
      {summary.dwellersModified.map((d) => (
        <li key={`dm-${d.serializeId}`}>
          <DwellerLink id={d.serializeId} name={d.name} onNavigate={onNavigate} />
          <span>: {fieldList(d.fields)}</span>
        </li>
      ))}
      {summary.roomsAdded.map((label) => (
        <li key={`ra-${label}`} className="text-emerald-400">
          + Built {label}
        </li>
      ))}
      {summary.roomsRemoved.map((label) => (
        <li key={`rr-${label}`} className="text-red-400">
          − Removed {label}
        </li>
      ))}
      {summary.roomsModified.map((r) => (
        <li key={`rm-${r.label}`}>
          <span className="text-neutral-300">{r.label}</span>
          <span>: {fieldList(r.fields)}</span>
        </li>
      ))}
      {summary.resourcesChanged.map((f) => (
        <li key={`res-${f.label}`}>
          <span className="text-neutral-300">{f.label}</span>: {f.before} → {f.after}
        </li>
      ))}
      {summary.itemsChanged.map((f) => (
        <li key={`item-${f.label}`}>
          <span className="text-neutral-300">{f.label}</span>: {f.before} → {f.after}
        </li>
      ))}
      {summary.boxesChanged.map((f) => (
        <li key={`box-${f.label}`}>
          <span className="text-neutral-300">{f.label}</span>: {f.before} → {f.after}
        </li>
      ))}
      {summary.recipesAdded.length > 0 && (
        <li>
          <span className="text-emerald-400">
            + Recipes unlocked ({summary.recipesAdded.length}):{' '}
          </span>
          <span className="break-words">{capped(summary.recipesAdded)}</span>
        </li>
      )}
      {summary.recipesRemoved.length > 0 && (
        <li>
          <span className="text-red-400">
            − Recipes removed ({summary.recipesRemoved.length}):{' '}
          </span>
          <span className="break-words">{capped(summary.recipesRemoved)}</span>
        </li>
      )}
      {summary.inventoryDelta && (
        <li>
          Storage items: {summary.inventoryDelta.before} → {summary.inventoryDelta.after}
        </li>
      )}
      {summary.otherChanges.map((c) => (
        <li key={`oc-${c.path}`}>
          <span className="font-mono text-neutral-300">{c.path}</span>: {c.before} → {c.after}
        </li>
      ))}
      {summary.otherChangesTruncated > 0 && (
        <li className="text-neutral-500">…and {summary.otherChangesTruncated} more changes</li>
      )}
    </ul>
  );
}

export function HistoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Select stable slices and derive the view here - a single object-returning selector
  // would allocate a new object each render and spin Zustand into an infinite loop.
  const past = useSaveStore((s) => s.past);
  const save = useSaveStore((s) => s.save);
  const future = useSaveStore((s) => s.future);
  const pastLabels = useSaveStore((s) => s.pastLabels);
  const currentLabel = useSaveStore((s) => s.currentLabel);
  const futureLabels = useSaveStore((s) => s.futureLabels);
  const jumpTo = useSaveStore((s) => s.jumpTo);
  const goTo = useSectionNavigate();

  // Which entry's granular breakdown is open. One at a time - the diff is derived on
  // demand from full save snapshots and eagerly diffing 100 steps would be wasteful.
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const { entries, currentIndex, snapshots } = useMemo(() => {
    const snaps = save ? [...past, save, ...future] : [...past, ...future];
    return {
      entries: [...pastLabels, currentLabel, ...futureLabels].map((label, index) => ({
        index,
        label,
      })),
      currentIndex: past.length,
      snapshots: snaps,
    };
  }, [past, save, future, pastLabels, currentLabel, futureLabels]);

  // The expanded step's diff: what changed FROM the previous snapshot TO this one.
  const expandedSummary = useMemo(() => {
    if (expandedIndex === null || expandedIndex === 0) return null;
    const from = snapshots[expandedIndex - 1];
    const to = snapshots[expandedIndex];
    return from && to ? summarizeChanges(from, to) : null;
  }, [expandedIndex, snapshots]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const navigateToDweller = (id: number): void => {
    onClose();
    goTo('dwellers', id);
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Edit history"
        className="absolute right-0 top-0 flex h-full w-max min-w-80 max-w-[90vw] flex-col border-l border-neutral-800 bg-neutral-900 shadow-xl"
      >
        <header className="flex items-center justify-between gap-6 border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-100">History</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history"
            className="rounded px-2 py-0.5 text-neutral-400 hover:text-neutral-100"
          >
            ✕
          </button>
        </header>

        <ol className="min-h-0 flex-1 overflow-auto p-2">
          {entries.map((entry) => {
            const isCurrent = entry.index === currentIndex;
            const isFuture = entry.index > currentIndex;
            const isExpanded = expandedIndex === entry.index;
            return (
              <li key={entry.index}>
                <div
                  className={`flex w-full items-center gap-1 rounded ${
                    isCurrent ? 'bg-amber-500/15' : ''
                  }`}
                >
                  {/* Expand the step's granular breakdown (step 0 is the import - no diff). */}
                  <button
                    type="button"
                    aria-label={isExpanded ? 'Hide step details' : 'Show step details'}
                    aria-expanded={isExpanded}
                    disabled={entry.index === 0}
                    onClick={() => setExpandedIndex(isExpanded ? null : entry.index)}
                    className="w-8 shrink-0 self-stretch rounded text-center text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:invisible"
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpTo(entry.index)}
                    aria-current={isCurrent ? 'true' : undefined}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1.5 text-left text-sm ${
                      isCurrent
                        ? 'font-medium text-amber-300'
                        : isFuture
                          ? 'text-neutral-400 hover:bg-neutral-800'
                          : 'text-neutral-300 hover:bg-neutral-800'
                    }`}
                  >
                    <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-neutral-400">
                      {entry.index}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-nowrap pr-2">{entry.label}</span>
                    {isCurrent && (
                      <span className="pr-1 text-[10px] uppercase text-amber-400">current</span>
                    )}
                  </button>
                </div>
                {isExpanded && expandedSummary && (
                  <div className="ml-6 border-l border-neutral-800">
                    <StepDetail summary={expandedSummary} onNavigate={navigateToDweller} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <p className="border-t border-neutral-800 px-4 py-2 text-[11px] text-neutral-400">
          Click ▸ on a step to see exactly what it changed. Click a step to jump there; editing from
          an earlier point discards the steps after it.
        </p>
      </aside>
    </div>
  );
}
