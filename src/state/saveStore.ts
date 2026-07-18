import { create } from 'zustand';
import {
  decode,
  encode,
  decodeSeason,
  encodeSeason,
  decodeNvf,
  encodeNvf,
} from '../domain/codec/saveCodec.ts';
import { checkSaveHealth, type HealthReport } from '../domain/health/healthCheck.ts';
import { diagnose } from '../domain/health/diagnostics.ts';
import { assetUrl } from '../domain/gamedata/assetBase.ts';
import {
  buildFreshNvf,
  buildFreshSeasonSave,
  claimIndexFromSaveFileName,
  loadSeasonSave,
  type ReversalHandles,
  type SeasonWorkspace,
} from '../domain/ops/seasonOps.ts';
import type { SeasonCatalog } from '../domain/gamedata/seasonCatalog.ts';
import { pushToast } from './toastStore.ts';
import { autoCollectNewObjects } from '../domain/ops/guideAutoCollect.ts';
import type { GuideCodeIndex } from '../domain/items/collectionCatalog.ts';
import type { SaveData } from '../domain/model/saveSchema.ts';
import type { NvfData, SeasonSave } from '../domain/model/seasonSchema.ts';

// Working-save store. Holds the decoded save, delegates crypto
// to the domain codec, and drives undo/redo. Edits go through `applyEdit`, which
// runs a pure domain op (e.g. dwellerOps) and snapshots the prior save onto a
// history stack. Undo granularity is FULL-SAVE SNAPSHOTS - cheap because the ops
// are immutable with structural sharing (a snapshot is a new spine + references,
// not a deep copy). `originalSavText` (the first-export auto-backup source) is
// never touched by edits or undo/redo.
//
// Season Pass: the season working model (`spd.dat` + `nvf.dat`)
// lives ALONGSIDE the save. A Claim mutates BOTH the save and the season model in
// one combined undo step via `applySeasonEdit`. To keep undo/redo coherent across
// both models without changing the `save`-typed `past`/`future` stacks (other
// modules read those by reference), the season half of each history entry is held
// in PARALLEL arrays `seasonPast`/`seasonFuture` (the same pattern as `pastLabels`).
// `seasonHandles` is the editor-only reversal table (seasonOps) - never exported.

export type SaveStatus = 'empty' | 'loading' | 'loaded' | 'error';

/** Max retained undo snapshots; oldest is dropped past this bound. */
export const HISTORY_LIMIT = 100;

/** Label shown for the initial imported state in the history timeline. */
export const IMPORT_LABEL = 'Imported save';

/** Bundled new-game baseline save - fetched for the "Start fresh / sandbox" path. */
const BASELINE_FILE_NAME = 'Vault2.sav';
const BASELINE_ASSET_PATH = 'baseline/Vault2.sav';

/**
 * A random device string: 5-10 alpha chars, random in both length and value. The bundled
 * baseline ships with ONE fixed cosmetic `deviceName`, so without this every sandbox user
 * would export saves claiming the identical device - a fingerprint the game's developers
 * could correlate (and mass-flag) across players. Randomizing on load makes each sandbox
 * untraceable; the game overwrites the field with the real device on its next save anyway.
 */
function randomDeviceName(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const length = 5 + Math.floor(Math.random() * 6); // 5..10
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** Where the current season working model came from (drives the export chooser). */
export type SeasonSource = 'none' | 'catalog' | 'file';

/** The season half of one history entry, parallel to a `past`/`future` save snapshot. */
interface SeasonSnapshot {
  seasonSave: SeasonSave | null;
  nvf: NvfData | null;
  seasonHandles: ReversalHandles;
  seasonEdited: boolean;
}

export interface SaveState {
  save: SaveData | null;
  fileName: string | null;
  /** The untouched imported `.sav` text, used for the first-export auto-backup. */
  originalSavText: string | null;
  /** The decoded original save, diffed against `save` for the pre-export change review. */
  originalSave: SaveData | null;
  health: HealthReport | null;
  status: SaveStatus;
  error: string | null;
  /**
   * True when the loaded save is the bundled new-game baseline ("Start fresh / sandbox")
   * rather than a user's own file. A sandbox save has no user "original" to
   * protect, so the export backup is not meaningful for it (the export flow reads this).
   */
  isSandbox: boolean;
  backupDownloaded: boolean;

  // --- Season Pass working model ---
  /** The `spd.dat` working model, or null until a season source is chosen. */
  seasonSave: SeasonSave | null;
  /** The `nvf.dat` working model (current-season pointer), kept in sync with `seasonSave`. */
  nvf: NvfData | null;
  /** Editor-only per-claim reversal handles (seasonOps) - never written to any file. */
  seasonHandles: ReversalHandles;
  /** The uploaded `spd.dat` file name (null for the catalog "continue without a file" path). */
  seasonFileName: string | null;
  /** Where the season model came from - drives the export chooser. */
  seasonSource: SeasonSource;
  /** True once the season model has been edited (export offers `spd.dat`/`nvf.dat` then). */
  seasonEdited: boolean;
  /**
   * The vault-slot claim index season claim ops read/write (`claimedList` holds vault
   * slot indexes: Vault1.sav → 0 … Vault4.sav → 3; see seasonOps). Auto-derived from the
   * imported `.sav` file name; the Season tab exposes an override. A pairing setting,
   * not file state - deliberately outside undo history.
   */
  seasonClaimIndex: number;

  /** Undo stack (older states) and redo stack (states undone away from). */
  past: SaveData[];
  future: SaveData[];
  /** Season-half snapshots parallel to `past`/`future`. */
  seasonPast: SeasonSnapshot[];
  seasonFuture: SeasonSnapshot[];
  /** Action labels (history timeline) parallel to `past`/`future` + the current state. */
  pastLabels: string[];
  futureLabels: string[];
  /** Label of the action that produced the CURRENT `save`. */
  currentLabel: string;

  importFromText: (
    savText: string,
    fileName: string,
    opts?: { isSandbox?: boolean },
  ) => Promise<void>;
  /** Load the bundled new-game baseline save ("Start fresh / sandbox"). */
  importBaseline: () => Promise<void>;
  exportSavText: () => Promise<string>;
  /** Run a pure domain op against the current save and push it onto the history. */
  applyEdit: (recipe: (save: SaveData) => SaveData, label?: string) => void;
  /**
   * Run a pure season op against the combined `{ save, spd, nvf, handles }` workspace and
   * push ONE combined undo entry mutating both the save and the season model.
   */
  applySeasonEdit: (recipe: (ws: SeasonWorkspace) => SeasonWorkspace, label?: string) => void;
  /** Build a fresh, editable season model from the static catalog ("Continue without a file"). */
  startSeasonFromCatalog: (catalog: SeasonCatalog) => void;
  /** Load an uploaded `spd.dat` (and optional `nvf.dat`) into the season working model. */
  loadSeasonFromText: (spdText: string, nvfText: string | null, fileName: string) => Promise<void>;
  /** Override the vault-slot claim index (the Season tab's "Claims for Vault N" control). */
  setSeasonClaimIndex: (index: number) => void;
  /** Encode the current `spd.dat` working model to container text. */
  exportSeasonText: () => Promise<string>;
  /** Encode the current `nvf.dat` working model to container text. */
  exportNvfText: () => Promise<string>;
  undo: () => void;
  redo: () => void;
  /** Jump to any point in the combined timeline `[...past, save, ...future]`. */
  jumpTo: (index: number) => void;
  markBackupDownloaded: () => void;
  clear: () => void;
}

const initialState = {
  save: null,
  fileName: null,
  originalSavText: null,
  originalSave: null,
  health: null,
  status: 'empty' as SaveStatus,
  error: null,
  isSandbox: false,
  backupDownloaded: false,
  seasonSave: null,
  nvf: null,
  seasonHandles: {} as ReversalHandles,
  seasonFileName: null,
  seasonSource: 'none' as SeasonSource,
  seasonEdited: false,
  seasonClaimIndex: 0,
  past: [] as SaveData[],
  future: [] as SaveData[],
  seasonPast: [] as SeasonSnapshot[],
  seasonFuture: [] as SeasonSnapshot[],
  pastLabels: [] as string[],
  futureLabels: [] as string[],
  currentLabel: IMPORT_LABEL,
};

// --- Survival Guide auto-collect ------------------------------------------------
// Registered once game data loads (useGameData). When set, every applyEdit /
// applySeasonEdit result is post-processed: objects the edit INTRODUCED (items,
// pets, special dwellers) get their guide entry marked collected in the same undo
// step (domain/ops/guideAutoCollect.ts). Null (e.g. before game data loads, or in
// tests that never register) disables the pass - edits then behave exactly as before.
let guideCodeIndex: GuideCodeIndex | null = null;

export function setGuideCodeIndex(index: GuideCodeIndex | null): void {
  guideCodeIndex = index;
}

/** Apply the guide auto-collect pass to an edit result (identity when unregistered). */
function withAutoCollected(prev: SaveData, next: SaveData): SaveData {
  return guideCodeIndex ? autoCollectNewObjects(prev, next, guideCodeIndex) : next;
}

/** The season half of the CURRENT state, for snapshotting onto a history stack. */
function seasonSnapshotOf(s: SaveState): SeasonSnapshot {
  return {
    seasonSave: s.seasonSave,
    nvf: s.nvf,
    seasonHandles: s.seasonHandles,
    seasonEdited: s.seasonEdited,
  };
}

/**
 * Push the CURRENT combined state onto the undo stacks (save + parallel season + label),
 * clearing the redo stacks. Returns the history-array updates; callers merge in the new
 * save/season fields. `save` is non-null at every call site.
 */
function pushHistory(
  s: SaveState,
): Pick<
  SaveState,
  'past' | 'seasonPast' | 'pastLabels' | 'future' | 'seasonFuture' | 'futureLabels'
> {
  const past = [...s.past, s.save as SaveData];
  const seasonPast = [...s.seasonPast, seasonSnapshotOf(s)];
  const pastLabels = [...s.pastLabels, s.currentLabel];
  if (past.length > HISTORY_LIMIT) {
    past.shift();
    seasonPast.shift();
    pastLabels.shift();
  }
  return { past, seasonPast, pastLabels, future: [], seasonFuture: [], futureLabels: [] };
}

export const useSaveStore = create<SaveState>((set, get) => ({
  ...initialState,

  importFromText: async (savText, fileName, opts) => {
    set({ status: 'loading', error: null });
    try {
      const decoded = await decode(savText);
      // Sandbox loads anonymize the bundled baseline's fixed deviceName (see
      // randomDeviceName); user-imported saves are never touched.
      const save = opts?.isSandbox ? { ...decoded, deviceName: randomDeviceName() } : decoded;
      set({
        ...initialState,
        save,
        fileName,
        originalSavText: savText,
        originalSave: save,
        isSandbox: opts?.isSandbox ?? false,
        // Season claims are per vault slot; pair them with the vault just imported.
        seasonClaimIndex: claimIndexFromSaveFileName(fileName),
        health: checkSaveHealth(save),
        status: 'loaded',
      });
      // Broken-save diagnosis: surface structural issues on load so the
      // user can review/repair them on the Vault overview's health check.
      const issues = diagnose(save);
      if (issues.length > 0) {
        // Lead with the issue-TYPE count so this matches the Vault sidebar badge and the Vault
        // overview health check (both count types); the affected-entity total is the aside.
        const affected = issues.reduce((n, d) => n + d.count, 0);
        const types = `${issues.length} structural issue${issues.length === 1 ? '' : 's'}`;
        pushToast(`${types} found (${affected} affected). Open the Vault tab to review.`, 'info');
      }
    } catch (e) {
      set({
        ...initialState,
        status: 'error',
        error: e instanceof Error ? e.message : 'Failed to read save file.',
      });
    }
  },

  importBaseline: async () => {
    set({ status: 'loading', error: null });
    let savText: string;
    try {
      const res = await fetch(assetUrl(BASELINE_ASSET_PATH));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      savText = await res.text();
    } catch (e) {
      set({
        ...initialState,
        status: 'error',
        error: `Failed to load the bundled baseline save (${
          e instanceof Error ? e.message : 'unknown error'
        }).`,
      });
      return;
    }
    // Reuse the normal import path so decode/health/diagnostics behave identically;
    // the sandbox flag marks that there is no user original to back up.
    await get().importFromText(savText, BASELINE_FILE_NAME, { isSandbox: true });
  },

  exportSavText: async () => {
    const { save } = get();
    if (!save) throw new Error('No save loaded.');
    return encode(save);
  },

  applyEdit: (recipe, label = 'Edit') => {
    const s = get();
    if (!s.save) return;
    let next = recipe(s.save);
    if (next === s.save) return; // op was a no-op - don't grow history
    next = withAutoCollected(s.save, next);
    set({
      ...pushHistory(s),
      save: next,
      currentLabel: label,
      health: checkSaveHealth(next),
    });
  },

  applySeasonEdit: (recipe, label = 'Season edit') => {
    const s = get();
    if (!s.save || !s.seasonSave || !s.nvf) return;
    const ws: SeasonWorkspace = {
      save: s.save,
      spd: s.seasonSave,
      nvf: s.nvf,
      handles: s.seasonHandles,
    };
    const next = recipe(ws);
    if (
      next.save === ws.save &&
      next.spd === ws.spd &&
      next.nvf === ws.nvf &&
      next.handles === ws.handles
    ) {
      return; // op was a no-op - don't grow history
    }
    const nextSave = withAutoCollected(ws.save, next.save);
    set({
      ...pushHistory(s),
      save: nextSave,
      seasonSave: next.spd,
      nvf: next.nvf,
      seasonHandles: next.handles,
      seasonEdited: true,
      currentLabel: label,
      health: checkSaveHealth(nextSave),
    });
  },

  startSeasonFromCatalog: (catalog) => {
    set({
      seasonSave: buildFreshSeasonSave(catalog),
      nvf: buildFreshNvf(catalog),
      seasonHandles: {},
      seasonFileName: null,
      seasonSource: 'catalog',
      seasonEdited: false,
    });
  },

  loadSeasonFromText: async (spdText, nvfText, fileName) => {
    const spd = loadSeasonSave(await decodeSeason(spdText));
    const nvf = nvfText
      ? await decodeNvf(nvfText)
      : ({ season: { id: spd.currentSeason ?? '', type: 0 } } satisfies NvfData);
    set({
      seasonSave: spd,
      nvf,
      seasonHandles: {},
      seasonFileName: fileName,
      seasonSource: 'file',
      seasonEdited: false,
    });
  },

  setSeasonClaimIndex: (index) => {
    if (!Number.isInteger(index) || index < 0) return;
    set({ seasonClaimIndex: index });
  },

  exportSeasonText: async () => {
    const { seasonSave } = get();
    if (!seasonSave) throw new Error('No season data loaded.');
    return encodeSeason(seasonSave);
  },

  exportNvfText: async () => {
    const { nvf } = get();
    if (!nvf) throw new Error('No season data loaded.');
    return encodeNvf(nvf);
  },

  undo: () => {
    const s = get();
    if (s.past.length === 0) return;
    const previous = s.past[s.past.length - 1];
    const previousSeason = s.seasonPast[s.seasonPast.length - 1];
    set({
      save: previous,
      seasonSave: previousSeason.seasonSave,
      nvf: previousSeason.nvf,
      seasonHandles: previousSeason.seasonHandles,
      seasonEdited: previousSeason.seasonEdited,
      past: s.past.slice(0, -1),
      seasonPast: s.seasonPast.slice(0, -1),
      pastLabels: s.pastLabels.slice(0, -1),
      future: s.save ? [s.save, ...s.future] : s.future,
      seasonFuture: s.save ? [seasonSnapshotOf(s), ...s.seasonFuture] : s.seasonFuture,
      futureLabels: [s.currentLabel, ...s.futureLabels],
      currentLabel: s.pastLabels[s.pastLabels.length - 1] ?? IMPORT_LABEL,
      health: checkSaveHealth(previous),
    });
  },

  redo: () => {
    const s = get();
    if (s.future.length === 0) return;
    const next = s.future[0];
    const nextSeason = s.seasonFuture[0];
    set({
      save: next,
      seasonSave: nextSeason.seasonSave,
      nvf: nextSeason.nvf,
      seasonHandles: nextSeason.seasonHandles,
      seasonEdited: nextSeason.seasonEdited,
      past: s.save ? [...s.past, s.save] : s.past,
      seasonPast: s.save ? [...s.seasonPast, seasonSnapshotOf(s)] : s.seasonPast,
      pastLabels: s.save ? [...s.pastLabels, s.currentLabel] : s.pastLabels,
      future: s.future.slice(1),
      seasonFuture: s.seasonFuture.slice(1),
      futureLabels: s.futureLabels.slice(1),
      currentLabel: s.futureLabels[0] ?? 'Edit',
      health: checkSaveHealth(next),
    });
  },

  jumpTo: (index) => {
    const s = get();
    if (!s.save) return;
    // Reconstruct the full combined timeline and split it at the target index.
    const saves = [...s.past, s.save, ...s.future];
    const seasons = [...s.seasonPast, seasonSnapshotOf(s), ...s.seasonFuture];
    const labels = [...s.pastLabels, s.currentLabel, ...s.futureLabels];
    if (index < 0 || index >= saves.length) return;
    const targetSeason = seasons[index];
    set({
      save: saves[index],
      seasonSave: targetSeason.seasonSave,
      nvf: targetSeason.nvf,
      seasonHandles: targetSeason.seasonHandles,
      seasonEdited: targetSeason.seasonEdited,
      past: saves.slice(0, index),
      seasonPast: seasons.slice(0, index),
      pastLabels: labels.slice(0, index),
      future: saves.slice(index + 1),
      seasonFuture: seasons.slice(index + 1),
      futureLabels: labels.slice(index + 1),
      currentLabel: labels[index],
      health: checkSaveHealth(saves[index]),
    });
  },

  markBackupDownloaded: () => set({ backupDownloaded: true }),

  clear: () => set({ ...initialState }),
}));

/** Selector: is an undo available? */
export const selectCanUndo = (state: SaveState): boolean => state.past.length > 0;
/** Selector: is a redo available? */
export const selectCanRedo = (state: SaveState): boolean => state.future.length > 0;
/** Label of the most recent action (for the Undo button tooltip), or null. */
export const selectUndoLabel = (state: SaveState): string | null => state.currentLabel ?? null;
/** Label of the next redoable action (for the Redo button tooltip), or null. */
export const selectRedoLabel = (state: SaveState): string | null => state.futureLabels[0] ?? null;

/** One entry in the history timeline. */
export interface HistoryEntry {
  index: number;
  label: string;
}

/** The full history timeline (`[...past, save, ...future]`) + the current index. */
export interface HistoryView {
  entries: HistoryEntry[];
  currentIndex: number;
}

/** Selector: the labeled timeline for the slide-out history panel. */
export const selectHistory = (state: SaveState): HistoryView => ({
  entries: [...state.pastLabels, state.currentLabel, ...state.futureLabels].map((label, index) => ({
    index,
    label,
  })),
  currentIndex: state.past.length,
});
