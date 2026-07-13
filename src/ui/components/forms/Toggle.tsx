// Shared on/off switch: an accessible `role="switch"` button in a label-left /
// button-right row (the pattern established by the season Status card). The button
// text states the CURRENT state (`onLabel`/`offLabel`); clicking flips it.

export function Toggle({
  label,
  on,
  onChange,
  onLabel = 'On',
  offLabel = 'Off',
  disabled = false,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-neutral-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`rounded border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          on
            ? 'border-emerald-600/60 bg-emerald-500/15 text-emerald-300'
            : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'
        }`}
      >
        {on ? onLabel : offLabel}
      </button>
    </div>
  );
}
