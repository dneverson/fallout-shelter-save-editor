import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SectionToggle } from './SectionToggle.tsx';

// Build palette: the buildable room types. Picking one puts
// the grid into build mode; the Casino is just another entry here ("it's a
// room"). Each button surfaces the key facts a player needs to decide what to build - build
// cost (visible, not just a tooltip), dweller capacity, footprint, the room's primary
// SPECIAL, and what it produces - all from room metadata + the capacity/production catalogs.
// The title line carries Sort by / Filter dropdowns over those same facts (name, SPECIAL,
// price, type, locked state, production).
// A box can also be dragged straight onto an open grid cell (UX-G): the pointer-drag mirrors
// the grid's room-rearrange - below DRAG_THRESHOLD it's a click (build mode); past it the
// drag is handed to the grid, which renders the snap-ghost and places on release.

/** Below this pointer travel (px) a press is a click-select, not a drag. */
const DRAG_THRESHOLD = 5;

export interface BuildableRoom {
  type: string;
  name: string;
  /** Nuka (caps) build cost; 0 when free/unknown. */
  cost: number;
  /** Max dwellers at the base (un-merged, level 1) size; 0 when the room takes no staff. */
  capacity: number;
  /** ESpecialStat name the room trains/uses, or "None" for facilities. */
  primaryStat: string;
  /** Base footprint in room-tiles (1 = a standard room; 2/3 = inherently-wide rooms). */
  size: number;
  /** Core resources produced at the base size (Food/Water/Energy), in display order. */
  produces: string[];
  /** Not yet unlocked in this save - still buildable; building it claims the unlock. */
  locked: boolean;
  /** Room category from metadata ("Production", "Training", "Utility", …) - the Filter/
   *  Sort "type". */
  roomClass: string;
  /** Advisory note (e.g. a season-only room that won't function in this vault). Surfaces as
   *  a ⚠ marker on the tile and the tail of the hover tooltip. Absent = no note. */
  note?: string;
}

type SortKey = 'name' | 'special' | 'price' | 'type' | 'size';

const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'special', label: 'SPECIAL' },
  { value: 'price', label: 'Price' },
  { value: 'type', label: 'Type' },
  { value: 'size', label: 'Size' },
];

const SPECIAL_STATS = [
  'Strength',
  'Perception',
  'Endurance',
  'Charisma',
  'Intelligence',
  'Agility',
  'Luck',
] as const;

/** Filter select entries: state flags, production, and per-SPECIAL groups. */
const FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'all', label: 'All rooms' },
  { value: 'unlocked', label: 'Unlocked' },
  { value: 'locked', label: 'Locked' },
  { value: 'produces:Food', label: 'Produces food' },
  { value: 'produces:Water', label: 'Produces water' },
  { value: 'produces:Energy', label: 'Produces power' },
  ...SPECIAL_STATS.map((s) => ({ value: `stat:${s}`, label: `${s} (${s.charAt(0)})` })),
];

const byName = (a: BuildableRoom, b: BuildableRoom): number => a.name.localeCompare(b.name);

function applySortFilter(rooms: BuildableRoom[], sortBy: SortKey, filter: string): BuildableRoom[] {
  let list = rooms;
  if (filter === 'unlocked') list = list.filter((r) => !r.locked);
  else if (filter === 'locked') list = list.filter((r) => r.locked);
  else if (filter.startsWith('produces:')) {
    const res = filter.slice('produces:'.length);
    list = list.filter((r) => r.produces.includes(res));
  } else if (filter.startsWith('stat:')) {
    const stat = filter.slice('stat:'.length);
    list = list.filter((r) => r.primaryStat === stat);
  }
  const sorted = [...list];
  switch (sortBy) {
    case 'price':
      sorted.sort((a, b) => a.cost - b.cost || byName(a, b));
      break;
    case 'special':
      sorted.sort((a, b) => a.primaryStat.localeCompare(b.primaryStat) || byName(a, b));
      break;
    case 'type':
      sorted.sort((a, b) => a.roomClass.localeCompare(b.roomClass) || byName(a, b));
      break;
    case 'size':
      sorted.sort((a, b) => a.size - b.size || byName(a, b));
      break;
    default:
      sorted.sort(byName);
  }
  return sorted;
}

interface BuildPaletteProps {
  rooms: BuildableRoom[];
  activeType: string | null;
  onPick: (type: string | null) => void;
  /** Drag-to-build: a box was dragged past the threshold (build mode begins). */
  onBuildDragStart?: (type: string) => void;
  /** Live cursor position during a build drag (for the grid's snap-ghost). */
  onBuildDragMove?: (clientX: number, clientY: number) => void;
  /** Build drag released - place at this point if it lands on a legal cell. */
  onBuildDragEnd?: (clientX: number, clientY: number) => void;
  /** Collapse the palette to its header line (more vertical room for the grid). */
  collapsed?: boolean;
  /** Wire the header's collapse toggle; omitted = plain static header (tests). */
  onToggleCollapsed?: () => void;
}

interface PendingPress {
  type: string;
  startX: number;
  startY: number;
}

export function BuildPalette({
  rooms,
  activeType,
  onPick,
  onBuildDragStart,
  onBuildDragMove,
  onBuildDragEnd,
  collapsed = false,
  onToggleCollapsed,
}: BuildPaletteProps) {
  const pressRef = useRef<PendingPress | null>(null);
  // True for the click that immediately follows a drag, so it doesn't also toggle build mode.
  const draggedRef = useRef(false);
  // Whether the current press has crossed the threshold into an active drag.
  const draggingRef = useRef(false);
  const dragEnabled = onBuildDragStart !== undefined;

  // Sort by / Filter (title line) - session-only view state over the room facts.
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [filter, setFilter] = useState('all');
  const visibleRooms = useMemo(
    () => applySortFilter(rooms, sortBy, filter),
    [rooms, sortBy, filter],
  );

  const onBoxPointerDown = (e: ReactPointerEvent, type: string): void => {
    if (!dragEnabled || e.button !== 0) return;
    pressRef.current = { type, startX: e.clientX, startY: e.clientY };
    draggedRef.current = false;
    draggingRef.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* environments without pointer capture (e.g. jsdom) - drag still tracks via events */
    }
  };

  const onBoxPointerMove = (e: ReactPointerEvent): void => {
    const press = pressRef.current;
    if (!press) return;
    if (!draggingRef.current) {
      if (Math.hypot(e.clientX - press.startX, e.clientY - press.startY) < DRAG_THRESHOLD) return;
      draggingRef.current = true;
      draggedRef.current = true;
      onBuildDragStart?.(press.type);
    }
    onBuildDragMove?.(e.clientX, e.clientY);
  };

  const onBoxPointerUp = (e: ReactPointerEvent): void => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (pressRef.current && draggingRef.current) onBuildDragEnd?.(e.clientX, e.clientY);
    pressRef.current = null;
    draggingRef.current = false;
  };

  const onBoxClick = (type: string): void => {
    if (draggedRef.current) {
      draggedRef.current = false; // swallow the post-drag click
      return;
    }
    onPick(type === activeType ? null : type);
  };

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/50 p-2">
      {/* Sort by / Filter sit on the LEFT, right after the Build label (user preference).
          Collapsed, the box shrinks to just this header line (+ Cancel if mid-build). */}
      <div className={`flex flex-wrap items-center gap-2 ${collapsed ? '' : 'mb-2'}`}>
        {onToggleCollapsed ? (
          <SectionToggle label="Build" collapsed={collapsed} onToggle={onToggleCollapsed} />
        ) : (
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Build
          </span>
        )}
        {!collapsed && (
          <>
            <label className="flex items-center gap-1 text-xs text-neutral-400">
              Sort by
              <select
                aria-label="Sort rooms by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-xs text-neutral-100"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-xs text-neutral-400">
              Filter
              <select
                aria-label="Filter rooms"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-xs text-neutral-100"
              >
                {FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {activeType && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="rounded px-2 py-0.5 text-xs text-neutral-400 hover:text-neutral-100"
          >
            Cancel
          </button>
        )}
      </div>
      {collapsed ? null : (
        <div className="flex flex-wrap gap-1.5">
          {visibleRooms.length === 0 && (
            <span className="px-1 py-2 text-xs text-neutral-500">No rooms match the filter.</span>
          )}
          {visibleRooms.map((room) => {
            const active = room.type === activeType;
            const hasStat = room.primaryStat !== '' && room.primaryStat !== 'None';
            // Compact card (user-specified layout): "Name (S) 🔒" over "cost · 👥 n · w× wide",
            // plus a third "+Food +Water" production line for producer rooms. Everything else
            // (full stat name, locked state) lives in the hover tooltip to keep cards short.
            const statLetter = hasStat ? room.primaryStat.charAt(0) : null;
            const tooltip = [
              room.name,
              hasStat ? room.primaryStat : null,
              room.cost > 0 ? `${room.cost.toLocaleString()} caps` : null,
              room.capacity > 0 ? `${room.capacity} dwellers` : null,
              `${room.size}× wide`,
              room.produces.length > 0 ? `produces ${room.produces.join(' + ')}` : null,
              room.locked ? 'locked (building it claims the unlock)' : null,
              room.note ?? null,
            ]
              .filter((s) => s !== null)
              .join(' · ');
            return (
              <button
                key={room.type}
                type="button"
                data-build-tile=""
                aria-pressed={active}
                title={tooltip}
                onClick={() => onBoxClick(room.type)}
                onPointerDown={(e) => onBoxPointerDown(e, room.type)}
                onPointerMove={onBoxPointerMove}
                onPointerUp={onBoxPointerUp}
                onPointerCancel={onBoxPointerUp}
                className={`flex w-36 flex-col gap-0.5 rounded border px-2 py-1 text-left text-xs ${
                  dragEnabled ? 'touch-none cursor-grab active:cursor-grabbing' : ''
                } ${
                  active
                    ? 'border-emerald-500 bg-emerald-900/50 text-emerald-200'
                    : 'border-neutral-700 text-neutral-200 hover:bg-neutral-800'
                }`}
              >
                <span className="flex min-w-0 items-center gap-1 leading-tight">
                  <span className="truncate font-medium">{room.name}</span>
                  {statLetter && <span className="shrink-0 text-current/70">({statLetter})</span>}
                  {room.locked && (
                    <span aria-label="Locked" className="shrink-0 text-[10px]">
                      🔒
                    </span>
                  )}
                  {room.note && (
                    <span aria-label="Season-only room" className="shrink-0 text-[10px]">
                      ⚠️
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2 whitespace-nowrap text-[10px] leading-tight text-current/70">
                  <span>{room.cost > 0 ? `${room.cost.toLocaleString()} caps` : 'free'}</span>
                  {room.capacity > 0 && <span>👥 {room.capacity}</span>}
                  <span>{room.size}× wide</span>
                </span>
                {room.produces.length > 0 && (
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-[10px] leading-tight text-emerald-300/90">
                    {room.produces.map((res) => (
                      <span key={res}>+{res === 'Energy' ? 'Power' : res}</span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
