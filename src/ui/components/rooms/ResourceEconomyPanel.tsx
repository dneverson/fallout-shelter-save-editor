import type { EconomyStatus, ResourceLine } from '../../../domain/selectors/advisorSelectors.ts';
import { SectionToggle } from './SectionToggle.tsx';

// Per-resource economy, surfaced as a compact wrapping row of mini stat cards at the top of
// the Rooms map (moved from the former Advisor view, replacing its full table). Read-only:
// each card shows the resource's net rate at a glance, tinted by status; the full
// stock·prod·use breakdown is the card's hover tooltip. The advisory recommendations
// themselves now live per-room (alert badge + side panel).

const STATUS_CARD: Record<EconomyStatus, string> = {
  ok: 'border-green-600/40 bg-green-500/5',
  warn: 'border-amber-500/50 bg-amber-500/10',
  deficit: 'border-red-500/50 bg-red-500/10',
};
const STATUS_DOT: Record<EconomyStatus, string> = {
  ok: 'bg-green-500',
  warn: 'bg-amber-400',
  deficit: 'bg-red-500',
};
const STATUS_LABEL: Record<EconomyStatus, string> = {
  ok: 'Surplus',
  warn: 'Thin',
  deficit: 'Deficit',
};

const fmt = (n: number): string => (n === 0 ? '0' : n.toFixed(1));
const signed = (n: number): string => `${n >= 0 ? '+' : ''}${fmt(n)}`;

export function ResourceEconomyPanel({
  resources,
  collapsed = false,
  onToggleCollapsed,
}: {
  resources: ResourceLine[];
  /** Collapse the strip to its header line (more vertical room for the grid). */
  collapsed?: boolean;
  /** Wire the header's collapse toggle; omitted = plain static header. */
  onToggleCollapsed?: () => void;
}) {
  // Collapsed, surface any deficit/thin resource in the header so shrinking the strip
  // never hides a problem entirely.
  const troubled = resources.filter((r) => r.status !== 'ok');
  const hint =
    collapsed && troubled.length > 0
      ? troubled.map((r) => `${r.resource}: ${STATUS_LABEL[r.status].toLowerCase()}`).join(' · ')
      : undefined;
  return (
    <section>
      {onToggleCollapsed ? (
        <div className="mb-1.5">
          <SectionToggle
            label="Resource economy"
            collapsed={collapsed}
            onToggle={onToggleCollapsed}
            {...(hint ? { hint } : {})}
          />
        </div>
      ) : (
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Resource economy
        </h3>
      )}
      {collapsed ? null : (
        <div className="flex flex-wrap gap-1.5">
          {resources.map((line) => (
            <div
              key={line.resource}
              className={`min-w-[7rem] flex-1 rounded border px-2 py-1.5 ${STATUS_CARD[line.status]}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-xs font-medium text-neutral-200">
                  {line.resource}
                </span>
                <span className="flex items-center gap-1 text-[10px] text-neutral-400">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[line.status]}`}
                    aria-hidden
                  />
                  {STATUS_LABEL[line.status]}
                </span>
              </div>
              <div
                className={`mt-0.5 text-base font-semibold leading-none tabular-nums ${
                  line.net < 0 ? 'text-red-400' : 'text-green-400'
                }`}
              >
                {signed(line.net)}
                <span className="ml-0.5 text-[10px] font-normal text-neutral-500">net /min</span>
              </div>
              <dl className="mt-1.5 grid grid-cols-3 gap-x-1 text-[10px] leading-tight">
                <Metric label="Stock" value={Math.round(line.stock)} />
                <Metric label="Prod" value={fmt(line.production)} />
                <Metric label="Use" value={fmt(line.consumption)} />
              </dl>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="tabular-nums text-neutral-300">{value}</dd>
    </div>
  );
}
