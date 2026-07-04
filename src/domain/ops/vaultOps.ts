import type { Room, SaveData } from '../model/saveSchema.ts';

// Pure, immutable VAULT-SETTINGS edit operations. Like dwellerOps/storageOps, every op is
// `(save, …args) => SaveData` with no mutation: it returns a new save sharing every
// untouched subtree by reference (structural sharing), so the store records one edit
// as one cheap undo snapshot via a single applyEdit. No-op edits return the SAME save.
//
// These ops are game-data-free: the "unlock all" catalogs (recipe ids, room-unlock
// ids) and the legal resource caps are computed from game data by the call site
// (vaultSelectors + the UI), mirroring how dwellerOps takes already-validated values.

// Consumable type codes for vault.LunchBoxesByType.
export const CONSUMABLE_CODES = {
  Lunchbox: 0,
  MrHandy: 1,
  PetCarrier: 2,
  StarterPack: 3,
} as const;

const ALL_CONSUMABLE_CODES = Object.values(CONSUMABLE_CODES);

/** Room states that are NOT emergencies - everything else is an incident to clear. */
const NON_EMERGENCY_STATES = new Set(['Idle', 'Working']);

// --- nested-update helpers (structural sharing) ---------------------------------

function withVault(save: SaveData, vault: NonNullable<SaveData['vault']>): SaveData {
  return { ...save, vault };
}

function vaultOf(save: SaveData): NonNullable<SaveData['vault']> {
  return save.vault ?? {};
}

// --- Resources (caps, food/energy/water, stim/radaway, quantum, chips) ---

/** Current `vault.storage.resources` map (empty if absent). */
export function resources(save: SaveData): Record<string, number> {
  return save.vault?.storage?.resources ?? {};
}

/** Set one resource to `value` (floored at 0 - resources are never negative). */
export function setResource(save: SaveData, key: string, value: number): SaveData {
  const next = Math.max(0, value);
  const current = resources(save);
  if (current[key] === next) return save;
  const vault = vaultOf(save);
  const storage = vault.storage ?? {};
  return withVault(save, {
    ...vault,
    storage: { ...storage, resources: { ...current, [key]: next } },
  });
}

/**
 * Raise every resource named in `caps` UP TO its capped value in ONE edit (the
 * "Max resources" button). `caps` is the legal-max map computed by `vaultSelectors`
 * (room/dweller-derived). "Max" never lowers a value: a resource already above its
 * cap (e.g. caps on a previously-edited save) is kept; unlisted resources are untouched.
 */
export function maxResources(save: SaveData, caps: Record<string, number>): SaveData {
  const current = resources(save);
  let changed = false;
  const next = { ...current };
  for (const [key, cap] of Object.entries(caps)) {
    const target = Math.max(current[key] ?? 0, cap);
    if (next[key] !== target) {
      next[key] = target;
      changed = true;
    }
  }
  if (!changed) return save;
  const vault = vaultOf(save);
  const storage = vault.storage ?? {};
  return withVault(save, { ...vault, storage: { ...storage, resources: next } });
}

// --- Consumables (rebuild LunchBoxesByType + LunchBoxesCount) --------------------

/** Per-code consumable counts derived from `vault.LunchBoxesByType`. */
export function consumableCounts(save: SaveData): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const code of save.vault?.LunchBoxesByType ?? []) {
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

/**
 * Set the count of consumable `code` to exactly `count`, rebuilding
 * `LunchBoxesByType` (N entries per code, ascending) + `LunchBoxesCount`.
 */
export function setConsumableCount(save: SaveData, code: number, count: number): SaveData {
  const n = Math.max(0, Math.trunc(count));
  const counts = consumableCounts(save);
  if ((counts[code] ?? 0) === n) return save;
  counts[code] = n;

  const codes = [...new Set([...ALL_CONSUMABLE_CODES, ...Object.keys(counts).map(Number)])].sort(
    (a, b) => a - b,
  );
  const list: number[] = [];
  for (const c of codes) {
    for (let i = 0; i < (counts[c] ?? 0); i++) list.push(c);
  }
  return withVault(save, {
    ...vaultOf(save),
    LunchBoxesByType: list,
    LunchBoxesCount: list.length,
  });
}

// --- Vault config (name / mode / theme) -----------------------------------------

/** Set the vault number (0–999), stored zero-padded to a 3-digit string. */
export function setVaultName(save: SaveData, value: number): SaveData {
  const name = String(Math.min(999, Math.max(0, Math.trunc(value)))).padStart(3, '0');
  const vault = vaultOf(save);
  if (vault.VaultName === name) return save;
  return withVault(save, { ...vault, VaultName: name });
}

export type VaultMode = 'Normal' | 'Survival';

export function setVaultMode(save: SaveData, mode: VaultMode): SaveData {
  const vault = vaultOf(save);
  if (vault.VaultMode === mode) return save;
  return withVault(save, { ...vault, VaultMode: mode });
}

/** Holiday theme: 0 Normal · 1 Xmas · 2 Halloween · 3 ThanksGiving. */
export function setVaultTheme(save: SaveData, theme: number): SaveData {
  const t = Math.trunc(theme);
  const vault = vaultOf(save);
  if (vault.VaultTheme === t) return save;
  return withVault(save, { ...vault, VaultTheme: t });
}

// --- Quick actions --------------------------------------------------------------

/** Remove all excavatable rocks (`vault.rocks = []`). */
export function removeRocks(save: SaveData): SaveData {
  const vault = vaultOf(save);
  if (Array.isArray(vault.rocks) && vault.rocks.length === 0) return save;
  return withVault(save, { ...vault, rocks: [] });
}

/**
 * Excavate a SINGLE rock cell at grid (`row`, `col`) - the Rooms-Map per-rock click
 * (one undo step), as opposed to `removeRocks` which clears them all. Each `vault.rocks`
 * entry is a `{ r, c }` cell; this drops the one matching (`row`, `col`), sharing the rest
 * by reference. No-op (returns the same save) when no rock occupies that cell.
 */
export function removeRockAt(save: SaveData, row: number, col: number): SaveData {
  const vault = vaultOf(save);
  const rocks = vault.rocks;
  if (!Array.isArray(rocks)) return save;
  const next = rocks.filter((rock) => {
    const r = (rock as { r?: number }).r;
    const c = (rock as { c?: number }).c;
    return !(r === row && c === col);
  });
  if (next.length === rocks.length) return save;
  return withVault(save, { ...vault, rocks: next });
}

/** True when `list` (vault.rocks / vault.ultracite) already holds cell (`row`, `col`). */
const hasCell = (list: unknown, row: number, col: number): boolean =>
  Array.isArray(list) &&
  list.some((cell) => (cell as { r?: number }).r === row && (cell as { c?: number }).c === col);

/**
 * Place a rock at grid (`row`, `col`). Rocks serialize as bare `{ r, c }` cells
 * (RockZone.Serialize) and the game re-creates the zone on load (AddNewRockZone), so an
 * injected rock behaves exactly like a generated one (blocks builds; costs caps to clear
 * in-game). The CALLER guards that the cell is empty (no room/rock/ultracite) and below
 * the surface floor. No-op when the cell already holds a rock.
 */
export function addRockAt(save: SaveData, row: number, col: number): SaveData {
  const vault = vaultOf(save);
  if (hasCell(vault.rocks, row, col)) return save;
  const rocks = Array.isArray(vault.rocks) ? vault.rocks : [];
  return withVault(save, { ...vault, rocks: [...rocks, { r: row, c: col }] });
}

/**
 * Place an ultracite deposit at grid (`row`, `col`). Deposits serialize as bare `{ r, c }`
 * cells (UltraciteDeposit.Serialize) in `vault.ultracite` and deserialize unconditionally
 * (Vault.Deserialize), though the Ultracite Mining room that uses them is a season-vault
 * feature. Caller guards emptiness, like `addRockAt`. No-op when already present.
 */
export function addUltraciteAt(save: SaveData, row: number, col: number): SaveData {
  const vault = vaultOf(save);
  if (hasCell(vault.ultracite, row, col)) return save;
  const ultracite = Array.isArray(vault.ultracite) ? vault.ultracite : [];
  return withVault(save, { ...vault, ultracite: [...ultracite, { r: row, c: col }] });
}

/** Remove the ultracite deposit at grid (`row`, `col`); no-op when none is there. */
export function removeUltraciteAt(save: SaveData, row: number, col: number): SaveData {
  const vault = vaultOf(save);
  const ultracite = vault.ultracite;
  if (!Array.isArray(ultracite)) return save;
  const next = ultracite.filter((cell) => {
    const r = (cell as { r?: number }).r;
    const c = (cell as { c?: number }).c;
    return !(r === row && c === col);
  });
  if (next.length === ultracite.length) return save;
  return withVault(save, { ...vault, ultracite: next });
}

/**
 * Clear active emergencies: reset every room whose `currentStateName` is an incident
 * (anything other than the normal Idle/Working states) back to "Idle". Leaves normal
 * rooms untouched - the game re-evaluates Working state from staffing on load.
 */
export function clearEmergencies(save: SaveData): SaveData {
  const vault = vaultOf(save);
  const rooms = vault.rooms;
  if (!Array.isArray(rooms)) return save;
  let changed = false;
  const next = rooms.map((room) => {
    const state = room.currentStateName;
    if (state !== undefined && !NON_EMERGENCY_STATES.has(state)) {
      changed = true;
      return { ...room, currentStateName: 'Idle' };
    }
    return room;
  });
  if (!changed) return save;
  return withVault(save, { ...vault, rooms: next });
}

/** Accept all dwellers waiting at the door (`dwellerSpawner.dwellersWaiting = []`). */
export function acceptWaiting(save: SaveData): SaveData {
  const spawner = save.dwellerSpawner;
  const waiting = spawner?.dwellersWaiting;
  if (!Array.isArray(waiting) || waiting.length === 0) return save;
  return { ...save, dwellerSpawner: { ...spawner, dwellersWaiting: [] } };
}

/** Fully collect every owned theme (`partsCollectedCount = 9` on each themeList entry). */
export function unlockThemes(save: SaveData): SaveData {
  const survivalW = save.survivalW;
  const themeList = survivalW?.collectedThemes?.themeList;
  if (!Array.isArray(themeList) || themeList.length === 0) return save;
  let changed = false;
  const next = themeList.map((theme) => {
    const extraData = theme.extraData ?? {};
    if (extraData.partsCollectedCount === 9) return theme;
    changed = true;
    return { ...theme, extraData: { ...extraData, partsCollectedCount: 9 } };
  });
  if (!changed) return save;
  const collectedThemes = survivalW?.collectedThemes ?? {};
  return {
    ...save,
    survivalW: { ...survivalW, collectedThemes: { ...collectedThemes, themeList: next } },
  };
}

/**
 * Unlock every crafting recipe (`survivalW.recipes = recipeIds`). The caller passes
 * the extracted recipe catalog (gameData.unlockables.recipes) - every id is a real
 * v2.4.1 game id, not a hardcoded list.
 */
export function unlockRecipes(save: SaveData, recipeIds: readonly string[]): SaveData {
  return { ...save, survivalW: { ...save.survivalW, recipes: [...recipeIds] } };
}

/**
 * Unlock every buildable room (`unlockableMgr.claimed = roomUnlockIds`) and clear the
 * objective progress lists. The caller passes the extracted room-unlock catalog
 * (gameData.unlockables.roomUnlocks).
 */
export function unlockRooms(save: SaveData, roomUnlockIds: readonly string[]): SaveData {
  return {
    ...save,
    unlockableMgr: {
      ...save.unlockableMgr,
      claimed: [...roomUnlockIds],
      completed: [],
      objectivesInProgress: [],
    },
  };
}

// --- Mysterious Stranger (show / hide) ------------------------------------------

/**
 * Show (`Appearing`) or hide (`Hiding`) the Mysterious Stranger
 * (`MysteriousStranger.currentState`, EMysteriousStrangerState). Showing also enables
 * `canAppear`; preserves the timing keys.
 */
export function setMysteriousStranger(save: SaveData, show: boolean): SaveData {
  const current = save.MysteriousStranger ?? {};
  const currentState = show ? 'Appearing' : 'Hiding';
  if (current.currentState === currentState && (!show || current.canAppear === true)) return save;
  return {
    ...save,
    MysteriousStranger: { ...current, currentState, ...(show ? { canAppear: true } : {}) },
  };
}

/** True if the Mysterious Stranger is currently shown (not Hiding). */
export function isMysteriousStrangerShown(save: SaveData): boolean {
  const state = save.MysteriousStranger?.currentState;
  return state !== undefined && state !== 'Hiding';
}

/**
 * Set the Mysterious Stranger timing: `timeToAppear` (seconds between appearances) and/or
 * `remainingTimeToAppear` (the live countdown; ~1 makes him show up almost immediately).
 * Values clamp to >= 0; omitted fields are preserved. No-op when nothing changes.
 */
export function setStrangerTimers(
  save: SaveData,
  timers: { timeToAppear?: number; remainingTimeToAppear?: number },
): SaveData {
  const current = save.MysteriousStranger ?? {};
  const next = { ...current };
  if (timers.timeToAppear !== undefined) next.timeToAppear = Math.max(0, timers.timeToAppear);
  if (timers.remainingTimeToAppear !== undefined) {
    next.remainingTimeToAppear = Math.max(0, timers.remainingTimeToAppear);
  }
  if (
    next.timeToAppear === current.timeToAppear &&
    next.remainingTimeToAppear === current.remainingTimeToAppear
  ) {
    return save;
  }
  return { ...save, MysteriousStranger: next };
}

// --- Starter Pack (ShopWindow.isStarterPackPurchased) ---------------------------

/**
 * Mark the Starter Pack as purchased (`ShopWindow.isStarterPackPurchased`). This only HIDES
 * the real-money Starter Pack offer in the in-game store - it does NOT grant the pack's
 * lunchbox contents. Preserves any other `ShopWindow` keys (e.g. `hasStarterPackPopupShown`).
 */
export function setStarterPackPurchased(save: SaveData, purchased: boolean): SaveData {
  const current = save.ShopWindow ?? {};
  if ((current.isStarterPackPurchased ?? false) === purchased) return save;
  return { ...save, ShopWindow: { ...current, isStarterPackPurchased: purchased } };
}

/** True if the Starter Pack is marked purchased (its store offer hidden). */
export function isStarterPackPurchased(save: SaveData): boolean {
  return save.ShopWindow?.isStarterPackPurchased === true;
}

/** True if a single room is in an active emergency (a non-Idle/Working state). */
export function isRoomInEmergency(room: Room): boolean {
  return room.currentStateName !== undefined && !NON_EMERGENCY_STATES.has(room.currentStateName);
}

/** Helper for the UI: list rooms in an active emergency (non-Idle/Working state). */
export function roomsInEmergency(save: SaveData): Room[] {
  return (save.vault?.rooms ?? []).filter(isRoomInEmergency);
}
