import type { GameData } from '../gamedata/gameData.ts';
import type { SaveData } from '../model/saveSchema.ts';
import { selectDwellerRows } from './dwellerSelectors.ts';

// Resolve which dwellers a vault-wide bulk preset targets. Bulk dweller presets
// apply to every dweller; per-selection actions live in the Dwellers table action bar (operating
// on the live row selection). The resolved count is shown in the UI so there's never ambiguity
// about what's affected.

/** The serializeIds of every dweller in the save (the bulk-preset target set). */
export function selectAllDwellerIds(save: SaveData, gameData: GameData | null): number[] {
  return selectDwellerRows(save, gameData ?? undefined).map((r) => r.serializeId);
}
