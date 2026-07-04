import { useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { GameData } from '../../../domain/gamedata/gameData.ts';
import type { Special, UniqueDweller } from '../../../domain/gamedata/schemas.ts';
import { UnifiedTable } from '../table/UnifiedTable.tsx';
import { specialDwellerSchema, type SpecialRow } from '../table/schemas/specialDwellerSchema.tsx';
import { MODAL_LARGE } from '../../lib/modalClasses.ts';

// Add special/legendary NAMED dweller. The full catalog of unique
// characters in a searchable/sortable modal table; clicking a row adds that named dweller
// (with its baked-in customization) and closes. Mirrors the EquipPickerDialog layout.
// `virtualized` defaults true; tests pass false since jsdom has no layout.

interface AddSpecialDwellerDialogProps {
  open: boolean;
  onClose: () => void;
  catalog: Record<string, UniqueDweller>;
  gameData: GameData | null;
  onAdd: (uniqueId: string) => void;
  virtualized?: boolean;
}

const SPECIAL_LABELS = ['S', 'P', 'E', 'C', 'I', 'A', 'L'] as const;

/** Outfit SPECIAL bonus → "+3 S +2 P" (matches the roster's outfit column). */
function summarizeOutfitSpecial(special: Special | null | undefined): string {
  if (!special) return '';
  return SPECIAL_LABELS.filter((k) => special[k] > 0)
    .map((k) => `+${special[k]} ${k}`)
    .join(' ');
}

function buildRows(
  catalog: Record<string, UniqueDweller>,
  gameData: GameData | null,
): SpecialRow[] {
  const outfitName = (id: string): string => gameData?.outfitById.get(id)?.name ?? id;
  const weaponName = (id: string): string =>
    id ? (gameData?.weaponById.get(id)?.name ?? id) : 'Fist';
  const weaponDamage = (id: string): string => {
    const w = id ? gameData?.weaponById.get(id) : undefined;
    return w ? `${w.damageMin}–${w.damageMax}` : '';
  };
  return Object.entries(catalog)
    .map(([uniqueId, e]) => ({
      uniqueId,
      fullName: `${e.name} ${e.lastName}`.trim() || uniqueId,
      genderLabel: e.gender === 1 ? 'Female' : 'Male',
      stats: e.stats,
      outfitId: e.outfitId,
      outfit: outfitName(e.outfitId),
      outfitBonus: summarizeOutfitSpecial(gameData?.outfitById.get(e.outfitId)?.special),
      weaponId: e.weaponId,
      weapon: weaponName(e.weaponId),
      weaponDamage: weaponDamage(e.weaponId),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function AddSpecialDwellerDialog({
  open,
  onClose,
  catalog,
  gameData,
  onAdd,
  virtualized = true,
}: AddSpecialDwellerDialogProps) {
  const rows = useMemo(() => buildRows(catalog, gameData), [catalog, gameData]);
  const schema = useMemo(() => specialDwellerSchema(), []);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_LARGE} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-semibold">
                Add special / legendary dweller
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-neutral-400">
                {rows.length} named characters. Click one to add it (with its outfit, weapon,
                SPECIAL, and look). Edit the rest in the character sheet.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="rounded px-2 py-1 text-neutral-400 hover:text-neutral-100"
            >
              ✕
            </Dialog.Close>
          </div>

          <UnifiedTable<SpecialRow>
            className="mt-3 min-h-0 flex-1"
            virtualized={virtualized}
            schema={schema}
            persistKey="addSpecialDweller"
            data={rows}
            getRowId={(r) => r.uniqueId}
            enableGlobalFilter
            initialSorting={[{ id: 'fullName', desc: false }]}
            onRowClick={(r) => {
              onAdd(r.uniqueId);
              onClose();
            }}
            emptyState="No special characters in the catalog."
          />

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-100"
            >
              Close
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
