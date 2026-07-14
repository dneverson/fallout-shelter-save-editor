import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSaveStore } from '../../state/saveStore.ts';
import { useUIStore } from '../../state/uiStore.ts';
import { useSectionNavigate } from '../routing/useSectionNavigate.ts';
import { pushToast } from '../../state/toastStore.ts';
import { useGameData } from '../hooks/useGameData.ts';
import { useDismissOnOutsidePress } from '../hooks/useDismissOnOutsidePress.ts';
import {
  buildLayout,
  displayFloor,
  roomCellWidth,
  CELLS_PER_ROOM,
  ELEVATOR_TYPE,
  ENTRANCE_TYPE,
  FAKE_WASTELAND_TYPE,
  type RoomNode,
} from '../../domain/rooms/layout.ts';
import {
  canMergeRoom,
  canMoveRoom,
  canRemoveRoom,
  strandedIfRemoved,
} from '../../domain/rooms/validator.ts';
import {
  baseMergeLevel,
  validBuildOrigins,
  validMoveTargets,
} from '../../domain/rooms/placement.ts';
import { NO_THEME, themeOptionsFor } from '../../domain/rooms/themes.ts';
import {
  claimRoomUnlock,
  isRoomTypeUnlocked,
  unlockIdForRoomType,
} from '../../domain/rooms/roomUnlocks.ts';
import { applyLoadout } from '../../domain/ops/loadoutOps.ts';
import {
  statKeyForSpecial,
  suggestOutfitForStat,
  suggestWeapon,
} from '../../domain/selectors/loadoutSuggest.ts';
import {
  addRoom,
  assignDweller,
  maxRoomLevel,
  mergeRoomWith,
  moveMrHandyToFloor,
  moveRoom,
  mrHandiesByFloor,
  nextRoomId,
  removeRoom,
  repairAllRooms,
  repairRoom,
  residentHandiesOnFloor,
  setRoomLevel,
  setRoomPower,
  setRoomTheme,
  unassignDweller,
} from '../../domain/ops/roomOps.ts';
import { VAULT_HELPER_CHARACTER_TYPES } from '../../domain/model/saveSchema.ts';
import { isUltraciteSeasonActive } from '../../domain/ops/seasonOps.ts';
import {
  assignMrHandyToRoom,
  createMrHandy,
  selectMrHandyRows,
  unassignMrHandy,
  DEFAULT_MR_HANDY_HEALTH,
} from '../../domain/ops/mrHandyOps.ts';
import {
  addRockAt,
  addUltraciteAt,
  clearEmergencies,
  isRoomInEmergency,
  removeRockAt,
  removeRocks,
  removeUltraciteAt,
  roomsInEmergency,
  unlockRooms,
} from '../../domain/ops/vaultOps.ts';
import type { GameData } from '../../domain/gamedata/gameData.ts';
import { computeAdvisor, type Recommendation } from '../../domain/selectors/advisorSelectors.ts';
import { autoStaff, autoStaffPlan, type StaffMode } from '../../domain/ops/autoStaffOps.ts';
import {
  completeRoomTimersNow,
  completeTrainingSlotNow,
  roomTimers,
  isProductionAwaitingCollect,
} from '../../domain/ops/timerOps.ts';
import { diagnose } from '../../domain/health/diagnostics.ts';
import { RoomGrid } from '../components/rooms/RoomGrid.tsx';
import { cellFromClient } from '../components/rooms/roomVisuals.ts';
import { ResourceEconomyPanel } from '../components/rooms/ResourceEconomyPanel.tsx';
import { RoomSidePanel, type RoomTimerRow } from '../components/rooms/RoomSidePanel.tsx';
import { ResizableSplit } from '../components/ResizableSplit.tsx';
import { BuildPalette, type BuildableRoom } from '../components/rooms/BuildPalette.tsx';
import { SectionToggle } from '../components/rooms/SectionToggle.tsx';
import { AssignRoomDialog } from '../components/rooms/AssignRoomDialog.tsx';
import { selectDwellerRows, type DwellerRow } from '../../domain/selectors/dwellerSelectors.ts';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';

// Vault Rooms Map - the visual pillar. Master-detail: the
// floor grid on the left, the selected-room side panel on the right, a Build palette on
// top. Every structural edit is gated by the layout validator; the grid only
// surfaces validator-approved drop cells and the panel disables blocked actions. The Casino
// is just another Build-palette entry. Geometry renders without game data;
// names / capacities / build costs enrich once it loads.

// What an auto-staff run targets: a MODE (every stat room, or only producers) or a single
// ROOM by deserializeID (the per-room side-panel button). Drives the shared confirm dialog.
type StaffTarget = { mode: StaffMode } | { roomId: number };

// Shared style for the Rooms-header bulk buttons (Repair all, Remove rocks, …) - small,
// outlined, count-bearing, and dimmed when there's nothing to do.
const HEADER_BTN =
  'rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent';

/** A room "needs repair" when it's hard-broken or has accumulated any damage
 *  (roomHealth.damageValue > 0). Matches the repair ops + the Repair-all count, and is
 *  confirmed against the real Vault1.sav (24/87 rooms carry damageValue > 0; none set broken). */
function roomNeedsRepair(room: RoomNode['room']): boolean {
  return room.broken === true || (room.roomHealth?.damageValue ?? 0) > 0;
}

/** Max dwellers for a room at its (mergeLevel, level) from the capacity catalog. */
function maxDwellersOf(gameData: GameData | null, node: RoomNode): number {
  if (!gameData || node.type === ELEVATOR_TYPE) return 0;
  const perMerge = gameData.roomCapacity.rooms[node.type]?.[String(node.mergeLevel)];
  return perMerge?.[String(node.level)]?.maxDwellers ?? 0;
}

/**
 * Buildable room types for the palette: real player-built rooms only. Excludes the pre-placed
 * Entrance and every quest/special room (class "Quest" covers the Overseer's office; class
 * "None" covers the quest dungeon rooms). Elevators (class Utility) and the legitimate
 * power/water variants stay.
 */
/** Core resources surfaced as a room's "produces" facts (Nuka is a per-cycle caps reward,
 *  not a stored-resource output, so it's excluded). */
const PRODUCED_RESOURCES = ['Food', 'Water', 'Energy'] as const;

/** Advisory severity → sort rank (higher = more urgent), for picking a room's top badge. */
const SEVERITY_RANK: Record<Recommendation['severity'], number> = { high: 3, medium: 2, low: 1 };

// Ultracite rooms are Ultracite Fever season rooms: they can be built, staffed, levelled and
// rushed in any vault, but the Mine yields no ultracite and the Workshop won't craft unless
// Ultracite Fever is the ACTIVE season (isUltraciteSeasonActive). The note is surfaced on the
// Build tile (tooltip + ⚠) and in the selected-room side panel, but only when it doesn't apply.
const ULTRACITE_ROOM_NOTE: Record<string, string> = {
  UltraciteMining:
    'Ultracite Fever season room. Assigned dwellers still train and you can rush cycles, but it produces no ultracite outside an active Ultracite Fever season.',
  UltraciteWeaponFactory:
    'Ultracite Fever season room. You can assign dwellers, but it will not craft outside an active Ultracite Fever season.',
};

function buildableRooms(
  gameData: GameData | null,
  claimed: ReadonlySet<string>,
  ultraciteActive: boolean,
): BuildableRoom[] {
  if (!gameData) return [];
  const out: BuildableRoom[] = [];
  for (const [type, meta] of gameData.roomMetadataByType) {
    if (type === 'Entrance' || meta.class === 'Quest' || meta.class === 'None') continue;
    // Facts at the base (un-merged, level 1) size - what a freshly-built room starts as.
    const base = gameData.roomCapacity.rooms[type]?.['1']?.['1'];
    const produced = gameData.roomProduction.rooms[type]?.['1']?.['1']?.produced ?? {};
    // Locked = the type has an unlock objective not yet in unlockableMgr.claimed. Starter
    // rooms (no objective) are never locked. Locked rooms stay buildable: placing one claims
    // its unlock in the same edit (see onPlace).
    const unlockId = unlockIdForRoomType(type);
    const note = ultraciteActive ? undefined : ULTRACITE_ROOM_NOTE[type];
    out.push({
      type,
      name: meta.name,
      cost: meta.buildCost.Nuka ?? 0,
      capacity: base?.maxDwellers ?? 0,
      primaryStat: meta.primaryStat,
      size: Math.max(1, Math.round(meta.width / CELLS_PER_ROOM)),
      produces: PRODUCED_RESOURCES.filter((r) => (produced[r] ?? 0) > 0),
      locked: unlockId !== null && !claimed.has(unlockId),
      roomClass: meta.class,
      ...(note ? { note } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function RoomsView() {
  const save = useSaveStore((s) => s.save);
  const seasonSave = useSaveStore((s) => s.seasonSave);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const goToSection = useSectionNavigate();
  // Selected room lives in the URL (#/rooms/:deserializeID) - deep-linkable + back-forward.
  const { detail } = useParams();
  const selectedId = detail != null && /^\d+$/.test(detail) ? Number(detail) : null;
  const setSelectedId = useCallback((id: number | null) => goToSection('rooms', id), [goToSection]);
  const setBulkFocus = useUIStore((s) => s.setBulkFocus);
  const panelWidth = useUIStore((s) => s.roomPanelWidth);
  const setPanelWidth = useUIStore((s) => s.setRoomPanelWidth);
  // Collapsible header sections (persisted): default open; minimizing either frees
  // vertical space for the room grid while building.
  const advisorsCollapsed = useUIStore((s) => s.roomsAdvisorsCollapsed);
  const setAdvisorsCollapsed = useUIStore((s) => s.setRoomsAdvisorsCollapsed);
  const economyCollapsed = useUIStore((s) => s.roomsEconomyCollapsed);
  const setEconomyCollapsed = useUIStore((s) => s.setRoomsEconomyCollapsed);
  const buildCollapsed = useUIStore((s) => s.roomsBuildCollapsed);
  const setBuildCollapsed = useUIStore((s) => s.setRoomsBuildCollapsed);
  const { data: gameData, status: gameDataStatus } = useGameData();

  const [buildType, setBuildType] = useState<string | null>(null);
  // Terrain-edit mode: clicking an empty underground cell places a rock or an ultracite
  // deposit. Mutually exclusive with build mode and move mode.
  const [terrainMode, setTerrainMode] = useState<'rock' | 'ultracite' | null>(null);
  // The picked-up Mr. Handy (rail): click its slot to arm, then an eligible floor to move.
  const [armedHandy, setArmedHandy] = useState<number | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  // Auto-staff confirm: holds the pending run's target while the confirm dialog is open. The
  // target is either a MODE (the banner's "all"/"output" buttons, filling every matching room)
  // or a single ROOM by deserializeID (the side panel's "Auto-staff this room"). The dialog
  // offers the same assign-vs-generate choice for both.
  const [staffConfirm, setStaffConfirm] = useState<StaffTarget | null>(null);
  // The room pending deletion (side-panel Delete button OR a drag onto the trash zone). The
  // confirm dialog targets this id, which may differ from the selected room.
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  // UX-G drag-to-rearrange: the room whose legal drop cells are shown for the keyboard/
  // non-drag "move mode" (the side-panel "Move" toggle). Pointer-drag works independently.
  const [movingId, setMovingId] = useState<number | null>(null);
  // UX-G drag-to-build: the live snap-ghost while a Build-palette box is dragged over the
  // grid. The grid shares its container rect via gridRef so we can map cursor → cell here.
  const gridRef = useRef<HTMLDivElement>(null);
  const [buildGhost, setBuildGhost] = useState<{
    row: number;
    col: number;
    legal: boolean;
  } | null>(null);

  const layout = useMemo(() => (save ? buildLayout(save) : null), [save]);

  // Mr. Handy rail: one slot per floor beside the grid. Only rendered when the vault owns
  // robots. A floor is an eligible move target while a robot is armed, has at least one
  // real room, and has NO robot yet (one per floor, the game rule).
  const handyRail = useMemo(() => {
    if (!save || !layout) return [];
    const actors = (save.dwellers?.actors ?? []).filter(
      (a) =>
        typeof a.characterType === 'number' && VAULT_HELPER_CHARACTER_TYPES.has(a.characterType),
    );
    if (actors.length === 0) return [];
    const byFloor = mrHandiesByFloor(save);
    const nameOf = (id: number): string =>
      actors.find((a) => a.serializeId === id)?.name ?? `Mr. Handy #${id}`;
    const floorsWithRooms = new Set(
      layout.nodes
        .filter((n) => n.type !== FAKE_WASTELAND_TYPE && n.type !== ELEVATOR_TYPE)
        .map((n) => n.row),
    );
    return Array.from({ length: layout.rows }, (_, row) => {
      const ids = byFloor.get(row) ?? [];
      const first = ids[0];
      return {
        row,
        ...(first !== undefined ? { handy: { id: first, name: nameOf(first) } } : {}),
        eligible: armedHandy !== null && ids.length === 0 && floorsWithRooms.has(row),
      };
    });
  }, [save, layout, armedHandy]);

  const onHandySlotClick = (row: number): void => {
    const slot = handyRail[row];
    if (!slot) return;
    if (slot.handy) {
      setArmedHandy((cur) => (cur === slot.handy!.id ? null : slot.handy!.id));
      return;
    }
    if (slot.eligible && armedHandy !== null) {
      const id = armedHandy;
      applyEdit((s) => moveMrHandyToFloor(s, id, row), 'Move Mr. Handy');
      pushToast(`Mr. Handy moved to floor ${displayFloor(row)}`);
      setArmedHandy(null);
    }
  };

  // Mr. Handy roster for the side panel's per-room assign flow: the selected floor's robot
  // (one per floor, the game rule) and the pool of unassigned robots ("outside the vault").
  const handyRows = useMemo(() => (save ? selectMrHandyRows(save) : []), [save]);
  const unassignedHandies = useMemo(
    () =>
      handyRows.filter((h) => h.floor === null).map((h) => ({ id: h.serializeId, name: h.name })),
    [handyRows],
  );

  // Drag-and-drop counterpart of the click-to-arm flow: the grid validates the drop
  // target (an eligible floor slot / the outside zone) before reporting it here.
  const onHandyDrop = (
    id: number,
    target: { type: 'floor'; row: number } | { type: 'outside' } | { type: 'none' },
  ): void => {
    setArmedHandy(null);
    if (target.type === 'floor') {
      applyEdit((s) => moveMrHandyToFloor(s, id, target.row), 'Move Mr. Handy');
      pushToast(`Mr. Handy moved to floor ${displayFloor(target.row)}`);
    } else if (target.type === 'outside') {
      const placed = (handyRows.find((h) => h.serializeId === id)?.floor ?? null) !== null;
      if (placed) {
        applyEdit((s) => unassignMrHandy(s, id), 'Unassign Mr. Handy');
        pushToast('Mr. Handy sent outside the vault (it waits at the door).');
      }
    }
  };

  // Advisor report (moved onto this screen): the resource-economy strip above the build
  // palette, plus per-room recommendations surfaced as a grid alert triangle + side-panel
  // detail. Cheap O(rooms×dwellers) recompute, memoized on save + game data.
  const advisorReport = useMemo(
    () => (save && gameData ? computeAdvisor(save, gameData) : null),
    [save, gameData],
  );
  // Auto-staff plans: empty work slots (by authoritative savedRoom) and the assign-vs-generate
  // split, computed for both targets - every stat room ("all") and resource producers only
  // ("output"). Drive the two banner buttons + the confirm dialog. Cheap, memoized.
  const staffPlanAll = useMemo(
    () => (save && gameData ? autoStaffPlan(save, gameData, 'all') : null),
    [save, gameData],
  );
  const staffPlanOutput = useMemo(
    () => (save && gameData ? autoStaffPlan(save, gameData, 'output') : null),
    [save, gameData],
  );
  const planForMode = (mode: StaffMode): typeof staffPlanAll =>
    mode === 'all' ? staffPlanAll : staffPlanOutput;
  // The selected room's own staff plan (mode 'all' so non-producer stat rooms still count),
  // scoped to its deserializeID. Drives the side-panel "Auto-staff this room" button + its
  // confirm dialog. Null for non-stat rooms / no selection (freeSlots 0 hides the button).
  const selectedRoomStaffPlan = useMemo(
    () =>
      save && gameData && selectedId !== null
        ? autoStaffPlan(save, gameData, 'all', selectedId)
        : null,
    [save, gameData, selectedId],
  );
  const planForTarget = (target: StaffTarget): typeof staffPlanAll =>
    'mode' in target ? planForMode(target.mode) : selectedRoomStaffPlan;
  // Broken worker-list entries (ghost dweller ids / double bookings): when present the
  // grid's occupant counts include impossible entries. Surface it with a one-click fix
  // (the diagnosis carries its own repair).
  const desync = useMemo(
    () => (save ? (diagnose(save).find((d) => d.kind === 'roomAssignmentDesync') ?? null) : null),
    [save],
  );
  // The plan for the run the confirm dialog is currently asking about (null when closed).
  const pendingPlan = staffConfirm ? planForTarget(staffConfirm) : null;
  // Recommendations grouped by the room they target (deficit/idle/happiness recs have no
  // roomId, so they only feed the resource strip - not a per-room badge).
  const advisoriesByRoom = useMemo(() => {
    const map = new Map<number, Recommendation[]>();
    for (const rec of advisorReport?.recommendations ?? []) {
      if (rec.link.roomId === undefined) continue;
      const list = map.get(rec.link.roomId);
      if (list) list.push(rec);
      else map.set(rec.link.roomId, [rec]);
    }
    return map;
  }, [advisorReport]);
  // Highest severity wins the room's single alert triangle (SEVERITY_RANK is module-scoped).
  const roomAdvisory = useCallback(
    (id: number): { severity: Recommendation['severity']; title: string } | null => {
      const recs = advisoriesByRoom.get(id);
      if (!recs || recs.length === 0) return null;
      const top = recs.reduce((a, b) =>
        SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a,
      );
      return {
        severity: top.severity,
        title: recs.length > 1 ? `${recs.length} advisories` : top.title,
      };
    },
    [advisoriesByRoom],
  );

  // Every sticky mode exits the same way (shared hook): a pointer-down anywhere the mode's
  // own targets don't claim dismisses it - blank space, the side panel, the nav, a built
  // room. Each mode's toggle control also deselects on a second click (palette tile, the
  // +Rock/+Ultracite header buttons, a robot chip).
  //
  // Build mode is sticky only on LEGAL drop cells (place the same room repeatedly); clicks
  // on a Build palette tile are left to the palette (switch type / toggle the active off).
  const allowBuildPress = useCallback(
    (target: HTMLElement): boolean =>
      (!!gridRef.current?.contains(target) && !!target.closest('[data-drop-cell]')) ||
      !!target.closest('[data-build-tile]'),
    [],
  );
  const dismissBuild = useCallback(() => setBuildType(null), []);
  useDismissOnOutsidePress(buildType !== null, allowBuildPress, dismissBuild);

  // Terrain paint stays active over its own surfaces: placement cells and existing rock /
  // ultracite cells (so excavating a misplaced one doesn't exit); the header toggles
  // handle themselves (second click exits, the other button switches kind).
  const allowTerrainPress = useCallback(
    (target: HTMLElement): boolean =>
      !!target.closest('[data-terrain-cell]') || !!target.closest('[data-terrain-toggle]'),
    [],
  );
  const dismissTerrain = useCallback(() => setTerrainMode(null), []);
  useDismissOnOutsidePress(terrainMode !== null, allowTerrainPress, dismissTerrain);

  // An armed Mr. Handy disarms on presses outside the floor rail / outside zone (its own
  // chips already toggle off on a second click, and eligible slots place it).
  const allowHandyPress = useCallback(
    (target: HTMLElement): boolean =>
      !!target.closest('[data-handy-floor]') || !!target.closest('[data-handy-outside]'),
    [],
  );
  const disarmHandy = useCallback(() => setArmedHandy(null), []);
  useDismissOnOutsidePress(armedHandy !== null, allowHandyPress, disarmHandy);

  // Validator-approved drop origins for a room id - computed on demand (drag start / move
  // mode), not per render, so the O(cells × validator) sweep stays off the hot path.
  const moveTargetsFor = useCallback(
    (id: number): ReadonlySet<string> => (layout ? validMoveTargets(layout, id) : new Set()),
    [layout],
  );

  // The validator's reason a live drag drop is illegal - feeds the grid's drag feedback banner.
  const moveBlockReason = useCallback(
    (id: number, row: number, col: number): string | null => {
      if (!layout) return null;
      const res = canMoveRoom(layout, id, row, col);
      return res.ok ? null : res.reason;
    },
    [layout],
  );

  const labelOf = (type: string): string => gameData?.roomMetadataByType.get(type)?.name ?? type;

  // When the room in move mode has NO legal destination, explain why for the side panel: a
  // load-bearing room (a neighbour reaches the entrance only through it) names the rooms that
  // must move first; otherwise the block is geometric (no free aligned zone fits it).
  const moveBlockedReason = useMemo((): string | undefined => {
    if (movingId === null || !layout) return undefined;
    const moving = layout.byId.get(movingId);
    if (!moving) return undefined;
    const targets = validMoveTargets(layout, movingId);
    const hasReal = [...targets].some((k) => k !== `${moving.row},${moving.col}`);
    if (hasReal) return undefined;
    const stranded = strandedIfRemoved(layout, movingId);
    if (stranded.length === 0) {
      return 'No free space elsewhere fits this room - clear or rearrange a zone first.';
    }
    const names = [...new Set(stranded.map((id) => labelOf(layout.byId.get(id)?.type ?? '')))];
    const list = names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '');
    const plural = names.length > 1;
    return `Can’t move: ${list} ${plural ? 'reach' : 'reaches'} the entrance only through this room - move ${
      plural ? 'those rooms' : 'that room'
    } first.`;
    // labelOf is derived from gameData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movingId, layout, gameData]);

  // Dweller name + current-location lookups (for the side panel + assign dialog).
  const dwellers = useMemo(() => save?.dwellers?.dwellers ?? [], [save]);
  // Full DwellerRow projection (shared schema shape) for the standardized assign-room table.
  const allDwellerRows = useMemo(
    () => (save ? selectDwellerRows(save, gameData ?? undefined) : []),
    [save, gameData],
  );
  const nameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const d of dwellers) {
      const name = `${d.name ?? ''} ${d.lastName ?? ''}`.trim() || `#${d.serializeId}`;
      map.set(d.serializeId, name);
    }
    return map;
  }, [dwellers]);
  // `claimed` only changes when a room is unlocked (structural sharing), so the palette's
  // locked flags refresh on build without recomputing on unrelated save edits.
  const claimed = save?.unlockableMgr?.claimed;
  // Ultracite rooms only function while Ultracite Fever is the active season; otherwise the
  // Build tiles + side panel carry a "won't function here" note (see ULTRACITE_ROOM_NOTE).
  const ultraciteActive = isUltraciteSeasonActive(seasonSave);
  const palette = useMemo(
    () => buildableRooms(gameData, new Set(claimed ?? []), ultraciteActive),
    [gameData, claimed, ultraciteActive],
  );

  const buildMerge = buildType
    ? baseMergeLevel(buildType, gameData?.roomMetadataByType.get(buildType)?.width)
    : 1;
  const buildOrigins = useMemo(
    () => (layout && buildType ? validBuildOrigins(layout, buildType, buildMerge) : null),
    [layout, buildType, buildMerge],
  );
  const buildWidth = buildType ? roomCellWidth(buildType, buildMerge) : 3;

  // Running timers in the selected room, resolved for display (trainee names, the
  // crafted item's catalog name). Each side-panel action completes the timer(s) so
  // they finish during the game's on-load catch-up (timerOps). Computed before the
  // no-save early return (hooks must run unconditionally); re-derives the node itself.
  const nodeTimers = useMemo((): RoomTimerRow[] => {
    const timerNode = layout && selectedId !== null ? (layout.byId.get(selectedId) ?? null) : null;
    if (!save || !timerNode) return [];
    return roomTimers(save, timerNode.deserializeID).map((t) => {
      const craftedId = t.kind === 'crafting' ? timerNode.room.CraftingItemId : undefined;
      const itemName =
        craftedId !== undefined && craftedId !== ''
          ? (gameData?.weapons.find((w) => w.id === craftedId)?.name ??
            gameData?.outfits.find((o) => o.id === craftedId)?.name ??
            craftedId)
          : undefined;
      return {
        kind: t.kind,
        remainingSeconds: t.remainingSeconds,
        ...(t.slotDwellerId !== undefined
          ? {
              slotDwellerId: t.slotDwellerId,
              slotDwellerName: nameById.get(t.slotDwellerId) ?? `#${t.slotDwellerId}`,
            }
          : {}),
        ...(itemName !== undefined ? { itemName } : {}),
      };
    });
  }, [save, layout, selectedId, gameData, nameById]);

  if (!save || !layout) {
    return <div className="p-6 text-sm text-neutral-400">No save loaded.</div>;
  }

  const node = selectedId !== null ? (layout.byId.get(selectedId) ?? null) : null;
  const deleteTarget = deleteTargetId !== null ? (layout.byId.get(deleteTargetId) ?? null) : null;
  const meta = node ? gameData?.roomMetadataByType.get(node.type) : undefined;
  const maxLevel = meta?.maxLevel ?? 3;
  const nodeMaxDwellers = node ? maxDwellersOf(gameData, node) : 0;
  // Themes ("decoration") are stored per room TYPE in save.specialTheme.themeByRoomType.
  const themeOptions = node ? themeOptionsFor(node.type) : [];
  const currentTheme = node
    ? (save.specialTheme?.themeByRoomType?.[node.type] ?? NO_THEME)
    : NO_THEME;

  const onPlace = (row: number, col: number): void => {
    if (!buildType) return;
    const meta2 = gameData?.roomMetadataByType.get(buildType);
    const newId = nextRoomId(save);
    // Building a locked room claims its unlock in the SAME edit (one undo step).
    const wasLocked = !isRoomTypeUnlocked(save, buildType);
    applyEdit(
      (s) =>
        claimRoomUnlock(
          addRoom(s, {
            type: buildType,
            class: meta2?.class ?? '',
            row,
            col,
            mergeLevel: buildMerge,
          }),
          buildType,
        ),
      'Build room',
    );
    // Build mode stays ACTIVE (sticky) so the same room type can be placed repeatedly without
    // re-picking it from the palette. The new room is selected for quick editing; exit build
    // mode via the palette's Cancel button or by clicking the active tile again.
    setSelectedId(newId);
    pushToast(
      wasLocked ? `Built ${labelOf(buildType)} · room unlocked` : `Built ${labelOf(buildType)}`,
    );
  };

  const onExcavateRock = (row: number, col: number): void => {
    applyEdit((s) => removeRockAt(s, row, col), 'Excavate rock');
    pushToast('Rock excavated');
  };

  const onRemoveUltracite = (row: number, col: number): void => {
    applyEdit((s) => removeUltraciteAt(s, row, col), 'Remove ultracite');
    pushToast('Ultracite deposit removed');
  };

  // Terrain placement (one undo step per cell). Mode is sticky so several cells can be
  // painted in a row; toggle the header button again, click anywhere outside the terrain
  // cells (useDismissOnOutsidePress above), or enter build mode to exit.
  const onPlaceTerrain = (row: number, col: number): void => {
    if (terrainMode === 'rock') {
      applyEdit((s) => addRockAt(s, row, col), 'Add rock');
      pushToast('Rock placed');
    } else if (terrainMode === 'ultracite') {
      applyEdit((s) => addUltraciteAt(s, row, col), 'Add ultracite');
      pushToast('Ultracite deposit placed');
    }
  };

  const toggleTerrain = (mode: 'rock' | 'ultracite'): void => {
    setBuildType(null);
    setMovingId(null);
    setTerrainMode((m) => (m === mode ? null : mode));
  };

  // Selecting a room (or opening the Build palette) cancels any in-progress move mode.
  // Clicking the already-selected room toggles it back off (deselect + close the side panel).
  const selectRoom = (id: number): void => {
    setMovingId(null);
    setSelectedId(id === selectedId ? null : id);
  };
  // Clicking empty (non-room) grid space deselects and closes the side panel.
  const deselectRoom = (): void => {
    setMovingId(null);
    setSelectedId(null);
  };
  const pickBuild = (type: string | null): void => {
    setMovingId(null);
    setTerrainMode(null);
    setBuildType(type);
  };

  // UX-G drag-to-build: starting a palette drag enters build mode (green cells appear); the
  // cursor is then snapped to a clamped grid origin for the ghost, and a release on a legal
  // origin builds via the same validator-gated onPlace as the click flow.
  const beginBuildDrag = (type: string): void => {
    setMovingId(null);
    setTerrainMode(null);
    setBuildType(type);
  };
  const buildGhostAt = (
    clientX: number,
    clientY: number,
  ): { row: number; col: number; legal: boolean } | null => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect || !buildOrigins) return null;
    const { row, col } = cellFromClient(rect, clientX, clientY);
    const r = Math.min(layout.rows - 1, Math.max(0, row));
    const c = Math.min(Math.max(0, layout.cols - buildWidth), Math.max(0, col));
    return { row: r, col: c, legal: buildOrigins.has(`${r},${c}`) };
  };
  const onBuildDragMove = (x: number, y: number): void => setBuildGhost(buildGhostAt(x, y));
  const onBuildDragEnd = (x: number, y: number): void => {
    const ghost = buildGhostAt(x, y);
    setBuildGhost(null);
    // A legal drop places the room; an illegal/blank drop is a no-op that KEEPS build mode
    // active (sticky building) rather than cancelling - only the palette Cancel/toggle exits.
    if (ghost?.legal) onPlace(ghost.row, ghost.col);
  };

  // UX-G: commit a drag-drop or move-mode placement as one validator-gated edit + toast. The
  // room keeps its deserializeID, so its occupants travel with it (savedRoom stays in sync).
  // moveRoom also enforces the HARD one-Mr.-Handy-per-floor rule: if this room carries a
  // robot onto a floor that already has one, the resident robot is evicted (sent outside
  // the vault) - named in the toast so the eviction isn't silent.
  const onMoveRoom = (id: number, row: number, col: number): void => {
    const movedHasHandy = (layout.byId.get(id)?.room.mrHandyList ?? []).length > 0;
    const evicted = movedHasHandy ? residentHandiesOnFloor(save, id, row) : [];
    const evictedName =
      evicted.length > 0
        ? (handyRows.find((h) => h.serializeId === evicted[0])?.name ?? 'Mr. Handy')
        : null;
    applyEdit((s) => moveRoom(s, id, row, col), 'Move room');
    setMovingId(null);
    pushToast(
      `Moved ${labelOf(layout.byId.get(id)?.type ?? '')}${
        evictedName ? ` · ${evictedName} sent outside (one robot per floor)` : ''
      }`,
    );
  };

  // Drag-to-move for rocks / ultracite deposits (the grid validates the target cell is
  // empty): one undoable edit = remove from the old cell + add at the new one.
  const onMoveTerrain = (
    kind: 'rock' | 'ultracite',
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number,
  ): void => {
    if (kind === 'rock') {
      applyEdit((s) => addRockAt(removeRockAt(s, fromRow, fromCol), toRow, toCol), 'Move rock');
      pushToast('Rock moved');
    } else {
      applyEdit(
        (s) => addUltraciteAt(removeUltraciteAt(s, fromRow, fromCol), toRow, toCol),
        'Move ultracite',
      );
      pushToast('Ultracite deposit moved');
    }
  };

  // Rooms-screen "Repair all" (finding 5): the only bulk repair was buried in Bulk → Max
  // Everything. Disabled when nothing is damaged; one undo step + toast.
  const damagedCount = (save.vault?.rooms ?? []).filter(roomNeedsRepair).length;
  const repairAll = (): void => {
    applyEdit((s) => repairAllRooms(s), 'Repair all rooms');
    pushToast(`Repaired ${damagedCount} room${damagedCount === 1 ? '' : 's'}`);
  };

  // Room-scoped bulk actions surfaced inline in the header (also available in Bulk). Each is
  // one undo step + a toast, disabled when there's nothing to do.
  const rocksCount = save.vault?.rocks?.length ?? 0;
  const emergencyCount = roomsInEmergency(save).length;
  const roomsUnlocked = save.unlockableMgr?.claimed?.length ?? 0;
  const roomsTotal = gameData?.unlockables.roomUnlocks.length ?? 0;
  const removeAllRocks = (): void => {
    applyEdit((s) => removeRocks(s), 'Remove rocks');
    pushToast(`Removed ${rocksCount} rock${rocksCount === 1 ? '' : 's'}`);
  };
  const clearAllEmergencies = (): void => {
    applyEdit((s) => clearEmergencies(s), 'Clear emergencies');
    pushToast(`Cleared ${emergencyCount} emergenc${emergencyCount === 1 ? 'y' : 'ies'}`);
  };
  const unlockAllRooms = (): void => {
    if (!gameData) return;
    const ids = gameData.unlockables.roomUnlocks;
    applyEdit((s) => unlockRooms(s, ids), 'Unlock all rooms');
    pushToast('Unlocked all rooms');
  };

  // Auto-staff: fill the targeted rooms' empty slots in one undoable edit + a toast. The
  // confirm dialog offers two paths: assign idle dwellers first (generating only the
  // shortfall), or generate fresh recruits for every slot and leave idle dwellers alone.
  const runAutoStaff = (target: StaffTarget, assignExisting: boolean): void => {
    const plan = planForTarget(target);
    if (!gameData || !plan || plan.freeSlots === 0) return;
    // A room target staffs only that room (mode 'all' so non-producer stat rooms qualify too);
    // a mode target sweeps every matching room.
    const opts =
      'roomId' in target
        ? { mode: 'all' as StaffMode, generate: true, assignExisting, onlyRoomId: target.roomId }
        : { mode: target.mode, generate: true, assignExisting };
    const label =
      'roomId' in target
        ? 'Auto-staff room'
        : target.mode === 'all'
          ? 'Auto-staff all rooms'
          : 'Auto-staff output rooms';
    applyEdit((s) => autoStaff(s, gameData, opts), label);
    const assigned = assignExisting ? plan.toAssign : 0;
    const generated = assignExisting ? plan.toGenerate : plan.freeSlots;
    const parts: string[] = [];
    if (assigned > 0) parts.push(`Assigned ${assigned} dweller${assigned === 1 ? '' : 's'}`);
    if (generated > 0) parts.push(`generated ${generated} new`);
    pushToast(parts.length ? parts.join(', ') : 'No changes');
    setStaffConfirm(null);
  };
  const onAutoStaffClick = (target: StaffTarget): void => {
    const plan = planForTarget(target);
    if (!plan || plan.freeSlots === 0) return;
    setStaffConfirm(target);
  };
  const fixDesync = (): void => {
    if (!desync) return;
    applyEdit(desync.repair, 'Clean room worker lists');
    pushToast(`Removed ${desync.count} impossible worker entr${desync.count === 1 ? 'y' : 'ies'}`);
  };

  const occupants = (node?.room.dwellers ?? []).map((id) => ({
    id,
    name: nameById.get(id) ?? `#${id}`,
  }));

  // Per-room loadout context action: equip the room's primary-SPECIAL default outfit +
  // best weapon onto its occupants. Available only for staffed rooms with a primary stat.
  // The exact picks are resolved up-front so the side panel can name them (finding 4 - the
  // button used to be opaque about what it equips).
  const statKey = node && gameData ? statKeyForSpecial(meta?.primaryStat) : null;
  const suggestedOutfit = gameData && statKey ? suggestOutfitForStat(gameData, statKey) : null;
  const suggestedWeapon = gameData && statKey ? suggestWeapon(gameData) : null;
  const applyRoomLoadout =
    node && gameData && statKey
      ? () => {
          const outfitId = suggestedOutfit?.id;
          const weaponId = suggestedWeapon?.id;
          const ids = node.room.dwellers ?? [];
          applyEdit(
            (s) =>
              applyLoadout(s, ids, {
                ...(outfitId ? { outfitId } : {}),
                ...(weaponId ? { weaponId } : {}),
              }),
            'Apply room loadout',
          );
          pushToast(`Loadout applied to ${ids.length} dweller${ids.length === 1 ? '' : 's'}`);
        }
      : undefined;
  const loadoutHelp =
    node && statKey
      ? `Equips ${suggestedOutfit?.name ?? 'the best outfit'} (the strongest ${meta?.primaryStat} ` +
        `outfit) + ${suggestedWeapon?.name ?? 'the best weapon'} (highest damage) onto all ` +
        `${occupants.length} occupant${occupants.length === 1 ? '' : 's'}, overwriting their ` +
        `current gear. Configure exact loadouts per room type in Bulk → Location loadouts.`
      : undefined;
  const openBulkLoadouts = (): void => {
    setBulkFocus('loadouts');
    goToSection('bulk');
  };

  // Dwellers assignable to the selected room = everyone not already in it (filtered from the
  // shared DwellerRow projection below), so the assign dialog renders the standardized dweller
  // table (full column schema behind the Columns button), like every other dweller picker.
  const assignable: DwellerRow[] = node
    ? allDwellerRows.filter((r) => !(node.room.dwellers ?? []).includes(r.serializeId))
    : [];

  // Below md the header buttons/banners/palette stack tall enough to push the grid off
  // screen, so the PANE scrolls on phones. On md+ the grid keeps its own internal scroll,
  // but the pane stays `overflow-y-auto` (not `visible`) so that on SHORT desktop viewports
  // - laptops, or a browser bloated by bookmark/translate bars - the pre-grid content
  // (header, advisor + economy banners, build palette) can still be scrolled into view
  // instead of being clipped behind the bottom edge with no scrollbar.
  const gridPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">Rooms</h2>
        <span className="text-sm text-neutral-400">{layout.nodes.length} rooms</span>
        {gameDataStatus === 'loading' && (
          <span className="text-xs text-neutral-400">loading game data…</span>
        )}
        {gameDataStatus === 'error' && (
          <span className="text-xs text-amber-500">game data unavailable - names/costs hidden</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={damagedCount === 0}
            onClick={repairAll}
            title={
              damagedCount === 0
                ? 'No damaged rooms'
                : `Clears accumulated incident (scorch) damage back to zero on all ${damagedCount} ` +
                  `damaged room${damagedCount === 1 ? '' : 's'}. This damage is cosmetic in a saved ` +
                  `game and does not stop production; mainly fixes saves captured mid-incident.`
            }
            className={HEADER_BTN}
          >
            Repair all{damagedCount > 0 ? ` (${damagedCount})` : ''}
          </button>
          <button
            type="button"
            disabled={rocksCount === 0}
            onClick={removeAllRocks}
            title={rocksCount === 0 ? 'No rocks to remove' : `Remove ${rocksCount} rocks`}
            className={HEADER_BTN}
          >
            Remove rocks{rocksCount > 0 ? ` (${rocksCount})` : ''}
          </button>
          <button
            type="button"
            data-terrain-toggle=""
            onClick={() => toggleTerrain('rock')}
            aria-pressed={terrainMode === 'rock'}
            title="Place rocks on empty underground cells (click again to exit)"
            className={`${HEADER_BTN} ${terrainMode === 'rock' ? 'border-amber-500 text-amber-300' : ''}`}
          >
            + Rock
          </button>
          <button
            type="button"
            data-terrain-toggle=""
            onClick={() => toggleTerrain('ultracite')}
            aria-pressed={terrainMode === 'ultracite'}
            title="Place ultracite deposits on empty underground cells (click again to exit). The Ultracite Mining room is a season-vault feature."
            className={`${HEADER_BTN} ${terrainMode === 'ultracite' ? 'border-fuchsia-500 text-fuchsia-300' : ''}`}
          >
            + Ultracite
          </button>
          <button
            type="button"
            disabled={emergencyCount === 0}
            onClick={clearAllEmergencies}
            title={emergencyCount === 0 ? 'No active emergencies' : `Clear ${emergencyCount}`}
            className={HEADER_BTN}
          >
            Clear emergencies{emergencyCount > 0 ? ` (${emergencyCount})` : ''}
          </button>
          <button
            type="button"
            disabled={roomsTotal === 0 || roomsUnlocked >= roomsTotal}
            onClick={unlockAllRooms}
            title={
              roomsTotal === 0
                ? 'Loading game data…'
                : `Unlock all rooms (${roomsUnlocked} / ${roomsTotal})`
            }
            className={HEADER_BTN}
          >
            Unlock all rooms
          </button>
        </div>
      </div>

      {desync && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="min-w-0 text-neutral-200">
              <span className="font-medium text-red-300">Broken room worker lists.</span>{' '}
              {desync.count} worker entr{desync.count === 1 ? 'y' : 'ies'} point at dwellers that do
              not exist or book one dweller into two rooms at once, so the occupant counts below may
              look wrong. See the per-entry breakdown on the Vault tab&apos;s health check.
            </p>
            <button
              type="button"
              onClick={fixDesync}
              className="shrink-0 rounded bg-red-500 px-3 py-1.5 text-sm font-medium text-neutral-50 transition-colors hover:bg-red-400"
            >
              Fix worker lists ({desync.count})
            </button>
          </div>
        </div>
      )}

      {/* Advisors section (the recommendations banner), collapsible to just its header
          line so the grid gets the vertical space back (persisted preference). */}
      {advisorReport && (advisorReport.issueCount > 0 || (staffPlanAll?.freeSlots ?? 0) > 0) && (
        <section>
          <SectionToggle
            label="Advisors"
            collapsed={advisorsCollapsed}
            onToggle={() => setAdvisorsCollapsed(!advisorsCollapsed)}
            {...(advisorsCollapsed && advisorReport.issueCount > 0
              ? {
                  hint: `${advisorReport.issueCount} recommendation${advisorReport.issueCount === 1 ? '' : 's'}`,
                }
              : {})}
          />
          {!advisorsCollapsed && (
            <div className="mt-1.5">
              <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                <p className="text-neutral-300">
                  {advisorReport.issueCount > 0 && (
                    <span className="font-medium text-amber-300">
                      {advisorReport.issueCount} advisor{' '}
                      {advisorReport.issueCount === 1 ? 'recommendation' : 'recommendations'}.{' '}
                    </span>
                  )}
                  Optimization tips (understaffed rooms, resource deficits, idle dwellers) - not
                  save errors. A{' '}
                  <span aria-hidden className="text-amber-400">
                    ⚠️
                  </span>{' '}
                  marks <span className="text-neutral-200">resource-producing rooms</span> (food /
                  water / power) that need attention - click one for details. Other stat rooms (gym,
                  radio, lounge…) don&apos;t flag but can still be staffed below.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {staffPlanOutput && staffPlanOutput.freeSlots > 0 && (
                    <button
                      type="button"
                      onClick={() => onAutoStaffClick({ mode: 'output' })}
                      title={`Fill ${staffPlanOutput.freeSlots} empty slot${staffPlanOutput.freeSlots === 1 ? '' : 's'} in producer rooms (assign ${staffPlanOutput.toAssign} idle${staffPlanOutput.toGenerate > 0 ? `, generate ${staffPlanOutput.toGenerate}` : ''})`}
                      className="rounded bg-amber-500 px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-amber-400"
                    >
                      Auto-staff output rooms ({staffPlanOutput.freeSlots})
                    </button>
                  )}
                  {staffPlanAll && staffPlanAll.freeSlots > 0 && (
                    <button
                      type="button"
                      onClick={() => onAutoStaffClick({ mode: 'all' })}
                      title={`Fill ${staffPlanAll.freeSlots} empty slot${staffPlanAll.freeSlots === 1 ? '' : 's'} across every stat room (assign ${staffPlanAll.toAssign} idle${staffPlanAll.toGenerate > 0 ? `, generate ${staffPlanAll.toGenerate}` : ''})`}
                      className="rounded border border-amber-500/60 px-3 py-1.5 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/10"
                    >
                      Auto-staff all rooms ({staffPlanAll.freeSlots})
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Resource economy - its own collapsible section, independent of Advisors. */}
      {advisorReport && (
        <ResourceEconomyPanel
          resources={advisorReport.resources}
          collapsed={economyCollapsed}
          onToggleCollapsed={() => setEconomyCollapsed(!economyCollapsed)}
        />
      )}

      <BuildPalette
        rooms={palette}
        activeType={buildType}
        onPick={pickBuild}
        onBuildDragStart={beginBuildDrag}
        onBuildDragMove={onBuildDragMove}
        onBuildDragEnd={onBuildDragEnd}
        collapsed={buildCollapsed}
        onToggleCollapsed={() => setBuildCollapsed(!buildCollapsed)}
      />

      {/* Guarantee the grid a real height on EVERY viewport. flex-1 lets it grow to fill on
          tall screens; the min-height floor stops it collapsing on short ones - without it the
          palette + banners eat the whole pane and the flex-1 wrapper shrinks to ~0, leaving the
          vault map as an unusable sliver (the map's own scroll then hides all the rooms). With
          the floor the map stays usable and the pane scrolls to bring it into view. */}
      <div className="flex min-h-[65vh] flex-1 flex-col">
        <RoomGrid
          layout={layout}
          selectedId={selectedId}
          onSelect={selectRoom}
          onDeselect={deselectRoom}
          labelOf={labelOf}
          maxDwellersOf={(n) => maxDwellersOf(gameData, n)}
          needsRepair={(n) => roomNeedsRepair(n.room)}
          inEmergency={(n) => isRoomInEmergency(n.room)}
          roomAdvisory={(n) => roomAdvisory(n.deserializeID)}
          buildOrigins={buildOrigins}
          buildWidth={buildWidth}
          onPlace={onPlace}
          onExcavateRock={onExcavateRock}
          onRemoveUltracite={onRemoveUltracite}
          terrainMode={terrainMode}
          onPlaceTerrain={onPlaceTerrain}
          canMove={(n) => n.type !== ENTRANCE_TYPE && n.type !== FAKE_WASTELAND_TYPE}
          moveTargetsFor={moveTargetsFor}
          onMoveRoom={onMoveRoom}
          moveBlockReason={moveBlockReason}
          canRemove={(n) => canRemoveRoom(layout, n.deserializeID).ok}
          onDeleteRoom={(id) => setDeleteTargetId(id)}
          moveModeId={movingId}
          gridRef={gridRef}
          buildGhost={buildGhost}
          handyRail={handyRail}
          armedHandyId={armedHandy}
          onHandySlotClick={onHandySlotClick}
          outsideHandies={unassignedHandies}
          outsideRow={layout.nodes.find((n) => n.type === FAKE_WASTELAND_TYPE)?.row ?? 0}
          onOutsideHandyClick={(id) => setArmedHandy((cur) => (cur === id ? null : id))}
          armedHandyIsPlaced={
            armedHandy !== null &&
            (handyRows.find((h) => h.serializeId === armedHandy)?.floor ?? null) !== null
          }
          onSendArmedOutside={() => {
            if (armedHandy === null) return;
            const id = armedHandy;
            applyEdit((s) => unassignMrHandy(s, id), 'Unassign Mr. Handy');
            pushToast('Mr. Handy sent outside the vault (it waits at the door).');
            setArmedHandy(null);
          }}
          onHandyDragStart={(id) => setArmedHandy(id)}
          onHandyDrop={onHandyDrop}
          onMoveTerrain={onMoveTerrain}
        />
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      <ResizableSplit
        ariaLabel="Resize room detail panel"
        width={panelWidth}
        onWidthChange={setPanelWidth}
        min={240}
        left={gridPane}
        right={
          node ? (
            <RoomSidePanel
              node={node}
              label={labelOf(node.type)}
              maxLevel={maxLevel}
              maxDwellers={nodeMaxDwellers}
              occupants={occupants}
              advisories={advisoriesByRoom.get(node.deserializeID) ?? []}
              canRemove={canRemoveRoom(layout, node.deserializeID)}
              mergeable={canMergeRoom(layout, node.deserializeID)}
              onClose={() => {
                setMovingId(null);
                setSelectedId(null);
              }}
              {...(node.type !== ENTRANCE_TYPE && node.type !== FAKE_WASTELAND_TYPE
                ? {
                    onToggleMove: () =>
                      setMovingId((m) => (m === node.deserializeID ? null : node.deserializeID)),
                    moveActive: movingId === node.deserializeID,
                    ...(moveBlockedReason ? { moveBlockedReason } : {}),
                  }
                : {})}
              onSetLevel={(level) =>
                applyEdit(
                  (s) => setRoomLevel(s, node.deserializeID, level, maxLevel),
                  'Set room level',
                )
              }
              onMaxLevel={() =>
                applyEdit((s) => maxRoomLevel(s, node.deserializeID, maxLevel), 'Max room level')
              }
              onRepair={() => applyEdit((s) => repairRoom(s, node.deserializeID), 'Repair room')}
              onSetPower={(p) =>
                applyEdit((s) => setRoomPower(s, node.deserializeID, p), 'Toggle room power')
              }
              themeOptions={themeOptions}
              currentTheme={currentTheme}
              onSetTheme={(value) =>
                applyEdit((s) => setRoomTheme(s, node.type, value), 'Set room theme')
              }
              onMerge={() => {
                const m = canMergeRoom(layout, node.deserializeID);
                if (m.ok && m.neighbourId !== undefined) {
                  applyEdit(
                    (s) => mergeRoomWith(s, node.deserializeID, m.neighbourId!),
                    'Merge room',
                  );
                  pushToast(`Merged ${labelOf(node.type)}`);
                }
              }}
              onUnassign={(dwellerId) =>
                applyEdit((s) => unassignDweller(s, dwellerId), 'Unassign dweller')
              }
              onOpenAssign={() => setAssignOpen(true)}
              floorHandy={(() => {
                const h = handyRows.find((x) => x.floor === node.row);
                return h ? { id: h.serializeId, name: h.name } : null;
              })()}
              unassignedHandies={unassignedHandies}
              onAssignHandy={(actorId) => {
                applyEdit(
                  (s) => assignMrHandyToRoom(s, actorId, node.deserializeID),
                  'Assign Mr. Handy',
                );
                pushToast('Mr. Handy assigned to this room.');
              }}
              onCreateHandy={() => {
                applyEdit(
                  (s) =>
                    createMrHandy(s, {
                      roomId: node.deserializeID,
                      health: gameData?.roomCapacity.base.mrHandyHealth ?? DEFAULT_MR_HANDY_HEALTH,
                    }),
                  'Create Mr. Handy',
                );
                pushToast('New Mr. Handy created in this room.');
              }}
              onUnassignHandy={(actorId) => {
                applyEdit((s) => unassignMrHandy(s, actorId), 'Unassign Mr. Handy');
                pushToast('Mr. Handy sent outside the vault (it waits at the door).');
              }}
              timers={nodeTimers}
              productionAwaitingCollect={isProductionAwaitingCollect(save, node.deserializeID)}
              {...(!ultraciteActive && ULTRACITE_ROOM_NOTE[node.type]
                ? { seasonNote: ULTRACITE_ROOM_NOTE[node.type] }
                : {})}
              onCompleteTimers={(kinds) => {
                applyEdit(
                  (s) => completeRoomTimersNow(s, node.deserializeID, kinds),
                  kinds.length === 1 ? `Finish ${kinds[0]} timer` : 'Finish room timers',
                );
                pushToast('Timer finishes the next time the save is loaded in game');
              }}
              onCompleteTrainingSlot={(dwellerId) => {
                applyEdit(
                  (s) => completeTrainingSlotNow(s, node.deserializeID, dwellerId),
                  'Finish training cycle',
                );
                pushToast('Training cycle completes on next load in game');
              }}
              onDelete={() => setDeleteTargetId(node.deserializeID)}
              {...(applyRoomLoadout
                ? {
                    onApplyLoadout: applyRoomLoadout,
                    loadoutLabel: `Apply ${meta?.primaryStat} loadout`,
                    onOpenBulkLoadouts: openBulkLoadouts,
                    ...(loadoutHelp ? { loadoutHelp } : {}),
                  }
                : {})}
              {...((selectedRoomStaffPlan?.freeSlots ?? 0) > 0
                ? {
                    autoStaffFree: selectedRoomStaffPlan!.freeSlots,
                    onAutoStaff: () => onAutoStaffClick({ roomId: node.deserializeID }),
                  }
                : {})}
            />
          ) : null
        }
      />

      {node && (
        <AssignRoomDialog
          open={assignOpen}
          onClose={() => setAssignOpen(false)}
          roomLabel={labelOf(node.type)}
          dwellers={assignable}
          remaining={nodeMaxDwellers > 0 ? Math.max(0, nodeMaxDwellers - occupants.length) : 0}
          onAssign={(ids) => {
            applyEdit(
              (s) => ids.reduce((acc, id) => assignDweller(acc, node.deserializeID, id), s),
              'Assign dwellers',
            );
            pushToast(`Assigned ${ids.length} dweller${ids.length === 1 ? '' : 's'}`);
          }}
        />
      )}

      {staffConfirm && pendingPlan && (
        <ConfirmDialog
          open
          title={
            'roomId' in staffConfirm
              ? `Auto-staff ${labelOf(layout.byId.get(staffConfirm.roomId)?.type ?? '')}`
              : staffConfirm.mode === 'all'
                ? 'Auto-staff all rooms'
                : 'Auto-staff output rooms'
          }
          message={
            <>
              {pendingPlan.freeSlots} empty slot{pendingPlan.freeSlots === 1 ? '' : 's'} to fill.
              Choose how (always two options):
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  <span className="text-neutral-100">Assign idle + generate</span> - place{' '}
                  {pendingPlan.toAssign} idle dweller{pendingPlan.toAssign === 1 ? '' : 's'} first
                  {pendingPlan.toGenerate > 0
                    ? `, then generate ${pendingPlan.toGenerate} new for the rest`
                    : ''}
                  .
                </li>
                <li>
                  <span className="text-neutral-100">Generate all</span> - create{' '}
                  {pendingPlan.freeSlots} fresh recruit
                  {pendingPlan.freeSlots === 1 ? '' : 's'} for every slot and leave existing
                  dwellers where they are.
                </li>
              </ul>
              <span className="mt-2 block text-xs text-neutral-400">
                Recruits are named, scaled to your vault&apos;s averages, and equipped for their
                rooms. Single undoable edit.
              </span>
            </>
          }
          confirmLabel={
            pendingPlan.toGenerate > 0
              ? `Assign ${pendingPlan.toAssign} idle + generate ${pendingPlan.toGenerate}`
              : `Assign ${pendingPlan.toAssign} idle`
          }
          onConfirm={() => runAutoStaff(staffConfirm, true)}
          secondaryLabel={`Generate all ${pendingPlan.freeSlots}`}
          onSecondary={() => runAutoStaff(staffConfirm, false)}
          onCancel={() => setStaffConfirm(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          title="Delete room"
          message={`Remove ${labelOf(deleteTarget.type)} on floor ${displayFloor(deleteTarget.row)}? Any assigned dwellers return to the vault door.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleteTargetId(null)}
          onConfirm={() => {
            const id = deleteTarget.deserializeID;
            const label = labelOf(deleteTarget.type);
            applyEdit((s) => removeRoom(s, id), 'Delete room');
            setDeleteTargetId(null);
            if (selectedId === id) setSelectedId(null);
            pushToast(`Deleted ${label}`);
          }}
        />
      )}
    </div>
  );
}
