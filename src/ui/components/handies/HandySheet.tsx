import { useState } from 'react';
import type { GameData } from '../../../domain/gamedata/gameData.ts';
import type { Handy } from '../../../domain/gamedata/schemas.ts';
import type { HandyFloorOption, MrHandyRow } from '../../../domain/ops/mrHandyOps.ts';
import { displayFloor } from '../../../domain/rooms/layout.ts';
import { ItemIcon } from '../ItemIcon.tsx';
import { NumberField } from '../forms/NumberField.tsx';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

// Mr. Handy detail sheet - the right-hand panel of the Mr. Handies master-detail
// screen, the robot analog of PetSheet. Reads the LIVE row resolved by HandiesView,
// so each edit re-renders with fresh values. Variant changes go through the catalog
// entry (its full save encoding: MrHandyVariantID + characterType + actorDataId).
// Placement is by FLOOR (1-based labels), never a specific room - which room's
// mrHandyList carries the reference is an implementation detail the domain resolves.
// HandiesView owns the applyEdit + post-op selection update.

interface HandySheetProps {
  handy: MrHandyRow;
  gameData: GameData | null;
  /** Full health from game data (roomCapacity.base.mrHandyHealth). */
  fullHealth: number;
  allowOutOfRange: boolean;
  floorOptions: HandyFloorOption[];
  onClose: () => void;
  onRename: (name: string) => void;
  onSetVariant: (variant: Handy) => void;
  onSetHealth: (health: number) => void;
  onHeal: () => void;
  /** Move to a floor (0-based row), or null = send outside the vault. */
  onMove: (row: number | null) => void;
  onDelete: () => void;
}

export function HandySheet({
  handy,
  gameData,
  fullHealth,
  allowOutOfRange,
  floorOptions,
  onClose,
  onRename,
  onSetVariant,
  onSetHealth,
  onHeal,
  onMove,
  onDelete,
}: HandySheetProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const catalog = gameData?.handyByVariant.get(handy.variant) ?? null;
  const hurt = handy.dead || (handy.health !== null && handy.health < fullHealth);

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-neutral-800 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{handy.name}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="rounded px-2 py-1 text-neutral-400 hover:text-neutral-100"
        >
          ✕
        </button>
      </div>

      {/* Sprite + identity ------------------------------------------------------- */}
      <div className="mt-3 flex items-center gap-3">
        <div className="rounded border border-neutral-800 bg-neutral-900/40 p-2">
          <ItemIcon type="handies" id={catalog?.id ?? 'mrhandy'} size={88} />
        </div>
        <dl className="min-w-0 flex-1 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-neutral-400">Variant</dt>
            <dd className="truncate text-neutral-200">{catalog?.name ?? handy.variant}</dd>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <dt className="text-neutral-400">Status</dt>
            <dd className={handy.dead ? 'text-red-400' : 'text-neutral-200'}>
              {handy.dead
                ? 'Destroyed'
                : handy.inWasteland
                  ? 'Collecting in the wasteland'
                  : handy.floor === null
                    ? 'Waiting at the vault door'
                    : 'Placed'}
            </dd>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <dt className="text-neutral-400">Id</dt>
            <dd className="truncate font-mono text-xs text-neutral-400">{handy.serializeId}</dd>
          </div>
        </dl>
      </div>

      {/* Name + variant ---------------------------------------------------------- */}
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-400">Name</span>
          <input
            type="text"
            aria-label="Robot name"
            defaultValue={handy.name}
            key={`handyname-${handy.serializeId}-${handy.name}`}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== handy.name) onRename(name);
            }}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-400">Variant</span>
          <select
            aria-label="Robot variant"
            value={catalog?.id ?? ''}
            onChange={(e) => {
              const next = gameData?.handies.find((h) => h.id === e.target.value);
              if (next) onSetVariant(next);
            }}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          >
            {!catalog && <option value="">Unknown ({handy.variant})</option>}
            {(gameData?.handies ?? []).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Health ------------------------------------------------------------------ */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <NumberField
          label="Health"
          value={handy.health === null ? fullHealth : Math.round(handy.health)}
          onCommit={onSetHealth}
          min={0}
          max={fullHealth}
          allowOutOfRange={allowOutOfRange}
        />
        <button
          type="button"
          disabled={!hurt}
          onClick={onHeal}
          title={hurt ? `Restore to ${fullHealth} HP and revive` : 'Already at full health'}
          className="mb-0.5 rounded border border-emerald-700 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Heal
        </button>
      </div>

      {/* Placement --------------------------------------------------------------- */}
      <div className="mt-5 border-t border-neutral-800 pt-4">
        <div className="text-sm">
          <span className="text-neutral-400">Placed: </span>
          <span className="text-neutral-200">
            {handy.inWasteland
              ? 'In the wasteland'
              : handy.floor === null
                ? 'Outside the vault'
                : `Floor ${displayFloor(handy.floor)}`}
          </span>
        </div>
        <label className="mt-2 flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-400">Move to</span>
          <select
            aria-label="Move robot to floor"
            value={handy.floor ?? 'none'}
            onChange={(e) => onMove(e.target.value === 'none' ? null : Number(e.target.value))}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          >
            <option value="none">Outside the vault</option>
            {floorOptions.map((opt) => {
              const takenByOther = opt.takenBy !== undefined && opt.takenBy !== handy.serializeId;
              return (
                <option key={opt.row} value={opt.row} disabled={takenByOther}>
                  {opt.label}
                  {takenByOther ? ' (already has a robot)' : ''}
                </option>
              );
            })}
          </select>
        </label>
        <p className="mt-1.5 text-[11px] text-neutral-500">
          One robot per floor (the game's rule). A robot outside the vault just waits at the door
          until you place it on a floor.
        </p>
      </div>

      {/* Delete ------------------------------------------------------------------ */}
      <div className="mt-auto pt-6">
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/30"
        >
          Delete robot
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete robot"
        message={`Permanently delete "${handy.name}"? This cannot be recovered (except via undo).`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </aside>
  );
}
