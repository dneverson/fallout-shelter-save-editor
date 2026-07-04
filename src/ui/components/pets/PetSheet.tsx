import { useState } from 'react';
import type { Item } from '../../../domain/model/saveSchema.ts';
import type { GameData } from '../../../domain/gamedata/gameData.ts';
import { petBonusRange } from '../../../domain/gamedata/gameData.ts';
import type { PetEdit } from '../../../domain/ops/petOps.ts';
import type { PetLocation } from '../../../domain/selectors/petSelectors.ts';
import type { DwellerRow } from '../../../domain/selectors/dwellerSelectors.ts';
import { ItemIcon } from '../ItemIcon.tsx';
import { NumberField } from '../forms/NumberField.tsx';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { AssignPetDialog } from './AssignPetDialog.tsx';

// Pet detail sheet, the right-hand panel of the Pets master-detail
// screen - the pet analog of the dweller CharacterSheet. Reads the LIVE instance
// resolved by PetsView (selectPetByLocation), so each edit re-renders with fresh
// values. The bonus EFFECT is locked (shown read-only); only the rolled VALUE (within
// the breed/rarity legal range, out-of-range override) and the unique NAME are editable. Footer
// actions reassign the instance (equip to a dweller / send to storage) or delete it;
// PetsView owns the applyEdit + post-op selection update.

/** Lightly humanize an EBonusEffect id for display (e.g. "DamageBoost" → "Damage Boost"). */
const prettyBonus = (bonus: string): string => bonus.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

interface PetSheetProps {
  location: PetLocation;
  /** The live pet instance at `location`. */
  item: Item;
  /** Owner's display name when equipped, undefined when in storage. */
  ownerName?: string;
  gameData: GameData | null;
  allowOutOfRange: boolean;
  /** Dwellers for the "equip to dweller" picker. */
  dwellers: DwellerRow[];
  onClose: () => void;
  onEdit: (changes: PetEdit) => void;
  onAssign: (dwellerId: number) => void;
  onSendToStorage: () => void;
  onDelete: () => void;
}

export function PetSheet({
  location,
  item,
  ownerName,
  gameData,
  allowOutOfRange,
  dwellers,
  onClose,
  onEdit,
  onAssign,
  onSendToStorage,
  onDelete,
}: PetSheetProps) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const catalog = gameData?.petById.get(item.id);
  const extra = item.extraData ?? {};
  const uniqueName = extra.uniqueName ?? '';
  const bonus = extra.bonus ?? catalog?.bonus ?? '–';
  const bonusValue = extra.bonusValue ?? 0;
  const range = gameData ? petBonusRange(gameData, item.id) : null;

  const isEquipped = location.kind === 'equipped';
  const ownerId = isEquipped ? location.dwellerId : null;

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-neutral-800 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold">
          {uniqueName || catalog?.name || item.id}
        </h3>
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
          <ItemIcon type="petBodies" id={item.id} size={88} />
        </div>
        <dl className="min-w-0 flex-1 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-neutral-400">Breed</dt>
            <dd className="truncate text-neutral-200">{catalog?.name ?? item.id}</dd>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <dt className="text-neutral-400">Type</dt>
            <dd className="text-neutral-200">{catalog?.type ?? '–'}</dd>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <dt className="text-neutral-400">Rarity</dt>
            <dd className="text-neutral-200">{catalog?.rarity ?? '–'}</dd>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <dt className="text-neutral-400">Id</dt>
            <dd className="truncate font-mono text-xs text-neutral-400">{item.id}</dd>
          </div>
        </dl>
      </div>

      {/* Bonus (locked) + editable value ----------------------------------------- */}
      <div className="mt-4 text-sm text-neutral-300">
        <span className="text-neutral-400">Bonus (locked): </span>
        {prettyBonus(bonus)}
        {range && (
          <span className="text-neutral-400">
            {' '}
            - legal range {range.min}–{range.max}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-4">
        <NumberField
          label="Bonus value"
          value={bonusValue}
          onCommit={(v) => onEdit({ bonusValue: v })}
          min={range?.min ?? 0}
          max={range?.max ?? 9999}
          allowOutOfRange={allowOutOfRange}
        />
        <label className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-400">Unique name</span>
          <input
            type="text"
            aria-label="Unique name"
            defaultValue={uniqueName}
            key={`petname-${item.id}-${uniqueName}`}
            onBlur={(e) => onEdit({ uniqueName: e.target.value })}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
      </div>

      {/* Assignment -------------------------------------------------------------- */}
      <div className="mt-5 border-t border-neutral-800 pt-4">
        <div className="text-sm">
          <span className="text-neutral-400">Assigned to: </span>
          <span className="text-neutral-200">
            {isEquipped ? (ownerName ?? 'a dweller') : 'Storage'}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAssignOpen(true)}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            Equip to dweller…
          </button>
          {isEquipped && (
            <button
              type="button"
              onClick={onSendToStorage}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              Send to storage
            </button>
          )}
        </div>
      </div>

      {/* Delete ------------------------------------------------------------------ */}
      <div className="mt-auto pt-6">
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/30"
        >
          Delete pet
        </button>
      </div>

      {assignOpen && (
        <AssignPetDialog
          open
          onClose={() => setAssignOpen(false)}
          dwellers={dwellers}
          currentOwnerId={ownerId}
          onAssign={onAssign}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete pet"
        message={`Permanently delete "${uniqueName || catalog?.name || item.id}"? This cannot be recovered (except via undo).`}
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
