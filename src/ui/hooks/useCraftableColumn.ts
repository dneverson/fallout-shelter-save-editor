import { useMemo } from 'react';
import { useSaveStore } from '../../state/saveStore.ts';
import { useGameData } from './useGameData.ts';
import { useSectionNavigate } from '../routing/useSectionNavigate.ts';
import type { CraftableColumnOptions } from '../components/table/schemas/itemSchemas.tsx';

// Shared wiring for the standalone Weapons/Outfits catalogs' "Craftable" column, so both
// views build it identically: which item ids have a recipe (recipe id == item id), which of
// those recipes the loaded save already owns, and a click handler that jumps to the Recipes
// tab focused on that recipe. Returns null until game data has loaded so the caller can skip
// the column entirely (nothing is craftable yet).
export function useCraftableColumn(): CraftableColumnOptions | undefined {
  const { data: gameData } = useGameData();
  const save = useSaveStore((s) => s.save);
  const goTo = useSectionNavigate();

  const craftableIds = useMemo(() => new Set(gameData?.unlockables?.recipes ?? []), [gameData]);
  // null (not empty) when no save is loaded: the column then shows craftable / not craftable
  // rather than a collection status it can't know.
  const knownIds = useMemo(() => (save ? new Set(save.survivalW?.recipes ?? []) : null), [save]);

  return useMemo(
    () =>
      gameData
        ? { craftableIds, knownIds, onOpen: (id: string) => goTo('recipes', id) }
        : undefined,
    [gameData, craftableIds, knownIds, goTo],
  );
}
