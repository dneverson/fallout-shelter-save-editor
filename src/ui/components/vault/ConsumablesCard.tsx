import { NumberField } from '../forms/NumberField.tsx';
import { CONSUMABLE_CODES } from '../../../domain/ops/vaultOps.ts';
import { VaultCard } from './VaultCard.tsx';
import { InfoTooltip } from '../InfoTooltip.tsx';
import { fieldHelp } from '../../lib/fieldHelp.ts';

// Consumables card: lunchbox / Mr. Handy / pet-carrier counts.
// Editing rebuilds vault.LunchBoxesByType + LunchBoxesCount (vaultOps). The Starter Pack
// controls (offer toggle + unopened-pack count) live here too, directly below the counts:
// unopened packs are just another consumable in the same queue (LunchBoxesByType code 3),
// so they belong with the rest rather than in a separate card.

const CONSUMABLES: ReadonlyArray<{ code: number; label: string }> = [
  { code: CONSUMABLE_CODES.Lunchbox, label: 'Lunchboxes' },
  { code: CONSUMABLE_CODES.MrHandy, label: 'Mr. Handy' },
  { code: CONSUMABLE_CODES.PetCarrier, label: 'Pet Carriers' },
];

const MAX_CONSUMABLES = 999;

export function ConsumablesCard({
  counts,
  onSet,
  starterPackPurchased,
  onToggleStarterPack,
  starterPacksInVault,
  onSetStarterPacks,
}: {
  counts: Record<number, number>;
  onSet: (code: number, count: number) => void;
  starterPackPurchased: boolean;
  onToggleStarterPack: (purchased: boolean) => void;
  starterPacksInVault: number;
  onSetStarterPacks: (count: number) => void;
}) {
  return (
    <VaultCard
      title="Consumables"
      help={fieldHelp.consumables}
      description="Lunchboxes and other openable packs."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CONSUMABLES.map(({ code, label }) => (
          <NumberField
            key={code}
            label={label}
            value={counts[code] ?? 0}
            min={0}
            max={MAX_CONSUMABLES}
            onCommit={(v) => onSet(code, v)}
          />
        ))}
      </div>

      {/* Starter Pack (moved here from its own card). Two distinct actions: hide the paid
          real-money offer, and stock unopened packs in the consumable queue. */}
      <div className="mt-4 border-t border-neutral-800 pt-3">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-200">
          Starter Pack
          <InfoTooltip text={fieldHelp.starterPack} />
        </h4>
        <p className="mt-0.5 text-xs text-neutral-400">
          Hide the paid Starter Pack offer, or stock unopened packs in your vault.
        </p>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-sm text-neutral-300">
            Store offer
            <span className="ml-2 text-xs text-neutral-400">
              {starterPackPurchased ? 'hidden' : 'showing'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onToggleStarterPack(!starterPackPurchased)}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            {starterPackPurchased ? 'Show offer' : 'Hide offer'}
          </button>
        </div>

        <div className="mt-3">
          <NumberField
            label="Unopened packs in vault"
            value={starterPacksInVault}
            min={0}
            max={MAX_CONSUMABLES}
            onCommit={onSetStarterPacks}
            className="w-40"
          />
        </div>

        <p className="mt-2 text-xs text-neutral-500">
          Open packs in-game to receive the contents (often a pet and multiple special dwellers).
          The offer toggle alone only removes the purchase prompt - it doesn&apos;t add anything.
        </p>
      </div>
    </VaultCard>
  );
}
