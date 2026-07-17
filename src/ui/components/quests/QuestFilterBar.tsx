import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Popover } from '../Popover.tsx';
import {
  questEnvironmentLabel,
  questRegionLabel,
  questSchemeName,
  questTypeLabel,
} from '../../../domain/quests/questDisplay.ts';
import {
  EMPTY_QUEST_FILTER,
  isFilterActive,
  type QuestFacetOptions,
  type QuestFilter,
  type QuestFlag,
  type QuestStatus,
  type RewardBucket,
} from '../../../domain/quests/questFilter.ts';
import type { QuestMapRegion } from '../../../domain/quests/questGraphLayout.ts';

// The Quests-tab filter bar: one dropdown per facet, mirroring the ColumnFilter look (funnel
// button, amber = active, checkbox lists). Purely presentational - it owns no filter state and
// derives no data; QuestsView holds the QuestFilter and does the filtering.
//
// Facet option lists are the catalog's enums, except questlines, which come from the loaded
// catalog and so arrive as a prop.

const DIFFICULTY_MIN = 0;
const DIFFICULTY_MAX = 60;

const STATUS_OPTIONS: { value: QuestStatus; label: string; hint: string }[] = [
  {
    value: 'inLog',
    label: 'In quest log',
    hint: 'Offered right now: the rotation + unlocked story steps',
  },
  { value: 'completed', label: 'Completed', hint: 'In the completion ledger' },
  { value: 'incomplete', label: 'Not completed', hint: 'Not in the ledger' },
  { value: 'skipped', label: 'Skipped', hint: 'Skipped out of a rotation' },
  { value: 'deployed', label: 'Team deployed', hint: 'A team is out on it right now' },
];

const QUEST_TYPES = [0, 1, 2, 3, 4, 5, 6];
const QUEST_SCHEMES = [0, 1, 2, 3, 4, 5];
const QUEST_ENVIRONMENTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const REGIONS: QuestMapRegion[] = ['chain', 'standalone', 'repeatable'];
const FLAG_OPTIONS: { value: QuestFlag; label: string; hint: string }[] = [
  { value: 'repeatable', label: 'Repeatable', hint: 'Can be replayed without un-completing' },
  { value: 'timeLimited', label: 'Time limited', hint: 'Has a start/end date window' },
  { value: 'hidden', label: 'Hidden', hint: 'Never shown in-game (m_isVisible = 0)' },
];
const REWARD_OPTIONS: { value: RewardBucket; label: string }[] = [
  { value: 'weapon', label: 'Weapons' },
  { value: 'outfit', label: 'Outfits' },
  { value: 'pet', label: 'Pets' },
  { value: 'dweller', label: 'Dwellers' },
  { value: 'junk', label: 'Junk' },
  { value: 'recipe', label: 'Recipes' },
  { value: 'recipeParts', label: 'Recipe parts' },
  { value: 'caps', label: 'Caps' },
  { value: 'quantum', label: 'Quantum' },
  { value: 'consumable', label: 'Stimpaks / RadAway' },
  { value: 'lunchbox', label: 'Lunchboxes' },
  { value: 'mrHandy', label: 'Mr. Handy' },
  { value: 'clue', label: 'Quest clues' },
  { value: 'pokerChip', label: 'Poker chips' },
];

function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function FunnelIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden="true">
      <path d="M1.5 2.5h13a.5.5 0 0 1 .4.8L10 9.2V13a.5.5 0 0 1-.28.45l-2.5 1.2A.5.5 0 0 1 6.5 14V9.2L1.1 3.3a.5.5 0 0 1 .4-.8Z" />
    </svg>
  );
}

/** A facet dropdown: funnel + label + selected-count badge, panel supplied by `children`. */
function FacetPopover({
  label,
  count,
  children,
  width = 'w-56',
}: {
  label: string;
  count: number;
  children: ReactNode;
  width?: string;
}): ReactElement {
  return (
    <Popover
      align="start"
      className={width}
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={`Filter by ${label}`}
          aria-pressed={count > 0}
          className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors ${
            count > 0
              ? 'border-amber-500 bg-amber-500/15 text-amber-300'
              : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
          }`}
        >
          <FunnelIcon />
          {label}
          {count > 0 && (
            <span className="rounded-full bg-amber-500/25 px-1.5 tabular-nums text-[10px]">
              {count}
            </span>
          )}
        </button>
      )}
    >
      {children}
    </Popover>
  );
}

/**
 * A checkbox list over one facet's options.
 *
 * `available` is the Excel cascade: values that no longer yield any match drop out of the list,
 * so you cannot build a filter that returns nothing. A ticked value always stays listed even if
 * it falls out of `available`, otherwise an active constraint could vanish with no way to clear it
 * - it shows 0, which is the honest answer for a tick that now matches nothing.
 *
 * Each value's number is how many quests ticking it would leave, chain context excluded.
 */
function CheckList<T extends string | number>({
  options,
  selected,
  onToggle,
  available,
  searchable = false,
}: {
  options: { value: T; label: string; hint?: string }[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  available: ReadonlyMap<T, number>;
  searchable?: boolean;
}): ReactElement {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const offered = options.filter((o) => available.has(o.value) || selected.includes(o.value));
    return needle === '' ? offered : offered.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, query, available, selected]);

  return (
    <div className="flex flex-col gap-1.5">
      {searchable && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find…"
          aria-label="Find option"
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 focus:border-amber-500/60 focus:outline-none"
        />
      )}
      {shown.length === 0 ? (
        <p className="px-1 py-2 text-xs text-neutral-400">No matches</p>
      ) : (
        <ul className="max-h-64 overflow-auto">
          {shown.map((o) => (
            <li key={String(o.value)}>
              <label
                title={o.hint}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-neutral-200 hover:bg-neutral-800"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={() => onToggle(o.value)}
                />
                <span className="truncate">{o.label}</span>
                <span className="ml-auto shrink-0 tabular-nums text-[10px] text-neutral-500">
                  {available.get(o.value) ?? 0}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface QuestFilterBarProps {
  filter: QuestFilter;
  onChange: (next: QuestFilter) => void;
  /** Per-facet values that still yield matches; drives the Excel-style cascading lists. */
  options: QuestFacetOptions;
  /** Lane titles from the loaded catalog. */
  questlineTitles: readonly string[];
  /** True when the save's daily/weekly rotation has lapsed (the log filter will look thin). */
  rotationExpired: boolean;
  /** Nodes drawn vs nodes in the unfiltered map, for the "showing X of Y" readout. */
  shown: number;
  total: number;
  /** Nodes that matched outright; `shown` minus this is the chain context dragged in around them. */
  matched: number;
}

export function QuestFilterBar({
  filter,
  onChange,
  options,
  questlineTitles,
  rotationExpired,
  shown,
  total,
  matched,
}: QuestFilterBarProps): ReactElement {
  const set = <K extends keyof QuestFilter>(key: K, value: QuestFilter[K]): void =>
    onChange({ ...filter, [key]: value });

  const active = isFilterActive(filter);
  const difficulty = filter.difficulty;

  const setDifficultyBound = (bound: 'min' | 'max', raw: string): void => {
    const base = difficulty ?? { min: DIFFICULTY_MIN, max: DIFFICULTY_MAX };
    const next = {
      ...base,
      [bound]: raw === '' ? (bound === 'min' ? DIFFICULTY_MIN : DIFFICULTY_MAX) : Number(raw),
    };
    const isWholeRange = next.min <= DIFFICULTY_MIN && next.max >= DIFFICULTY_MAX;
    set('difficulty', isWholeRange ? null : next);
  };

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <FacetPopover label="Status" count={filter.status.length}>
          <CheckList
            options={STATUS_OPTIONS}
            selected={filter.status}
            available={options.status}
            onToggle={(v) => set('status', toggleValue(filter.status, v))}
          />
        </FacetPopover>

        <FacetPopover label="Type" count={filter.types.length}>
          <CheckList
            options={QUEST_TYPES.map((t) => ({ value: t, label: questTypeLabel(t) }))}
            selected={filter.types}
            available={options.types}
            onToggle={(v) => set('types', toggleValue(filter.types, v))}
          />
        </FacetPopover>

        <FacetPopover label="Region" count={filter.regions.length}>
          <CheckList
            options={REGIONS.map((r) => ({ value: r, label: questRegionLabel(r) }))}
            selected={filter.regions}
            available={options.regions}
            onToggle={(v) => set('regions', toggleValue(filter.regions, v))}
          />
        </FacetPopover>

        <FacetPopover label="Questline" count={filter.questlines.length} width="w-64">
          <CheckList
            searchable
            options={questlineTitles.map((t) => ({ value: t, label: t }))}
            selected={filter.questlines}
            available={options.questlines}
            onToggle={(v) => set('questlines', toggleValue(filter.questlines, v))}
          />
        </FacetPopover>

        <FacetPopover label="Scheme" count={filter.schemes.length}>
          <CheckList
            options={QUEST_SCHEMES.map((s) => ({ value: s, label: questSchemeName(s) }))}
            selected={filter.schemes}
            available={options.schemes}
            onToggle={(v) => set('schemes', toggleValue(filter.schemes, v))}
          />
        </FacetPopover>

        <FacetPopover label="Environment" count={filter.environments.length}>
          <CheckList
            searchable
            options={QUEST_ENVIRONMENTS.map((e) => ({ value: e, label: questEnvironmentLabel(e) }))}
            selected={filter.environments}
            available={options.environments}
            onToggle={(v) => set('environments', toggleValue(filter.environments, v))}
          />
        </FacetPopover>

        <FacetPopover label="Rewards" count={filter.rewards.length}>
          <CheckList
            options={REWARD_OPTIONS}
            selected={filter.rewards}
            available={options.rewards}
            onToggle={(v) => set('rewards', toggleValue(filter.rewards, v))}
          />
        </FacetPopover>

        <FacetPopover label="Flags" count={filter.flags.length}>
          <CheckList
            options={FLAG_OPTIONS}
            selected={filter.flags}
            available={options.flags}
            onToggle={(v) => set('flags', toggleValue(filter.flags, v))}
          />
        </FacetPopover>

        <FacetPopover label="Difficulty" count={difficulty ? 1 : 0} width="w-52">
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-neutral-400">
              Matches any quest whose difficulty range overlaps this window.
            </p>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={DIFFICULTY_MIN}
                max={DIFFICULTY_MAX}
                value={difficulty?.min ?? ''}
                onChange={(e) => setDifficultyBound('min', e.target.value)}
                placeholder={`≥ ${DIFFICULTY_MIN}`}
                aria-label="Minimum difficulty"
                className="w-16 rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-xs text-neutral-100"
              />
              <span className="text-neutral-400">–</span>
              <input
                type="number"
                min={DIFFICULTY_MIN}
                max={DIFFICULTY_MAX}
                value={difficulty?.max ?? ''}
                onChange={(e) => setDifficultyBound('max', e.target.value)}
                placeholder={`≤ ${DIFFICULTY_MAX}`}
                aria-label="Maximum difficulty"
                className="w-16 rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-xs text-neutral-100"
              />
            </div>
          </div>
        </FacetPopover>

        <button
          type="button"
          onClick={() => onChange(EMPTY_QUEST_FILTER)}
          disabled={!active}
          className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear filters
        </button>

        {active && (
          <span className="tabular-nums text-[11px] text-neutral-400">
            {shown} of {total} shown · {matched} matched
          </span>
        )}
      </div>

      {active && (
        <p className="text-[11px] text-neutral-500">
          Quests with a bright, thick border are your matches, and the number beside each filter
          option is how many you would be left with. Matches pull in their whole chain, so
          prerequisites and follow-ups stay visible: completed steps stay green, and greyed ones are
          chain context you have not reached. Chain context never counts. Everything on the map
          stays clickable.
        </p>
      )}

      {rotationExpired && filter.status.includes('inLog') && (
        <p className="text-[11px] text-amber-500/90">
          This save&apos;s daily/weekly rotation has expired, so the log shows only story steps and
          the standalone quest. The game re-rolls the rotation when it loads the save.
        </p>
      )}
    </div>
  );
}
