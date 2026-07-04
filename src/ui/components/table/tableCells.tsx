import type { ReactNode } from 'react';

// Shared interactive cell controls for the unified table system. Kept in their own module
// (only component exports) so the column-factory file (columnKit.tsx) stays Fast-Refresh
// clean. These standardize the per-row action buttons that used to be hand-styled in each
// catalog/storage/picker table.

type Tone = 'emerald' | 'sky' | 'red' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  emerald: 'border-emerald-700 text-emerald-300 hover:bg-emerald-900/40',
  sky: 'border-sky-700 text-sky-300 hover:bg-sky-900/40',
  red: 'border-red-900 text-red-300 hover:bg-red-900/30',
  neutral: 'border-neutral-700 text-neutral-300 hover:bg-neutral-800',
};

/** A compact, tone-styled per-row action button. Stops row-click propagation by default. */
export function TableActionButton({
  tone = 'neutral',
  label,
  title,
  onClick,
  disabled = false,
  children,
}: {
  tone?: Tone;
  /** Accessible label (aria-label); omit when the visible text is descriptive enough. */
  label?: string;
  /** Hover tooltip (shown even while disabled, e.g. to explain WHY it's disabled). */
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      {...(label ? { 'aria-label': label } : {})}
      {...(title ? { title } : {})}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded border px-2 py-0.5 text-xs disabled:opacity-40 disabled:hover:bg-transparent ${TONE_CLASS[tone]}`}
    >
      {children}
    </button>
  );
}
