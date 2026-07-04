import { useState } from 'react';
import type { Dweller, SaveData } from '../../../domain/model/saveSchema.ts';
import { useSaveStore } from '../../../state/saveStore.ts';
import { useGameData } from '../../hooks/useGameData.ts';
import { outfitEnduranceBonus } from '../../../domain/gamedata/gameData.ts';
import {
  makeLegendaryAll,
  maxHappinessAll,
  maxHpAll,
  maxSpecialAll,
  reviveAll,
  setBabyReadyAll,
  setLevelAll,
  setMaxHealthAll,
  setPregnantAll,
  setRadiationAll,
} from '../../../domain/ops/bulkOps.ts';

// Contextual bulk action bar for multi-selected dwellers. Each
// action is ONE applyEdit over the selected `serializeId`s, so the whole batch is a
// single undo step. Scope = the current selection; "select all" selects the
// currently filtered rows, which covers the all/filtered scopes.
// Pregnancy ops are female-gated inside bulkOps.

const BTN =
  'rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800';

export function BulkActionBar({
  selectedIds,
  onClear,
}: {
  selectedIds: number[];
  onClear: () => void;
}) {
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const { data: gameData } = useGameData();
  const [level, setLevel] = useState(50);

  const run = (op: (save: SaveData, ids: readonly number[]) => SaveData, label: string) => () =>
    applyEdit((s) => op(s, selectedIds), label);

  // HP scaling on Set Level uses each dweller's base Endurance + equipped-outfit bonus.
  const endBonusFor = gameData
    ? (d: Dweller) => outfitEnduranceBonus(gameData, d.equipedOutfit?.id)
    : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-900/70 px-3 py-2">
      <span className="text-sm font-medium text-amber-400">{selectedIds.length} selected</span>
      <span className="mx-1 h-4 w-px bg-neutral-700" />

      <button type="button" className={BTN} onClick={run(reviveAll, 'Revive selected')}>
        Revive
      </button>
      <button type="button" className={BTN} onClick={run(setMaxHealthAll, 'Heal (selected)')}>
        Heal
      </button>
      <button type="button" className={BTN} onClick={run(maxHpAll, 'Max HP (selected)')}>
        Max HP
      </button>
      <button
        type="button"
        className={BTN}
        onClick={run(setRadiationAll, 'Cure radiation (selected)')}
      >
        Cure
      </button>
      <button type="button" className={BTN} onClick={run(maxSpecialAll, 'Max SPECIAL (selected)')}>
        Max SPECIAL
      </button>
      <button
        type="button"
        className={BTN}
        onClick={run(maxHappinessAll, 'Max happiness (selected)')}
      >
        Max Happiness
      </button>
      <button
        type="button"
        className={BTN}
        onClick={run(makeLegendaryAll, 'Make legendary (selected)')}
      >
        Make Legendary
      </button>

      <span className="mx-1 h-4 w-px bg-neutral-700" />
      <label className="flex items-center gap-1 text-xs text-neutral-400">
        Level
        <input
          type="number"
          min={1}
          max={50}
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
          aria-label="Bulk level value"
          className="w-14 rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-neutral-100"
        />
      </label>
      <button
        type="button"
        className={BTN}
        onClick={() =>
          applyEdit(
            (s) => setLevelAll(s, selectedIds, level, endBonusFor),
            `Set level ${level} (selected)`,
          )
        }
      >
        Set Level
      </button>

      <span className="mx-1 h-4 w-px bg-neutral-700" />
      <button
        type="button"
        className={BTN}
        onClick={() =>
          applyEdit((s) => setPregnantAll(s, selectedIds, true), 'Make pregnant (selected)')
        }
      >
        Pregnant
      </button>
      <button
        type="button"
        className={BTN}
        onClick={() =>
          applyEdit((s) => setBabyReadyAll(s, selectedIds, true), 'Set baby ready (selected)')
        }
      >
        Baby ready
      </button>

      <button
        type="button"
        onClick={onClear}
        className="ml-auto rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-100"
      >
        Clear selection
      </button>
    </div>
  );
}
