import { useState } from 'react';
import type { RoomNode } from '../../../domain/rooms/layout.ts';
import { ELEVATOR_TYPE, FAKE_WASTELAND_TYPE } from '../../../domain/rooms/layout.ts';
import type { ValidationResult } from '../../../domain/rooms/validator.ts';
import type { RoomTheme } from '../../../domain/rooms/themes.ts';
import type { Recommendation } from '../../../domain/selectors/advisorSelectors.ts';
import { InfoTooltip } from '../InfoTooltip.tsx';
import { fieldHelp } from '../../lib/fieldHelp.ts';
import { useHoldRepeat } from '../../hooks/useHoldRepeat.ts';

// Selected-room detail panel (master-detail): level (±/max), repair, power,
// theme, occupants (assign/unassign), merge, delete - each gated by the layout
// validator (a blocked action is disabled with its reason as the tooltip). Presentational:
// every mutation is a callback the RoomsView turns into one applyEdit.

export interface RoomOccupant {
  id: number;
  name: string;
}

interface RoomSidePanelProps {
  node: RoomNode;
  label: string;
  maxLevel: number;
  maxDwellers: number;
  occupants: RoomOccupant[];
  canRemove: ValidationResult;
  mergeable: ValidationResult;
  onClose: () => void;
  onSetLevel: (level: number) => void;
  onMaxLevel: () => void;
  onRepair: () => void;
  onSetPower: (powered: boolean) => void;
  /** Theme ("decoration") options for this room TYPE; empty = the type has no themes. */
  themeOptions: RoomTheme[];
  /** The currently-applied theme enum name for this room type ("None" if unset). */
  currentTheme: string;
  /** Apply a theme to this room TYPE (themes every room of the type). */
  onSetTheme: (value: string) => void;
  onMerge: () => void;
  onUnassign: (dwellerId: number) => void;
  onOpenAssign: () => void;
  /** Auto-staff just this room (assign idle, then optionally generate). Absent = nothing to fill. */
  onAutoStaff?: () => void;
  /** Empty work slots this room can be auto-staffed into (drives the button's count). */
  autoStaffFree?: number;
  onDelete: () => void;
  /** UX-G: toggle drag-free "move mode" (highlight legal drop cells). Absent = not movable. */
  onToggleMove?: () => void;
  /** Whether move mode is currently active for this room. */
  moveActive?: boolean;
  /** When move mode finds NO legal target, the reason why (replaces the "pick a cell" hint). */
  moveBlockedReason?: string;
  /** Context action: equip this room's primary-SPECIAL loadout onto its occupants. */
  onApplyLoadout?: () => void;
  /** Label for the loadout action (e.g. "Apply Intelligence loadout"). */
  loadoutLabel?: string;
  /** Plain-language description of exactly what the loadout button equips (tooltip). */
  loadoutHelp?: string;
  /** Jump to the Bulk → Location loadouts panel to configure loadouts per room type. */
  onOpenBulkLoadouts?: () => void;
  /** Advisor recommendations targeting this room (understaffed / broken producer). */
  advisories?: Recommendation[];
  /** The Mr. Handy already on this room's FLOOR (one per floor, the game rule), or null. */
  floorHandy?: { id: number; name: string } | null;
  /** Robots not attached to any room, offered for assignment here. */
  unassignedHandies?: { id: number; name: string }[];
  /** Attach an existing unassigned robot to this room. */
  onAssignHandy?: (actorId: number) => void;
  /** Mint a brand-new robot directly into this room. */
  onCreateHandy?: () => void;
  /** Detach the floor's robot (it goes outside the vault). */
  onUnassignHandy?: (actorId: number) => void;
}

const SECTION = 'border-t border-neutral-800 pt-3 mt-3';
const BTN =
  'rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent pointer-coarse:px-3 pointer-coarse:py-1.5';

const ADVISORY_STYLE: Record<Recommendation['severity'], string> = {
  high: 'border-red-500/40 bg-red-500/10',
  medium: 'border-amber-500/40 bg-amber-500/10',
  low: 'border-neutral-700 bg-neutral-800/40',
};
const ADVISORY_ICON: Record<Recommendation['severity'], string> = {
  high: 'text-red-400',
  medium: 'text-amber-400',
  low: 'text-neutral-400',
};

export function RoomSidePanel({
  node,
  label,
  maxLevel,
  maxDwellers,
  occupants,
  canRemove,
  mergeable,
  onClose,
  onSetLevel,
  onMaxLevel,
  onRepair,
  onSetPower,
  themeOptions,
  currentTheme,
  onSetTheme,
  onMerge,
  onUnassign,
  onOpenAssign,
  onAutoStaff,
  autoStaffFree = 0,
  onDelete,
  onToggleMove,
  moveActive = false,
  moveBlockedReason,
  onApplyLoadout,
  loadoutLabel,
  loadoutHelp,
  onOpenBulkLoadouts,
  advisories = [],
  floorHandy = null,
  unassignedHandies = [],
  onAssignHandy,
  onCreateHandy,
  onUnassignHandy,
}: RoomSidePanelProps) {
  // Which unassigned robot the "Assign Mr. Handy" select currently points at.
  const [handyPick, setHandyPick] = useState<string>('');
  const isElevator = node.type === ELEVATOR_TYPE;
  // Structural tiles (elevator shafts, the FakeWasteland scenery tile) are not real rooms:
  // they have no level/health/occupants/merge/decoration controls.
  const isStructural = isElevator || node.type === FAKE_WASTELAND_TYPE;
  const damaged = node.room.broken === true || (node.room.roomHealth?.damageValue ?? 0) > 0;

  // Hold-to-repeat for the level steppers (matches every other ± counter). Each tick reads
  // the freshly re-rendered node.level, and the button's own `disabled` stops it at bounds.
  const levelDownHold = useHoldRepeat(() => onSetLevel(node.level - 1), {
    disabled: node.level <= 1,
  });
  const levelUpHold = useHoldRepeat(() => onSetLevel(node.level + 1), {
    disabled: node.level >= maxLevel,
  });

  return (
    <aside className="flex h-full w-full flex-col overflow-auto border-l border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-neutral-100">{label}</h3>
          <p className="text-xs text-neutral-400">
            Floor {node.row} · {node.room.class ?? node.type}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close room panel"
          className="rounded px-2 text-neutral-400 hover:text-neutral-200"
        >
          ✕
        </button>
      </div>

      {advisories.length > 0 && (
        <div className={SECTION}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Advisories
          </h4>
          <ul className="space-y-2">
            {advisories.map((rec) => (
              <li
                key={rec.id}
                className={`flex items-start gap-2 rounded border px-2.5 py-2 ${ADVISORY_STYLE[rec.severity]}`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-px text-sm leading-none ${ADVISORY_ICON[rec.severity]}`}
                >
                  ⚠
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-neutral-100">{rec.title}</div>
                  <div className="text-[11px] text-neutral-400">{rec.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {onToggleMove && (
        <div className={SECTION}>
          <button
            type="button"
            className={`${BTN} w-full ${moveActive ? 'border-sky-600 bg-sky-900/40 text-sky-200' : ''}`}
            aria-pressed={moveActive}
            onClick={onToggleMove}
          >
            {moveActive ? 'Cancel move' : 'Move room'}
          </button>
          {moveActive &&
            (moveBlockedReason ? (
              <p className="mt-1 text-[11px] text-amber-400">{moveBlockedReason}</p>
            ) : (
              <p className="mt-1 text-[11px] text-sky-400">
                Pick a highlighted cell on the grid - or just drag the room block.
              </p>
            ))}
        </div>
      )}

      {themeOptions.length > 0 && (
        <div className={SECTION}>
          <label className="block text-xs text-neutral-400">
            Theme
            <select
              value={currentTheme}
              onChange={(e) => onSetTheme(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100"
            >
              {themeOptions.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-1 text-[11px] text-neutral-500">Applies to all {label} rooms.</p>
        </div>
      )}

      {!isStructural && (
        <>
          <div className={SECTION}>
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
              <span className="flex items-center gap-1.5">
                Level <InfoTooltip text={fieldHelp.roomLevel} />
              </span>
              <span className="text-neutral-300">
                {node.level} / {maxLevel}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" className={BTN} disabled={node.level <= 1} {...levelDownHold}>
                −
              </button>
              <button
                type="button"
                className={BTN}
                disabled={node.level >= maxLevel}
                {...levelUpHold}
              >
                +
              </button>
              <button
                type="button"
                className={BTN}
                disabled={node.level >= maxLevel}
                onClick={onMaxLevel}
              >
                Max
              </button>
            </div>
          </div>

          <div className={SECTION}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                Health: {damaged ? <span className="text-amber-400">damaged</span> : 'healthy'}
                <InfoTooltip text={fieldHelp.roomRepair} />
              </span>
              <button
                type="button"
                className={BTN}
                disabled={!damaged}
                title={fieldHelp.roomRepair}
                onClick={onRepair}
              >
                Repair
              </button>
            </div>
            <label className="mt-2 flex items-center justify-between text-xs text-neutral-400">
              <span className="flex items-center gap-1.5">
                Powered <InfoTooltip text={fieldHelp.roomPower} />
              </span>
              <input
                type="checkbox"
                checked={node.room.power !== false}
                onChange={(e) => onSetPower(e.target.checked)}
              />
            </label>
            <button
              type="button"
              className={`${BTN} mt-2 w-full`}
              disabled={!mergeable.ok}
              title={mergeable.ok ? undefined : mergeable.reason}
              onClick={onMerge}
            >
              Merge with neighbour
            </button>
          </div>

          <div className={SECTION}>
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
              <span>Occupants</span>
              <span className="text-neutral-300">
                {occupants.length}
                {maxDwellers > 0 ? ` / ${maxDwellers}` : ''}
              </span>
            </div>
            <ul className="space-y-1">
              {occupants.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between rounded bg-neutral-800/60 px-2 py-1 text-xs"
                >
                  <span className="truncate text-neutral-200">{o.name}</span>
                  <button
                    type="button"
                    aria-label={`Unassign ${o.name}`}
                    onClick={() => onUnassign(o.id)}
                    className="text-neutral-400 hover:text-red-400"
                  >
                    ✕
                  </button>
                </li>
              ))}
              {occupants.length === 0 && <li className="text-xs text-neutral-400">Empty</li>}
            </ul>
            <button
              type="button"
              className={`${BTN} mt-2 w-full`}
              disabled={maxDwellers > 0 && occupants.length >= maxDwellers}
              onClick={onOpenAssign}
            >
              Assign dwellers
            </button>
            {onAutoStaff && autoStaffFree > 0 && (
              <button
                type="button"
                className={`${BTN} mt-2 w-full`}
                onClick={onAutoStaff}
                title={`Fill this room's ${autoStaffFree} empty slot${autoStaffFree === 1 ? '' : 's'} - assign idle dwellers first, generate the rest`}
              >
                Auto-staff this room ({autoStaffFree})
              </button>
            )}
            {onApplyLoadout && (
              <div className="mt-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className={`${BTN} flex-1`}
                    disabled={occupants.length === 0}
                    onClick={onApplyLoadout}
                  >
                    {loadoutLabel ?? 'Apply loadout'}
                  </button>
                  {loadoutHelp && (
                    <InfoTooltip text={loadoutHelp} label="What this loadout equips" />
                  )}
                </div>
                {onOpenBulkLoadouts && (
                  <button
                    type="button"
                    onClick={onOpenBulkLoadouts}
                    className="mt-1 text-[11px] text-sky-400 hover:text-sky-300 hover:underline"
                  >
                    Customize in Bulk → Location loadouts
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Mr. Handy: one robot per FLOOR (the game rule). Shows the floor's robot with a
              detach action, or - when the floor is free - assigns an existing unassigned
              robot / mints a brand-new one straight into this room. */}
          {(onAssignHandy || onCreateHandy || floorHandy) && (
            <div className={SECTION}>
              <div className="mb-1 text-xs text-neutral-400">Mr. Handy (this floor)</div>
              {floorHandy ? (
                <div className="flex items-center justify-between rounded bg-neutral-800/60 px-2 py-1 text-xs">
                  <span className="truncate text-neutral-200">{floorHandy.name}</span>
                  {onUnassignHandy && (
                    <button
                      type="button"
                      aria-label={`Send ${floorHandy.name} outside the vault`}
                      title="Detach from this floor (the robot goes outside and waits at the vault door until placed again)"
                      onClick={() => onUnassignHandy(floorHandy.id)}
                      className="text-neutral-400 hover:text-red-400"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {onAssignHandy && unassignedHandies.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={handyPick}
                        onChange={(e) => setHandyPick(e.target.value)}
                        aria-label="Unassigned Mr. Handy to place here"
                        className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
                      >
                        <option value="">Pick an unassigned robot…</option>
                        {unassignedHandies.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name} (#{h.id})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={BTN}
                        disabled={handyPick === ''}
                        onClick={() => {
                          onAssignHandy(Number(handyPick));
                          setHandyPick('');
                        }}
                      >
                        Assign
                      </button>
                    </div>
                  )}
                  {onCreateHandy && (
                    <button
                      type="button"
                      className={`${BTN} mt-2 w-full`}
                      onClick={onCreateHandy}
                      title="Mint a brand-new Mr. Handy directly into this room"
                    >
                      Create a Mr. Handy here
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      <div className={`${SECTION} mt-auto`}>
        <button
          type="button"
          className="w-full rounded border border-red-800 px-2 py-1.5 text-xs text-red-300 hover:bg-red-900/40 disabled:opacity-40 disabled:hover:bg-transparent"
          disabled={!canRemove.ok}
          title={canRemove.ok ? undefined : canRemove.reason}
          onClick={onDelete}
        >
          Delete room
        </button>
      </div>
    </aside>
  );
}
