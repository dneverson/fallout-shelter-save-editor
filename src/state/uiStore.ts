import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  ColumnFiltersState,
  ColumnSizingState,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table';
import type { SaveData } from '../domain/model/saveSchema.ts';
import { EMPTY_QUEST_FILTER, type QuestFilter } from '../domain/quests/questFilter.ts';

// View/UI state. Distinct from saveStore (the working save):
// this holds the selected dweller and the Dwellers-table view state. Durable
// preferences - TABLE LAYOUT (sort order, column visibility, column order) and the
// allow-out-of-range toggle - persist to localStorage so the editor reopens the way the
// user left it; transient filters (search, per-column filters, quick chips, the selected
// dweller) are intentionally session-only and reset on reload.
//
// The ACTIVE SECTION is NOT held here - the hash router owns it (see ui/router.tsx); the
// `Section` type below remains the canonical union of section ids, consumed by the router
// and the sidebar nav registry (ui/routing/sections.ts).

export type Section =
  | 'vault'
  | 'dwellers'
  | 'family'
  | 'rooms'
  | 'weapons'
  | 'outfits'
  | 'recipes'
  | 'survival-guide'
  | 'pets'
  | 'handies'
  | 'junk'
  | 'storage'
  | 'quests'
  | 'bulk'
  | 'season-pass'
  | 'advanced';

// One-click roster filters surfaced as toolbar chips. The game has no
// "unarmed"/"unclothed" state - every dweller always carries at least the bare Fist and
// vault jumpsuit - so `fistOnly`/`vaultSuitOnly` mean "still on the starter default",
// i.e. the dwellers who need real gear (not an impossible empty slot).
export interface DwellerQuickFilters {
  fistOnly: boolean;
  vaultSuitOnly: boolean;
  emptyPet: boolean;
  deadOnly: boolean;
}

const NO_QUICK_FILTERS: DwellerQuickFilters = {
  fistOnly: false,
  vaultSuitOnly: false,
  emptyPet: false,
  deadOnly: false,
};

// The four persisted pieces of a single table's layout (unified table system). Filters,
// search, and selection are deliberately NOT here - those stay session-only per table.
// Stored PARTIALLY: a field stays absent until the user changes it, so a preset's default
// (seeded by useTableLayout) isn't clobbered the first time an unrelated field is written.
export interface TableLayout {
  sorting: SortingState;
  columnVisibility: VisibilityState;
  columnOrder: string[];
  columnSizing: ColumnSizingState;
}

// In-progress state of the Advanced raw-JSON editor, kept alive while the user leaves the
// tab. `text` is the full editor buffer (including edits not yet Applied); anchor/head are
// the caret selection and `scrollTop` the scroll offset - so returning to the tab restores
// both the edits and the place. `baseSave` is the save object the buffer was derived from:
// on return the draft is only restored if it still matches the live save, so an edit made
// elsewhere in the UI (which replaces the save) wins and the editor resyncs instead of
// shadowing it. Session-only (see store note below), like the save itself.
export interface AdvancedDraft {
  text: string;
  anchor: number;
  head: number;
  scrollTop: number;
  baseSave: SaveData;
}

// The master-detail SELECTION (which dweller/room/pet is open) is NOT held here - like the
// active section, it lives in the URL (ui/router.tsx, `:section/:detail`) so selections are
// deep-linkable and participate in browser/mouse back-forward. Views read it via useParams.
export interface UIState {
  /**
   * Advanced raw-editor session state. Held here (not localStorage) so the user can pass
   * the triple-gate, switch tabs to see Applied changes elsewhere, and return without
   * re-confirming or losing in-progress edits / scroll position. Resets on reload like the
   * working save - the safety gate stays meaningful per session.
   */
  advancedUnlocked: boolean;
  setAdvancedUnlocked: (value: boolean) => void;
  advancedDraft: AdvancedDraft | null;
  setAdvancedDraft: (draft: AdvancedDraft | null) => void;

  /**
   * One-shot deep-link target inside the Bulk view (session-only). When set to
   * 'loadouts', BulkView scrolls its Location-loadouts panel into view on mount and
   * clears the flag - used by the Rooms side-panel "Customize in Bulk" link.
   */
  bulkFocus: 'loadouts' | null;
  setBulkFocus: (focus: 'loadouts' | null) => void;

  /**
   * Whether the single shared Export dialog is open (session-only). One mechanism for the
   * whole app: both the TopBar "Export" button and the Season tab's "Export" button flip
   * this flag, and a single `<ExportDialog>` (mounted once) renders the multi-file chooser.
   */
  exportOpen: boolean;
  openExport: () => void;
  closeExport: () => void;

  /** Power-user toggle: allow edits past game-legal ranges (SPECIAL/level/etc.). */
  allowOutOfRange: boolean;
  setAllowOutOfRange: (value: boolean) => void;

  /** Bypass the storage-capacity guardrail on add-to-storage flows (remembered across
   *  every catalog tab and the Storage add dialog). */
  storageBypassCapacity: boolean;
  setStorageBypassCapacity: (value: boolean) => void;

  /** Width (px) of the Dwellers/Pets detail sheet, resized via the split divider. */
  detailPanelWidth: number;
  setDetailPanelWidth: (width: number) => void;
  /** Width (px) of the Rooms side panel (narrower default than the dweller/pet sheet). */
  roomPanelWidth: number;
  setRoomPanelWidth: (width: number) => void;

  /** Rooms tab: collapse the Advisors recommendations banner to free up vertical space
   *  for the grid. Default open; remembered like the panel widths. */
  roomsAdvisorsCollapsed: boolean;
  setRoomsAdvisorsCollapsed: (value: boolean) => void;
  /** Rooms tab: collapse the Resource economy strip to its header line. Default open. */
  roomsEconomyCollapsed: boolean;
  setRoomsEconomyCollapsed: (value: boolean) => void;
  /** Rooms tab: collapse the Build palette to its header line. Default open. */
  roomsBuildCollapsed: boolean;
  setRoomsBuildCollapsed: (value: boolean) => void;

  // --- Dwellers table: session-only filters -----------------------------------
  dwellerGlobalFilter: string;
  setDwellerGlobalFilter: (value: string) => void;
  dwellerColumnFilters: ColumnFiltersState;
  setDwellerColumnFilters: (filters: ColumnFiltersState) => void;
  dwellerQuickFilters: DwellerQuickFilters;
  setDwellerQuickFilter: (key: keyof DwellerQuickFilters, value: boolean) => void;
  /** Clear search + per-column filters + quick chips (not the persisted layout). */
  resetDwellerFilters: () => void;
  /**
   * Multi-select checkbox state driving the bulk action bar. Session-only (in the store,
   * not localStorage) so it survives switching tabs and coming back, but resets on reload.
   */
  dwellerRowSelection: RowSelectionState;
  setDwellerRowSelection: (selection: RowSelectionState) => void;

  // --- Quests tab: session-only view state -------------------------------------
  /**
   * Which Quests sub-tab is open (graph vs. daily objectives). Session-only, like the
   * filters below: switching sections and coming back reopens the same sub-tab.
   */
  questsTab: 'quests' | 'objectives';
  setQuestsTab: (tab: 'quests' | 'objectives') => void;
  /**
   * The full quest filter (facets + search). Held here instead of view-local state so a
   * carefully built filter survives hopping to another section and back; resets on reload
   * like every other transient filter.
   */
  questFilter: QuestFilter;
  setQuestFilter: (filter: QuestFilter) => void;
  /**
   * Last quest-map viewport (React Flow pan x/y + zoom). Restored on remount so returning
   * to the tab lands on the same spot in the graph instead of re-fitting the whole map.
   * Null until the user first moves the map.
   */
  questViewport: { x: number; y: number; zoom: number } | null;
  setQuestViewport: (viewport: { x: number; y: number; zoom: number } | null) => void;
  /**
   * Last selected quest (the URL `:detail` name). The URL stays the source of truth while
   * the tab is open; this shadow copy exists ONLY so QuestsView can restore the selection -
   * and with it the right-hand detail panel - when the sidebar re-enters the section at bare
   * `/quests`. Null after the user explicitly closes the panel, so closing sticks.
   */
  questDetail: string | null;
  setQuestDetail: (name: string | null) => void;

  // --- Pets table: session-only filters ---------------------------------------
  petGlobalFilter: string;
  setPetGlobalFilter: (value: string) => void;
  petColumnFilters: ColumnFiltersState;
  setPetColumnFilters: (filters: ColumnFiltersState) => void;

  // --- Mr. Handies table: session-only filters (mirrors the Pets slices) ------
  handyGlobalFilter: string;
  setHandyGlobalFilter: (value: string) => void;
  handyColumnFilters: ColumnFiltersState;
  setHandyColumnFilters: (filters: ColumnFiltersState) => void;

  // --- Unified table system: generic per-table persisted layout ---------------
  /**
   * Keyed table layout (sort + column visibility/order/sizing) for every table in the
   * app, addressed by a stable string key (e.g. 'dwellers', 'pets', 'storage.weapons',
   * 'equipPicker.weapon'). Any table location persists its column choices through the
   * shared `useTableLayout` hook instead of a bespoke slice per table.
   */
  tableLayouts: Record<string, Partial<TableLayout>>;
  setTableLayout: (key: string, patch: Partial<TableLayout>) => void;
}

/** localStorage key for the persisted slice. */
export const UI_STORAGE_KEY = 'fsse:ui';

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      advancedUnlocked: false,
      setAdvancedUnlocked: (advancedUnlocked) => set({ advancedUnlocked }),
      advancedDraft: null,
      setAdvancedDraft: (advancedDraft) => set({ advancedDraft }),

      bulkFocus: null,
      setBulkFocus: (bulkFocus) => set({ bulkFocus }),

      exportOpen: false,
      openExport: () => set({ exportOpen: true }),
      closeExport: () => set({ exportOpen: false }),

      allowOutOfRange: false,
      setAllowOutOfRange: (allowOutOfRange) => set({ allowOutOfRange }),

      storageBypassCapacity: false,
      setStorageBypassCapacity: (storageBypassCapacity) => set({ storageBypassCapacity }),

      detailPanelWidth: 384,
      setDetailPanelWidth: (detailPanelWidth) => set({ detailPanelWidth }),
      roomPanelWidth: 288,
      setRoomPanelWidth: (roomPanelWidth) => set({ roomPanelWidth }),

      roomsAdvisorsCollapsed: false,
      setRoomsAdvisorsCollapsed: (roomsAdvisorsCollapsed) => set({ roomsAdvisorsCollapsed }),
      roomsEconomyCollapsed: false,
      setRoomsEconomyCollapsed: (roomsEconomyCollapsed) => set({ roomsEconomyCollapsed }),
      roomsBuildCollapsed: false,
      setRoomsBuildCollapsed: (roomsBuildCollapsed) => set({ roomsBuildCollapsed }),

      dwellerGlobalFilter: '',
      setDwellerGlobalFilter: (dwellerGlobalFilter) => set({ dwellerGlobalFilter }),
      dwellerColumnFilters: [],
      setDwellerColumnFilters: (dwellerColumnFilters) => set({ dwellerColumnFilters }),
      dwellerQuickFilters: NO_QUICK_FILTERS,
      setDwellerQuickFilter: (key, value) =>
        set((state) => ({
          dwellerQuickFilters: { ...state.dwellerQuickFilters, [key]: value },
        })),
      resetDwellerFilters: () =>
        set({
          dwellerGlobalFilter: '',
          dwellerColumnFilters: [],
          dwellerQuickFilters: NO_QUICK_FILTERS,
        }),
      dwellerRowSelection: {},
      setDwellerRowSelection: (dwellerRowSelection) => set({ dwellerRowSelection }),

      questsTab: 'quests',
      setQuestsTab: (questsTab) => set({ questsTab }),
      questFilter: EMPTY_QUEST_FILTER,
      setQuestFilter: (questFilter) => set({ questFilter }),
      questViewport: null,
      setQuestViewport: (questViewport) => set({ questViewport }),
      questDetail: null,
      setQuestDetail: (questDetail) => set({ questDetail }),

      petGlobalFilter: '',
      setPetGlobalFilter: (petGlobalFilter) => set({ petGlobalFilter }),
      petColumnFilters: [],
      setPetColumnFilters: (petColumnFilters) => set({ petColumnFilters }),

      handyGlobalFilter: '',
      setHandyGlobalFilter: (handyGlobalFilter) => set({ handyGlobalFilter }),
      handyColumnFilters: [],
      setHandyColumnFilters: (handyColumnFilters) => set({ handyColumnFilters }),

      tableLayouts: {},
      setTableLayout: (key, patch) =>
        set((state) => ({
          tableLayouts: {
            ...state.tableLayouts,
            [key]: { ...state.tableLayouts[key], ...patch },
          },
        })),
    }),
    {
      name: UI_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Schema version. v0 (pre-router) also persisted `activeSection` here; v1 drops it -
      // the router owns the active section now (URL + routing/sections.ts last-section key).
      // v2 (unified table system) folds the bespoke dweller*/pet* layout fields into the
      // generic `tableLayouts` map keyed 'dwellers'/'pets', so a returning user keeps their
      // saved roster layout under the new system.
      version: 2,
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== 'object') return persisted as Partial<UIState>;
        const next = { ...(persisted as Record<string, unknown>) };
        if (version < 1) delete next.activeSection;
        if (version < 2) {
          const pick = (prefix: 'dweller' | 'pet'): Partial<TableLayout> => {
            const layout: Partial<TableLayout> = {};
            const sorting = next[`${prefix}Sorting`];
            const visibility = next[`${prefix}ColumnVisibility`];
            const order = next[`${prefix}ColumnOrder`];
            const sizing = next[`${prefix}ColumnSizing`];
            if (sorting !== undefined) layout.sorting = sorting as TableLayout['sorting'];
            if (visibility !== undefined)
              layout.columnVisibility = visibility as TableLayout['columnVisibility'];
            if (order !== undefined) layout.columnOrder = order as TableLayout['columnOrder'];
            if (sizing !== undefined) layout.columnSizing = sizing as TableLayout['columnSizing'];
            return layout;
          };
          const layouts = (next.tableLayouts as Record<string, Partial<TableLayout>>) ?? {};
          next.tableLayouts = { dwellers: pick('dweller'), pets: pick('pet'), ...layouts };
          for (const prefix of ['dweller', 'pet'] as const) {
            delete next[`${prefix}Sorting`];
            delete next[`${prefix}ColumnVisibility`];
            delete next[`${prefix}ColumnOrder`];
            delete next[`${prefix}ColumnSizing`];
          }
        }
        return next as Partial<UIState>;
      },
      // Persist only the durable layout + toggles; never transient filters. (The active
      // section is persisted separately by the router layer - see routing/sections.ts.)
      partialize: (state) => ({
        allowOutOfRange: state.allowOutOfRange,
        storageBypassCapacity: state.storageBypassCapacity,
        detailPanelWidth: state.detailPanelWidth,
        roomPanelWidth: state.roomPanelWidth,
        roomsAdvisorsCollapsed: state.roomsAdvisorsCollapsed,
        roomsEconomyCollapsed: state.roomsEconomyCollapsed,
        roomsBuildCollapsed: state.roomsBuildCollapsed,
        tableLayouts: state.tableLayouts,
      }),
    },
  ),
);
