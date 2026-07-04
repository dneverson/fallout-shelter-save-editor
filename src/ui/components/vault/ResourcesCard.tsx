import { NumberField } from '../forms/NumberField.tsx';
import { VaultCard } from './VaultCard.tsx';
import { fieldHelp } from '../../lib/fieldHelp.ts';

// Resources card: caps (Nuka), food/energy/water, stimpaks/radaway,
// Nuka-Cola Quantum, poker chips. Each value edits live; "Max resources" fills every
// listed resource to its game-legal cap in one undo step. Caps are room/dweller-derived
// (vaultSelectors); the power toggle lets values exceed the cap.

const RESOURCE_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'Nuka', label: 'Caps' },
  { key: 'Food', label: 'Food' },
  { key: 'Energy', label: 'Energy' },
  { key: 'Water', label: 'Water' },
  { key: 'StimPack', label: 'Stimpaks' },
  { key: 'RadAway', label: 'RadAway' },
  { key: 'NukaColaQuantum', label: 'Nuka-Cola Quantum' },
  { key: 'PokerChip', label: 'Poker Chips' },
];

const FALLBACK_MAX = 9_999_999;

export function ResourcesCard({
  resources,
  caps,
  allowOutOfRange,
  onSet,
  onMaxAll,
}: {
  resources: Record<string, number>;
  caps: Record<string, number> | null;
  allowOutOfRange: boolean;
  onSet: (key: string, value: number) => void;
  onMaxAll: () => void;
}) {
  const maxTooltip = caps
    ? 'Fill every resource to its game-legal capacity (room/dweller-derived).'
    : 'Loading capacities…';

  return (
    <VaultCard
      title="Resources"
      help={fieldHelp.resources}
      description="Edit any resource; caps are derived from your rooms + dwellers."
      action={
        <button
          type="button"
          onClick={onMaxAll}
          disabled={!caps}
          title={maxTooltip}
          className="rounded border border-amber-700 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-900/30 disabled:opacity-40"
        >
          Max resources
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {RESOURCE_FIELDS.map(({ key, label }) => {
          const cap = caps?.[key];
          return (
            <div key={key}>
              <NumberField
                label={label}
                value={resources[key] ?? 0}
                min={0}
                max={cap ?? FALLBACK_MAX}
                allowOutOfRange={allowOutOfRange}
                onCommit={(v) => onSet(key, v)}
              />
              {cap !== undefined && (
                <p className="mt-0.5 text-right text-[10px] tabular-nums text-neutral-400">
                  max {cap.toLocaleString()}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </VaultCard>
  );
}
