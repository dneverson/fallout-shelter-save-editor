import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { GameData } from '../../../domain/gamedata/gameData.ts';
import { petBonusRange, petSpecialName } from '../../../domain/gamedata/gameData.ts';
import type { Pet } from '../../../domain/gamedata/schemas.ts';
import type { NewPet } from '../../../domain/ops/dwellerOps.ts';
import type { PetRow } from '../../../domain/selectors/petSelectors.ts';
import { UnifiedTable } from '../table/UnifiedTable.tsx';
import { petInstanceSchema } from '../table/schemas/petInstanceSchema.tsx';
import { petCatalogSchema } from '../table/schemas/petCatalogSchema.tsx';
import { NumberField } from '../forms/NumberField.tsx';
import { MODAL_LARGE } from '../../lib/modalClasses.ts';

// Pet attach + edit. Pets are save instances: the bonus EFFECT is
// LOCKED to the breed (shown read-only); only the rolled VALUE (within the rarity's
// [min,max], out-of-range override) and the unique NAME are editable. Three tabs, each a clone of
// the Pets-screen tables so the picker reads identically to that screen:
//   • Owned   - every owned instance (equipped on ANY dweller + loose in storage) via the
//               Pets-tab roster columns; clicking reassigns it onto this dweller.
//   • Catalog - the full breed×rarity catalog (catalog columns, sort/filter); clicking
//               mints + equips a fresh instance at the breed's top legal value.
//   • Edit    - the equipped pet's value/name (only shown when one is equipped).
// Attaching from Owned/Catalog lands on the Edit tab (not closing) so the just-attached
// pet can be tuned without reopening the menu.
// Mounted only while open, so its state initializes fresh each time.

/** The currently-equipped pet, for the editor view. */
export interface CurrentPet {
  id: string;
  uniqueName: string;
  bonus: string;
  bonusValue: number;
}

interface PetAttachDialogProps {
  onClose: () => void;
  gameData: GameData | null;
  /** Every owned pet instance (equipped + stored), for the "Owned" reassign table. */
  ownedPets: PetRow[];
  current: CurrentPet | null;
  allowOutOfRange: boolean;
  /** Reassign an existing owned instance (wherever it lives) onto this dweller. */
  onAssign: (pet: PetRow) => void;
  /** Mint + equip a fresh instance for a catalog breed. */
  onCreate: (pet: NewPet) => void;
  onEdit: (changes: { uniqueName?: string; bonusValue?: number }) => void;
  onDetach: () => void;
  /** Delete the equipped instance outright (not returned to storage). */
  onDelete: () => void;
  virtualized?: boolean;
}

type View = 'edit' | 'owned' | 'catalog';

/** Lightly humanize an EBonusEffect id for display (e.g. "DamageBoost" → "Damage Boost"). */
const prettyBonus = (bonus: string): string => bonus.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

/** A fresh pet instance for a catalog breed at its best legal value (matches the Catalog tab). */
const newPetFor = (pet: Pet): NewPet => ({
  petId: pet.id,
  uniqueName: petSpecialName(pet),
  bonus: pet.bonus,
  bonusValue: pet.bonusMax,
});

const tabClass = (active: boolean): string =>
  `rounded px-3 py-1.5 text-sm ${
    active ? 'bg-amber-500/20 text-amber-300' : 'text-neutral-300 hover:bg-neutral-800'
  }`;

export function PetAttachDialog({
  onClose,
  gameData,
  ownedPets,
  current,
  allowOutOfRange,
  onAssign,
  onCreate,
  onEdit,
  onDetach,
  onDelete,
  virtualized = true,
}: PetAttachDialogProps) {
  const [view, setView] = useState<View>(current ? 'edit' : 'owned');

  const editRange = current && gameData ? petBonusRange(gameData, current.id) : null;

  // Reuse the Pets-screen tables verbatim: the Owned roster columns and the breed×rarity
  // catalog columns, both with their sort/filter behaviour.
  const ownedTable = useMemo(() => petInstanceSchema(), []);
  const catalogTable = useMemo(() => petCatalogSchema(), []);
  const catalogPets = useMemo(() => gameData?.pets ?? [], [gameData]);

  const header = current ? 'Pet' : 'Attach a pet';

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_LARGE} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-base font-semibold">{header}</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded px-2 py-1 text-neutral-400 hover:text-neutral-100"
            >
              ✕
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Assign an owned pet, equip one from the catalog, or edit this dweller&apos;s pet.
          </Dialog.Description>

          <div className="mt-3 flex gap-1 border-b border-neutral-800 pb-2">
            {current && (
              <button
                type="button"
                className={tabClass(view === 'edit')}
                onClick={() => setView('edit')}
              >
                Edit pet
              </button>
            )}
            <button
              type="button"
              className={tabClass(view === 'owned')}
              onClick={() => setView('owned')}
            >
              Owned
            </button>
            <button
              type="button"
              className={tabClass(view === 'catalog')}
              onClick={() => setView('catalog')}
            >
              Catalog
            </button>
          </div>

          {/* Edit the equipped pet ------------------------------------------------ */}
          {view === 'edit' && current && (
            <div className="mt-4 flex flex-col gap-3">
              <div className="text-sm text-neutral-300">
                <span className="text-neutral-400">Bonus (locked): </span>
                {prettyBonus(current.bonus)}
                {editRange && (
                  <span className="text-neutral-400">
                    {' '}
                    - legal range {editRange.min}–{editRange.max}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <NumberField
                  label="Bonus value"
                  value={current.bonusValue}
                  onCommit={(v) => onEdit({ bonusValue: v })}
                  min={editRange?.min ?? 0}
                  max={editRange?.max ?? 9999}
                  allowOutOfRange={allowOutOfRange}
                />
                <label className="flex flex-col gap-0.5">
                  <span className="text-[11px] uppercase tracking-wide text-neutral-400">
                    Unique name
                  </span>
                  <input
                    type="text"
                    aria-label="Unique name"
                    defaultValue={current.uniqueName}
                    key={`petname-${current.id}-${current.uniqueName}`}
                    onBlur={(e) => onEdit({ uniqueName: e.target.value })}
                    className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onDetach();
                    onClose();
                  }}
                  className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/30"
                >
                  Detach pet → storage
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDelete();
                    onClose();
                  }}
                  className="rounded border border-red-700 bg-red-900/40 px-3 py-1.5 text-sm text-red-200 hover:bg-red-900/60"
                >
                  Delete pet
                </button>
              </div>
            </div>
          )}

          {/* Assign an owned instance (equipped on anyone, or in storage) --------- */}
          {view === 'owned' && (
            <UnifiedTable<PetRow>
              className="mt-3 min-h-0 flex-1"
              virtualized={virtualized}
              schema={ownedTable}
              persistKey="petAttach.owned"
              data={ownedPets}
              getRowId={(r) => r.rowId}
              enableGlobalFilter
              onRowClick={(r) => {
                onAssign(r);
                setView('edit'); // jump to Edit so the just-attached pet can be tuned without reopening
              }}
              emptyState="No pets owned yet. Use the Catalog to equip one."
            />
          )}

          {/* Equip a fresh instance from the full catalog ------------------------- */}
          {view === 'catalog' && (
            <UnifiedTable<Pet>
              className="mt-3 min-h-0 flex-1"
              virtualized={virtualized}
              schema={catalogTable}
              persistKey="petAttach.catalog"
              data={catalogPets}
              getRowId={(p) => p.id}
              enableGlobalFilter
              onRowClick={(p) => {
                onCreate(newPetFor(p));
                setView('edit'); // jump to Edit so the freshly-minted pet can be tuned without reopening
              }}
              emptyState="No pets in game data."
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
