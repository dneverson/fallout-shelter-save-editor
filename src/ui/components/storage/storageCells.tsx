import { useState, type KeyboardEvent } from 'react';
import { useHoldRepeat } from '../../hooks/useHoldRepeat.ts';

// Storage-table cell components. Kept in their OWN file (exports are
// all components) so react-refresh stays happy - the column-builder file references these
// via inline cell render fns and exports only data. Each control fires one store edit
// (one applyEdit = one undo step); the count input buffers typing locally so a partial
// entry never commits.

interface CountCellProps {
  /** Current stored count of this grouped item. */
  value: number;
  /** Commit a new exact count (the op clamps to a non-negative integer). */
  onCommit: (count: number) => void;
  /** Smallest value the control allows (default 0 for storage; catalogs use 1). */
  min?: number;
}

/** Compact inline count editor: [−] [input] [+], for a grouped storage row. */
export function CountCell({ value, onCommit, min = 0 }: CountCellProps) {
  const [text, setText] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);

  // Re-sync the buffer when the count changes outside this cell (undo, another edit) -
  // the "adjust state during render" pattern rather than an effect (React-Compiler bans
  // setState-in-effect), so a stale buffer never flashes.
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value));
  }

  const commit = (raw: string): void => {
    const parsed = Number(raw);
    if (raw.trim() === '' || Number.isNaN(parsed)) {
      setText(String(value)); // revert invalid/empty input
      return;
    }
    const next = Math.max(min, Math.trunc(parsed));
    setText(String(next));
    if (next !== value) onCommit(next);
  };

  const stepBy = (delta: number): void => {
    const next = Math.max(min, value + delta);
    if (next !== value) onCommit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  const decrementHandlers = useHoldRepeat(() => stepBy(-1));
  const incrementHandlers = useHoldRepeat(() => stepBy(1));

  return (
    <span className="flex items-stretch">
      <button
        type="button"
        aria-label="Decrease count"
        {...decrementHandlers}
        className="w-6 rounded-l border border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700 pointer-coarse:w-9"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label="Count"
        min={min}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={onKeyDown}
        className="w-14 min-w-0 border-y border-neutral-700 bg-neutral-950 px-1 py-1 text-center text-sm tabular-nums text-neutral-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label="Increase count"
        {...incrementHandlers}
        className="w-6 rounded-r border border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700 pointer-coarse:w-9"
      >
        +
      </button>
    </span>
  );
}
