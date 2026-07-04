import { NumberField } from '../forms/NumberField.tsx';
import type { VaultMode } from '../../../domain/ops/vaultOps.ts';
import { VaultCard } from './VaultCard.tsx';
import { fieldHelp } from '../../lib/fieldHelp.ts';

// Vault config card: name (000–999), mode (Normal/Survival), and
// holiday theme. Edits apply live.

const MODES: readonly VaultMode[] = ['Normal', 'Survival'];

const THEMES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'Normal' },
  { value: 1, label: 'Christmas' },
  { value: 2, label: 'Halloween' },
  { value: 3, label: 'Thanksgiving' },
];

export function VaultConfigCard({
  name,
  mode,
  theme,
  onName,
  onMode,
  onTheme,
}: {
  name: string;
  mode: string;
  theme: number;
  onName: (value: number) => void;
  onMode: (mode: VaultMode) => void;
  onTheme: (theme: number) => void;
}) {
  return (
    <VaultCard
      title="Vault config"
      help={fieldHelp.vaultMode}
      description="Name, game mode, and holiday theme."
    >
      <div className="flex flex-wrap items-end gap-4">
        <NumberField
          label="Vault number"
          value={Number(name) || 0}
          min={0}
          max={999}
          onCommit={onName}
          className="w-28"
        />

        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-400">Mode</span>
          <div className="flex overflow-hidden rounded border border-neutral-700">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => onMode(m)}
                className={`px-3 py-1 text-sm ${
                  mode === m
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-neutral-900 text-neutral-300 hover:bg-neutral-800'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-400">Theme</span>
          <select
            value={theme}
            onChange={(e) => onTheme(Number(e.target.value))}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </VaultCard>
  );
}
