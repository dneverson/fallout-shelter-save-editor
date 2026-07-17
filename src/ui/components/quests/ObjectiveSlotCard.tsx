import type { ObjectiveDef } from '../../../domain/gamedata/schemas.ts';
import type { ObjectiveSlot } from '../../../domain/model/saveSchema.ts';
import { slotEscalation } from '../../../domain/quests/objectiveOps.ts';
import {
  formatObjectiveDescription,
  objectiveGoal,
  objectiveLevel,
  objectiveRewardLabel,
  objectiveScaling,
  requirementProgressEntries,
  scaledObjectiveGoal,
} from '../../../domain/quests/objectiveDisplay.ts';
import { NumberField } from '../forms/NumberField.tsx';

// One of the 3 daily-objective slots, rendered as a card (Section 7). The objective can be swapped
// for another (Replace, never removed - the game assumes 3 slots), marked complete/ready-to-collect,
// and its reward-tier state (`lottery` 5 booleans, escalation level) edited. Goal and reward are
// shown at the slot's TRUE escalation level (base + per-level scaling), with the formula in a
// hover tooltip. The requirement's per-save progress counters vary by objective type and are
// shown read-only, humanized.

const BOX = 'rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2';

interface ObjectiveSlotCardProps {
  index: number;
  slot: ObjectiveSlot;
  /** The catalog definition for the slot's objectiveID, if resolved. */
  def: ObjectiveDef | undefined;
  canEdit: boolean;
  onReplace: () => void;
  onToggleCompleted: (completed: boolean) => void;
  onLotteryChange: (lottery: boolean[]) => void;
  onIncLevelChange: (incLevel: number) => void;
  /** Commit one numeric progress counter (requirement row `reqIndex`, save key `key`). */
  onProgressChange: (reqIndex: number, key: string, value: number) => void;
}

export function ObjectiveSlotCard({
  index,
  slot,
  def,
  canEdit,
  onReplace,
  onToggleCompleted,
  onLotteryChange,
  onIncLevelChange,
  onProgressChange,
}: ObjectiveSlotCardProps) {
  const objective = slot.objective;
  const objectiveID = objective?.objectiveID ?? '';
  const completed = objective?.completed === true;
  const level = def ? objectiveLevel(def) : null;

  // The CURRENT objective's escalation level. Normally equal to the slot's `incLevel` (the
  // counter that seeds each newly assigned objective); read the objective's own captured level
  // so the displayed goal/reward stay true even if the two have diverged.
  const escalation = slotEscalation(slot);
  const scaling = def ? objectiveScaling(def) : null;
  const baseGoal = def ? objectiveGoal(def) : null;
  const goal = def ? scaledObjectiveGoal(def, escalation) : null;

  const goalTitle =
    scaling && baseGoal != null
      ? `Base ${baseGoal.toLocaleString()}` +
        (scaling.goalPerLevel > 0 ? ` + ${scaling.goalPerLevel} per escalation level` : '') +
        (scaling.goalCap != null ? `, capped at ${scaling.goalCap.toLocaleString()}` : '')
      : undefined;
  const rewardTitle =
    def && scaling
      ? `Base ${objectiveRewardLabel(def)}` +
        (scaling.rewardPerLevel > 0 ? ` + ${scaling.rewardPerLevel} per escalation level` : '')
      : undefined;

  const description = def
    ? formatObjectiveDescription(def, escalation)
    : objectiveID || '(empty slot)';
  // The lottery is always 5 booleans in-game; pad/truncate a malformed save so the toggles render.
  const lottery = Array.from({ length: 5 }, (_, i) => slot.lottery?.[i] ?? true);

  const toggleLottery = (i: number): void => {
    const next = lottery.slice();
    next[i] = !next[i];
    onLotteryChange(next);
  };

  return (
    <section className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-amber-400/80">Slot {index + 1}</p>
          <h3 className="text-sm font-semibold text-neutral-100" title={objectiveID}>
            {description}
          </h3>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {level != null && (
            <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
              Tier {level}
            </span>
          )}
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              completed ? 'bg-emerald-900/50 text-emerald-300' : 'bg-amber-900/40 text-amber-200'
            }`}
          >
            {completed ? 'Completed' : 'In progress'}
          </span>
        </div>
      </div>

      {!def && objectiveID && (
        <p className="mt-2 text-xs text-amber-500">
          Unknown objective id - not in the catalog; the game will reassign this slot on load.
        </p>
      )}

      {/* True goal & reward at the slot's current escalation level; formula on hover. */}
      <div className={`${BOX} mt-3 space-y-1 text-sm`}>
        {goal != null && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-neutral-400">Goal</span>
            <span className="cursor-help font-medium text-neutral-100" title={goalTitle}>
              {goal.toLocaleString()}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-neutral-400">Reward</span>
          <span className="cursor-help font-medium text-neutral-100" title={rewardTitle}>
            {def ? objectiveRewardLabel(def, escalation) : '-'}
          </span>
        </div>
      </div>

      {/* Progress counters (per-save fields vary by objective type). Numeric counters are
          EDITABLE, clamped to the scaled goal; hitting the goal marks the objective completed
          (see setObjectiveProgress). A freshly replaced objective has an empty requirements
          array - the game re-creates the rows on load - so the box stays mounted with a zeroed
          placeholder rather than vanishing. */}
      {objective && (
        <div className={`${BOX} mt-2 text-xs`}>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-neutral-400">Progress</p>
          <div className="space-y-2">
            {objective.requirements && objective.requirements.length > 0 ? (
              objective.requirements.map((r, i) => {
                const entries = requirementProgressEntries(r as Record<string, unknown>);
                const counters = entries.filter((e) => e.numeric != null);
                const flags = entries.filter((e) => e.numeric == null);
                return (
                  <div key={i} className="flex flex-wrap items-end justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-end gap-2">
                      {counters.map((e) => (
                        <NumberField
                          key={e.key}
                          label={goal != null ? `${e.label} / ${goal.toLocaleString()}` : e.label}
                          value={e.numeric!}
                          onCommit={(v) => onProgressChange(i, e.key, v)}
                          min={0}
                          max={goal ?? 999999}
                          disabled={!canEdit}
                          className="w-36"
                        />
                      ))}
                      {flags.length > 0 && (
                        <span className="pb-1 text-neutral-400">
                          {flags.map((e) => `${e.label}: ${e.value}`).join(' · ')}
                        </span>
                      )}
                      {entries.length === 0 && (
                        <span className="text-neutral-400">Tracked by the game</span>
                      )}
                    </div>
                    <span
                      className={`pb-1 ${r.satisfied ? 'text-emerald-400' : 'text-neutral-500'}`}
                    >
                      {r.satisfied ? 'Goal met' : 'In progress'}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-neutral-400">
                  Starts at 0 - the game re-creates the counters on load
                </span>
                <span className="text-neutral-500">In progress</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit controls ------------------------------------------------------------ */}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <button
          type="button"
          disabled={!canEdit}
          onClick={onReplace}
          title={canEdit ? undefined : 'Load a save to edit objectives'}
          className="rounded border border-sky-800 bg-sky-950/30 px-3 py-1.5 text-sm text-sky-300 hover:bg-sky-900/40 disabled:opacity-40 disabled:hover:bg-sky-950/30"
        >
          Replace…
        </button>
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={completed}
            onChange={(e) => onToggleCompleted(e.target.checked)}
            className="h-4 w-4 accent-emerald-500 disabled:opacity-40"
          />
          Completed
        </label>
        <NumberField
          label="Escalation level"
          value={slot.incLevel ?? 0}
          onCommit={onIncLevelChange}
          min={0}
          max={999}
          disabled={!canEdit}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-neutral-500">
        The game raises this by 1 each time the slot&apos;s objective completes, scaling up the goal
        and reward above
        {scaling && (scaling.goalPerLevel > 0 || scaling.rewardPerLevel > 0)
          ? ` (here: ${[
              scaling.goalPerLevel > 0 ? `+${scaling.goalPerLevel} goal` : null,
              scaling.rewardPerLevel > 0 ? `+${scaling.rewardPerLevel} reward` : null,
            ]
              .filter(Boolean)
              .join(', ')} per level)`
          : ''}
        . Set 0 to reset to the base objective.
      </p>

      <div className="mt-3">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-neutral-400">
          Next objective difficulty
        </p>
        <p className="mb-1.5 text-[11px] text-neutral-500">
          When this objective is done, the game replaces it with a random one from the difficulty
          tiers checked here (1 = easiest, 5 = hardest - the same Tier badge shown above). The game
          unchecks each tier after using it, so every difficulty comes up once before all five
          reset. Leave only one checked to force that difficulty next.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {lottery.map((on, i) => (
            <label
              key={i}
              className="flex cursor-pointer items-center gap-1 rounded border border-neutral-800 bg-neutral-900/40 px-2 py-1 text-xs text-neutral-300"
            >
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={on}
                onChange={() => toggleLottery(i)}
                className="h-3.5 w-3.5 accent-amber-500 disabled:opacity-40"
              />
              {i + 1}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
