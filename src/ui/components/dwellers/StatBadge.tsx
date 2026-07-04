// A single SPECIAL stat rendered as a color-coded badge: red at 1,
// green at 10, continuous hue in between so the roster is scannable at a glance.
// Values outside 1..10 (possible in a pre-edited save) still render their raw
// number, color-clamped to the legal range.

export function StatBadge({ value }: { value: number }) {
  const clamped = Math.max(1, Math.min(10, value));
  const hue = ((clamped - 1) / 9) * 120; // 0 = red → 120 = green
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded text-xs font-semibold tabular-nums text-neutral-950"
      style={{ backgroundColor: `hsl(${hue} 65% 55%)` }}
      title={`${value}`}
    >
      {value}
    </span>
  );
}
