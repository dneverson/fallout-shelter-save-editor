import type { ReactNode } from 'react';
import type { Quest } from '../../../domain/gamedata/schemas.ts';
import { isReactivatingEventQuest } from '../../../domain/quests/questCompletion.ts';
import {
  formatRequirement,
  questEnvironmentLabel,
  questRegionLabel,
  questSchemeLabel,
  questSchemeName,
  questSeason,
  questSeasonId,
  questTypeLabel,
  type RewardChip,
} from '../../../domain/quests/questDisplay.ts';
import type { QuestStatus } from '../../../domain/quests/questFilter.ts';
import type { QuestMapRegion } from '../../../domain/quests/questGraphLayout.ts';
import { seasonLabel } from '../season/seasonText.ts';
import { RewardChips } from './RewardChips.tsx';

// Selected-quest detail panel (master-detail in the Quests tab), following the RecipeSidePanel
// conventions: amber uppercase section headers, a meta box grid, a right-hand overlay on mobile
// from the parent ResizableSplit. Shows every captured quest field as read-only display; the one
// editable action is completion (mark complete grants loot; mark incomplete is tip-only, 5.7).
//
// EVERY FILTER FACET IS ANSWERED HERE. A facet the panel omits is a question the user can ask the
// map but not the quest: filtering to Environment=Cave and clicking a result used to leave them no
// way to confirm WHY it matched. So Status, Type, Region, Questline, Scheme, Environment, Rewards,
// Flags and Difficulty each have a badge or a Details row, and the values come from the filter's
// own helpers (questStatuses, regionOf) rather than a second reading of the same save fields.

const BOX = 'rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400/80">
        {title}
      </h4>
      {children}
    </section>
  );
}

function StatRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="text-neutral-400">{label}</span>
      <span title={title} className="text-right font-medium text-neutral-100">
        {value}
      </span>
    </div>
  );
}

function Badge({
  children,
  tone,
  title,
}: {
  children: ReactNode;
  tone: string;
  // `| undefined` is required by exactOptionalPropertyTypes: callers pass a conditional title.
  title?: string | undefined;
}) {
  return (
    <span title={title} className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
      {children}
    </span>
  );
}

/**
 * The quest-log statuses that get their own badge, with the Status facet's wording.
 *
 * completed/incomplete are absent by design: they are the panel's headline state and already have
 * a dedicated badge next to the completion button, so listing them here would print it twice.
 * These three are the save-derived extras the panel had no way to show at all.
 */
const LOG_STATUS_BADGES: { value: QuestStatus; label: string; tone: string; hint: string }[] = [
  {
    value: 'inLog',
    label: 'In quest log',
    tone: 'bg-sky-900/40 text-sky-200',
    hint: 'Offered right now: the rotation + unlocked story steps',
  },
  {
    value: 'deployed',
    label: 'Team deployed',
    tone: 'bg-blue-900/50 text-blue-200',
    hint: 'A team is out on it right now',
  },
  {
    value: 'skipped',
    label: 'Skipped',
    tone: 'bg-neutral-800 text-neutral-400',
    hint: 'Skipped out of a rotation',
  },
];

export interface QuestDetailPanelProps {
  quest: Quest;
  questlineTitle: string | null;
  completed: boolean;
  /** Save-derived statuses from the filter's questStatuses - the Status facet's own answer. */
  statuses: readonly QuestStatus[];
  /** Which map region draws this quest; null until the catalog resolves it. */
  region: QuestMapRegion | null;
  /** True when the quest may be un-completed (completed with no completed dependents). */
  isTip: boolean;
  /** Completed quests that block un-completing this one (shown when !isTip). */
  blockedBy: string[];
  rewardChips: RewardChip[];
  /** Whether a save is loaded - completion edits require one. */
  canEdit: boolean;
  onComplete: () => void;
  onUncomplete: () => void;
  /** Navigate to a dependency quest (present only for deps that exist in the catalog). */
  onSelectDependency: (questName: string) => void;
  /** Dependency names that resolve to a catalog quest (clickable). */
  knownDependencies: Set<string>;
  onClose: () => void;
}

export function QuestDetailPanel({
  quest,
  questlineTitle,
  completed,
  statuses,
  region,
  isTip,
  blockedBy,
  rewardChips,
  canEdit,
  onComplete,
  onUncomplete,
  onSelectDependency,
  knownDependencies,
  onClose,
}: QuestDetailPanelProps) {
  const scheme = questSchemeLabel(quest.m_questScheme);
  const requirements = (quest.m_questRequirements ?? []).filter(
    (r) => r.m_questRequirementType !== 0,
  );
  const deps = quest.m_questDependancies ?? [];
  const diffMin = quest.m_questDifficultyMin;
  const diffMax = quest.m_questDifficultyMax;
  const environment = quest.m_questEnvironment;
  const logBadges = LOG_STATUS_BADGES.filter((b) => statuses.includes(b.value));
  const season = questSeason(quest);
  // "Scheme: Season" on its own prompts the obvious question, so name the season wherever it is
  // known rather than making the reader go and look it up.
  const seasonId = questSeasonId(quest);
  const seasonName = seasonId ? seasonLabel(seasonId) : null;

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-neutral-800 bg-neutral-900/40 p-4">
      {/* Identity: title + questline + type/scheme/state badges (no env art per Section 8.1). */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {questlineTitle && (
            <p className="truncate text-xs text-amber-400/80" title={questlineTitle}>
              {questlineTitle}
            </p>
          )}
          <h3 className="text-base font-semibold text-neutral-100" title={quest.title}>
            {quest.title}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close quest panel"
          className="shrink-0 rounded px-2 py-1 text-neutral-400 hover:text-neutral-100"
        >
          ✕
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone="bg-neutral-800 text-neutral-300">{questTypeLabel(quest.m_questType)}</Badge>
        {scheme && (
          <Badge
            tone="bg-purple-900/40 text-purple-200"
            title={seasonName ? `Season Pass content: the ${seasonName} season` : undefined}
          >
            {seasonName ? `${scheme}: ${seasonName}` : scheme}
          </Badge>
        )}
        {season.kind === 'seasonal' && (
          <Badge
            tone={season.open ? 'bg-red-900/40 text-red-200' : 'bg-neutral-800 text-neutral-400'}
            title={`Runs ${season.recurring} every year. ${
              season.open ? 'Open today.' : 'Closed today.'
            }`}
          >
            {season.open ? 'Limited time · in season' : 'Limited time · out of season'}
          </Badge>
        )}
        {quest.m_isVisible === 0 && (
          <Badge
            tone="bg-neutral-800 text-neutral-400"
            title="Never shown in-game (m_isVisible = 0)"
          >
            Hidden
          </Badge>
        )}
        <Badge
          tone={completed ? 'bg-emerald-900/50 text-emerald-300' : 'bg-amber-900/40 text-amber-200'}
        >
          {completed ? 'Completed' : 'Not completed'}
        </Badge>
        {logBadges.map((b) => (
          <Badge key={b.value} tone={b.tone} title={b.hint}>
            {b.label}
          </Badge>
        ))}
      </div>

      {/* Completion action. Mark complete grants the rewards below; mark incomplete is tip-only. */}
      <div className="mt-3">
        {completed ? (
          <button
            type="button"
            disabled={!canEdit || !isTip}
            onClick={onUncomplete}
            title={
              !canEdit
                ? 'Load a save to edit quests'
                : isTip
                  ? undefined
                  : `Un-complete its later quests first: ${blockedBy.join(', ')}`
            }
            className="w-full rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/40 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Mark incomplete
          </button>
        ) : (
          <button
            type="button"
            disabled={!canEdit}
            onClick={onComplete}
            title={canEdit ? undefined : 'Load a save to edit quests'}
            className="w-full rounded border border-emerald-700 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Mark complete + grant rewards
          </button>
        )}
        {!completed && deps.length > 0 && (
          <p className="mt-1 text-[11px] text-neutral-500">
            Also completes any unmet prerequisites and grants their rewards.
          </p>
        )}
        {!completed && isReactivatingEventQuest(quest) && (
          <p className="mt-1 text-[11px] text-neutral-500">
            Event quest: the completion time is pinned so the game keeps it done, in or out of
            season. (The game normally clears event completions ~180 days after playing them so the
            event can be replayed; un-complete it here if you ever want to replay it.)
          </p>
        )}
      </div>

      {(quest.shortDescription || quest.longDescription) && (
        <Section title="Story">
          <div className={`${BOX} space-y-2 text-sm text-neutral-300`}>
            {quest.shortDescription && (
              <p className="italic text-neutral-400">{quest.shortDescription}</p>
            )}
            {quest.longDescription && <p>{quest.longDescription}</p>}
          </div>
        </Section>
      )}

      <Section title="Rewards">
        <RewardChips chips={rewardChips} />
      </Section>

      {requirements.length > 0 && (
        <Section title="Requirements">
          <ul className={`${BOX} space-y-1 text-sm text-neutral-200`}>
            {requirements.map((r, i) => (
              <li key={i}>{formatRequirement(r)}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Details">
        <div className={BOX}>
          {(diffMin !== undefined || diffMax !== undefined) && (
            <StatRow
              label="Difficulty"
              value={
                diffMin === diffMax ? `${diffMin ?? '?'}` : `${diffMin ?? '?'}–${diffMax ?? '?'}`
              }
            />
          )}
          <StatRow label="Type" value={questTypeLabel(quest.m_questType)} />
          {region && <StatRow label="Region" value={questRegionLabel(region)} />}
          <StatRow label="Scheme" value={questSchemeName(quest.m_questScheme)} />
          {seasonName && (
            <StatRow
              label="Season"
              value={seasonName}
              title={`Season Pass season id: ${seasonId}`}
            />
          )}
          {environment !== undefined && (
            <StatRow label="Environment" value={questEnvironmentLabel(environment)} />
          )}
          <StatRow label="Repeatable" value={quest.m_isRepeatable === 1 ? 'Yes' : 'No'} />
          {/* Answers the Flags facet's "Time limited" outright, so there is no Yes/No row for it:
              a window IS the flag, spelled out. */}
          {season.kind === 'always' ? (
            <StatRow
              label="Window"
              value="Always available"
              title="No seasonal window: the catalog's 1970/01/01–2100/01/01 sentinel means the quest is never gated by date."
            />
          ) : (
            <>
              {/* Month/day, no year: the catalog's authored years (2016-2018, and one 2999) are
                  metadata the game ignores, so printing them would contradict this recurrence. */}
              <StatRow
                label="Window"
                value={season.recurring}
                title={`Recurs every year: the game compares month and day only.${
                  season.wraps ? ' This window runs through the new year.' : ''
                }`}
              />
              <StatRow label="In season today" value={season.open ? 'Yes' : 'No'} />
            </>
          )}
          <StatRow label="Hidden" value={quest.m_isVisible === 0 ? 'Yes' : 'No'} />
          <StatRow label="Quest ID" value={quest.m_questName} />
        </div>
      </Section>

      {deps.length > 0 && (
        <Section title="Prerequisites">
          <div className="flex flex-wrap gap-1.5">
            {deps.map((dep) =>
              knownDependencies.has(dep) ? (
                <button
                  key={dep}
                  type="button"
                  onClick={() => onSelectDependency(dep)}
                  className="rounded border border-sky-800 bg-sky-950/30 px-2 py-0.5 text-xs text-sky-300 hover:bg-sky-900/40"
                >
                  {dep} →
                </button>
              ) : (
                <span
                  key={dep}
                  className="rounded border border-neutral-800 bg-neutral-900/40 px-2 py-0.5 text-xs text-neutral-400"
                >
                  {dep}
                </span>
              ),
            )}
          </div>
        </Section>
      )}
    </aside>
  );
}
