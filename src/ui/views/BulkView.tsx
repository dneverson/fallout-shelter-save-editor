import { useEffect, useMemo, useRef, useState } from 'react';
import { useSaveStore } from '../../state/saveStore.ts';
import { useUIStore } from '../../state/uiStore.ts';
import { pushToast } from '../../state/toastStore.ts';
import { useGameData } from '../hooks/useGameData.ts';
import type { Dweller, SaveData } from '../../domain/model/saveSchema.ts';
import {
  countAffectedDwellers,
  healAll,
  makeLegendaryAll,
  maxHappinessAll,
  maxHpAll,
  maxSpecialAll,
  reviveAll,
  setBabyReadyAll,
  setLevelAll,
  setPregnantAll,
} from '../../domain/ops/bulkOps.ts';
import { maxEverything } from '../../domain/ops/bulkPresets.ts';
import { repairAllRooms } from '../../domain/ops/roomOps.ts';
import {
  acceptWaiting,
  clearEmergencies,
  removeRocks,
  roomsInEmergency,
  unlockRecipes,
  unlockRooms,
  unlockThemes,
} from '../../domain/ops/vaultOps.ts';
import { applyLoadout, type LoadoutSpec } from '../../domain/ops/loadoutOps.ts';
import { computeResourceCaps } from '../../domain/selectors/vaultSelectors.ts';
import { selectAllDwellerIds } from '../../domain/selectors/dwellerScope.ts';
import {
  suggestOutfitForRoomType,
  suggestPetForRoomType,
  suggestWeapon,
  vaultLoadoutRoomTypes,
  wastelandLoadoutRoomType,
} from '../../domain/selectors/loadoutSuggest.ts';
import { outfitEnduranceBonus, petBonusRange } from '../../domain/gamedata/gameData.ts';
import {
  LoadoutPanel,
  type LoadoutChoice,
  type LoadoutRow,
} from '../components/bulk/LoadoutPanel.tsx';

// Bulk section - vault-wide presets. Dweller presets apply to
// every dweller (per-selection actions live in the Dwellers table action bar). "Max Everything"
// is the headline preset: it maxes every existing entity in one undo step and never
// unlocks/adds/removes. Each preset is one applyEdit = one undo + a toast; the resolved dweller
// count is shown so there's no ambiguity about what's affected.

const BTN =
  'rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent';

const MAX_EVERYTHING_TOOLTIP =
  'Resources → legal cap · every dweller → level 50, SPECIAL 10, 644 max HP, 0 rad, ' +
  'happiness 100, dead revived · Mr. Handies → full health · every room → max level + ' +
  'repaired. Never unlocks, adds, or removes anything.';

export function BulkView() {
  const save = useSaveStore((s) => s.save);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const { data: gameData, status: gameDataStatus } = useGameData();
  const bulkFocus = useUIStore((s) => s.bulkFocus);

  const [level, setLevel] = useState(50);

  // HP scaling on Set Level / Max Everything uses base Endurance + equipped-outfit bonus.
  const endBonusFor = gameData
    ? (d: Dweller) => outfitEnduranceBonus(gameData, d.equipedOutfit?.id)
    : undefined;

  // Deep-link from the Rooms side-panel "Customize in Bulk" link: scroll the Location
  // loadouts panel into view, then consume the one-shot flag (a store action, not a
  // useState setter - safe to call from an effect under the React Compiler lint).
  const loadoutsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (bulkFocus === 'loadouts') {
      loadoutsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      useUIStore.getState().setBulkFocus(null);
    }
  }, [bulkFocus]);

  // Dweller presets always apply to every dweller.
  const scopedIds = useMemo(
    () => (save ? selectAllDwellerIds(save, gameData) : []),
    [save, gameData],
  );

  // Location loadouts: one row per staffed room type with a primary SPECIAL or a
  // catered pet (Entrance), plus a synthetic Wasteland row for unrostered dwellers.
  const weaponSuggestionId = gameData ? (suggestWeapon(gameData)?.id ?? null) : null;
  const loadoutRows = useMemo<LoadoutRow[]>(() => {
    if (!save || !gameData) return [];
    const roomTypes = vaultLoadoutRoomTypes(save, gameData);
    const wasteland = wastelandLoadoutRoomType(save);
    if (wasteland) roomTypes.push(wasteland);
    return roomTypes.map((rt) => ({
      ...rt,
      suggestedOutfitId: suggestOutfitForRoomType(gameData, rt.type, rt.statKey)?.id ?? null,
      suggestedWeaponId: weaponSuggestionId,
      suggestedPetId: suggestPetForRoomType(gameData, rt.type)?.id ?? null,
    }));
  }, [save, gameData, weaponSuggestionId]);
  if (!save) return <div className="p-6 text-sm text-neutral-400">No save loaded.</div>;

  const applyRoomLoadout = (dwellerIds: number[], choice: LoadoutChoice): void => {
    const spec: LoadoutSpec = {
      ...(choice.outfitId ? { outfitId: choice.outfitId } : {}),
      ...(choice.weaponId ? { weaponId: choice.weaponId } : {}),
    };
    if (choice.petId && gameData) {
      const range = petBonusRange(gameData, choice.petId);
      const pet = gameData.petById.get(choice.petId);
      if (range && pet) {
        spec.pet = {
          petId: choice.petId,
          uniqueName: pet.name,
          bonus: range.bonus,
          bonusValue: range.max,
        };
      }
    }
    applyEdit((s) => applyLoadout(s, dwellerIds, spec), 'Apply loadout');
    pushToast(
      `Loadout applied to ${dwellerIds.length} dweller${dwellerIds.length === 1 ? '' : 's'}`,
    );
  };

  const run =
    (label: string, op: (s: SaveData, ids: readonly number[]) => SaveData) => (): void => {
      let affected = 0;
      applyEdit((s) => {
        const next = op(s, scopedIds);
        affected = countAffectedDwellers(s, next, scopedIds);
        return next;
      }, label);
      pushToast(`${label}: ${affected} dweller${affected === 1 ? '' : 's'}`);
    };

  const runMaxEverything = (): void => {
    if (!gameData) return;
    const resourceCaps = computeResourceCaps(save, gameData.roomCapacity);
    const mrHandyHealth = gameData.roomCapacity.base.mrHandyHealth;
    applyEdit(
      (s) =>
        maxEverything(s, {
          resourceCaps,
          mrHandyHealth,
          roomMaxLevel: (type) => gameData.roomMetadataByType.get(type)?.maxLevel ?? 3,
          ...(endBonusFor ? { enduranceBonusFor: endBonusFor } : {}),
        }),
      'Max Everything',
    );
    pushToast('Max Everything applied');
  };

  // Vault / room bulk actions consolidated here (also surfaced inline in their own tabs). Each
  // is one undo step + a toast; counts drive the labels + disabled state so nothing's ambiguous.
  const rooms = save.vault?.rooms ?? [];
  const damagedCount = rooms.filter(
    (r) => r.broken === true || (r.roomHealth?.damageValue ?? 0) > 0,
  ).length;
  const rocksCount = save.vault?.rocks?.length ?? 0;
  const emergencyCount = roomsInEmergency(save).length;
  const waitingCount = save.dwellerSpawner?.dwellersWaiting?.length ?? 0;
  const themesTotal = save.survivalW?.collectedThemes?.themeList?.length ?? 0;
  const themesCollected =
    save.survivalW?.collectedThemes?.themeList?.filter(
      (t) => t.extraData?.partsCollectedCount === 9,
    ).length ?? 0;
  const recipesUnlocked = new Set(save.survivalW?.recipes ?? []).size;
  const recipesTotal = gameData?.unlockables.recipes.length ?? 0;
  const roomsUnlocked = save.unlockableMgr?.claimed?.length ?? 0;
  const roomsTotal = gameData?.unlockables.roomUnlocks.length ?? 0;

  const repairAllRooms_ = (): void => {
    applyEdit((s) => repairAllRooms(s), 'Repair all rooms');
    pushToast(`Repaired ${damagedCount} room${damagedCount === 1 ? '' : 's'}`);
  };
  const removeAllRocks = (): void => {
    applyEdit((s) => removeRocks(s), 'Remove rocks');
    pushToast(`Removed ${rocksCount} rock${rocksCount === 1 ? '' : 's'}`);
  };
  const clearAllEmergencies = (): void => {
    applyEdit((s) => clearEmergencies(s), 'Clear emergencies');
    pushToast(`Cleared ${emergencyCount} emergenc${emergencyCount === 1 ? 'y' : 'ies'}`);
  };
  const acceptAllWaiting = (): void => {
    applyEdit((s) => acceptWaiting(s), 'Accept waiting dwellers');
    pushToast(`Accepted ${waitingCount} waiting dweller${waitingCount === 1 ? '' : 's'}`);
  };
  const unlockAllThemes = (): void => {
    applyEdit((s) => unlockThemes(s), 'Unlock all themes');
    pushToast('Unlocked all themes');
  };
  const unlockAllRecipes = (): void => {
    if (!gameData) return;
    const ids = gameData.unlockables.recipes;
    applyEdit((s) => unlockRecipes(s, ids), 'Unlock all recipes');
    pushToast(`Unlocked ${ids.length} recipes`);
  };
  const unlockAllRooms = (): void => {
    if (!gameData) return;
    const ids = gameData.unlockables.roomUnlocks;
    applyEdit((s) => unlockRooms(s, ids), 'Unlock all rooms');
    pushToast('Unlocked all rooms');
  };

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="text-lg font-semibold">Bulk operations</h2>
      <p className="mt-1 text-sm text-neutral-400">
        Every vault-wide action, grouped by category. Per-selection actions live in the Dwellers
        table; room actions are also surfaced inline on the Rooms tab.
      </p>

      {/* Max Everything */}
      <section className="mt-5 rounded-lg border border-amber-700/60 bg-amber-950/20 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-amber-300">Max Everything</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-neutral-400">
              {MAX_EVERYTHING_TOOLTIP}
            </p>
          </div>
          <button
            type="button"
            onClick={runMaxEverything}
            disabled={!gameData}
            title={gameData ? MAX_EVERYTHING_TOOLTIP : 'Loading game data…'}
            className="shrink-0 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-amber-400 disabled:opacity-40"
          >
            Max Everything
          </button>
        </div>
        {gameDataStatus === 'error' && (
          <p className="mt-2 text-xs text-amber-500">
            Game data unavailable - resource caps and room maxima can’t be computed.
          </p>
        )}
      </section>

      {/* Dweller presets */}
      <section className="mt-6">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold">Dweller presets</h3>
          <span className="text-xs text-neutral-400">
            applies to all {scopedIds.length} dweller{scopedIds.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={BTN} onClick={run('Max SPECIAL', maxSpecialAll)}>
            Max SPECIAL
          </button>
          <button type="button" className={BTN} onClick={run('Max happiness', maxHappinessAll)}>
            Max happiness
          </button>
          <button type="button" className={BTN} onClick={run('Healed', healAll)}>
            Heal &amp; cure radiation
          </button>
          <button type="button" className={BTN} onClick={run('Maxed HP', maxHpAll)}>
            Max HP (644)
          </button>
          <button type="button" className={BTN} onClick={run('Revived', reviveAll)}>
            Revive dead
          </button>
          <button type="button" className={BTN} onClick={run('Made legendary', makeLegendaryAll)}>
            Make Legendary
          </button>
          <button
            type="button"
            className={BTN}
            onClick={run('Made pregnant', (s, ids) => setPregnantAll(s, ids, true))}
          >
            Make pregnant
          </button>
          <button
            type="button"
            className={BTN}
            onClick={run('Baby ready', (s, ids) => setBabyReadyAll(s, ids, true))}
          >
            Baby ready
          </button>
          <button
            type="button"
            className={BTN}
            disabled={waitingCount === 0}
            onClick={acceptAllWaiting}
            title={
              waitingCount === 0
                ? 'No dwellers waiting at the door'
                : `Accept ${waitingCount} waiting dweller${waitingCount === 1 ? '' : 's'}`
            }
          >
            Accept waiting{waitingCount > 0 ? ` (${waitingCount})` : ''}
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-neutral-400">
            Level
            <input
              type="number"
              min={1}
              max={50}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
              aria-label="Bulk level value"
              className="w-16 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100"
            />
          </label>
          <button
            type="button"
            className={BTN}
            onClick={() => {
              let affected = 0;
              applyEdit((s) => {
                const next = setLevelAll(s, scopedIds, level, endBonusFor);
                affected = countAffectedDwellers(s, next, scopedIds);
                return next;
              }, `Set level ${level}`);
              pushToast(`Set level ${level}: ${affected} dweller${affected === 1 ? '' : 's'}`);
            }}
          >
            Set level
          </button>
        </div>
      </section>

      {/* Rooms */}
      <section className="mt-8">
        <h3 className="text-base font-semibold">Rooms</h3>
        <p className="mt-1 text-xs text-neutral-400">
          Vault-wide room fixes - also available inline on the Rooms tab.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={BTN}
            disabled={damagedCount === 0}
            onClick={repairAllRooms_}
            title={
              damagedCount === 0
                ? 'No damaged rooms'
                : `Clears accumulated incident (scorch) damage back to zero on all ${damagedCount} ` +
                  `damaged room${damagedCount === 1 ? '' : 's'}. This damage is cosmetic in a saved ` +
                  `game and does not stop production; mainly fixes saves captured mid-incident.`
            }
          >
            Repair all{damagedCount > 0 ? ` (${damagedCount})` : ''}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={rocksCount === 0}
            onClick={removeAllRocks}
            title={rocksCount === 0 ? 'No rocks to remove' : `Remove ${rocksCount} rocks`}
          >
            Remove rocks{rocksCount > 0 ? ` (${rocksCount})` : ''}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={emergencyCount === 0}
            onClick={clearAllEmergencies}
            title={emergencyCount === 0 ? 'No active emergencies' : `Clear ${emergencyCount}`}
          >
            Clear emergencies{emergencyCount > 0 ? ` (${emergencyCount})` : ''}
          </button>
        </div>
      </section>

      {/* Unlocks */}
      <section className="mt-8">
        <h3 className="text-base font-semibold">Unlocks</h3>
        <p className="mt-1 text-xs text-neutral-400">
          Claim every theme, recipe, and buildable room in one edit.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={BTN}
            disabled={themesTotal === 0 || themesCollected >= themesTotal}
            onClick={unlockAllThemes}
            title={
              themesTotal === 0
                ? 'No themes owned'
                : `Themes collected ${themesCollected} / ${themesTotal}`
            }
          >
            Unlock all themes{themesTotal > 0 ? ` (${themesCollected} / ${themesTotal})` : ''}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={recipesTotal === 0 || recipesUnlocked >= recipesTotal}
            onClick={unlockAllRecipes}
            title={
              recipesTotal === 0
                ? 'Loading game data…'
                : `Recipes unlocked ${recipesUnlocked} / ${recipesTotal}`
            }
          >
            Unlock all recipes{recipesTotal > 0 ? ` (${recipesUnlocked} / ${recipesTotal})` : ''}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={roomsTotal === 0 || roomsUnlocked >= roomsTotal}
            onClick={unlockAllRooms}
            title={
              roomsTotal === 0
                ? 'Loading game data…'
                : `Rooms unlocked ${roomsUnlocked} / ${roomsTotal}`
            }
          >
            Unlock all rooms{roomsTotal > 0 ? ` (${roomsUnlocked} / ${roomsTotal})` : ''}
          </button>
        </div>
      </section>

      {/* Location loadouts */}
      <section ref={loadoutsRef} id="location-loadouts" className="mt-8 scroll-mt-4">
        <h3 className="text-base font-semibold">Location loadouts</h3>
        <p className="mt-1 text-xs text-neutral-400">
          Equip a default outfit + weapon (and optional pet) onto the dwellers in each room type.
          Defaults are the strongest outfit for the room’s SPECIAL and the highest-damage weapon -
          override per row. Equips ids directly (no storage used).
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Same feature as each room’s <span className="text-neutral-300">Apply loadout</span> button
          in <span className="text-neutral-300">Rooms</span> - that applies the suggested defaults
          to one room; here you tune them per room type and apply to all.
        </p>
        <LoadoutPanel
          rows={loadoutRows}
          outfits={gameData?.outfits ?? []}
          weapons={gameData?.weapons ?? []}
          pets={gameData?.pets ?? []}
          enums={gameData?.enums}
          onApply={applyRoomLoadout}
        />
      </section>
    </div>
  );
}
