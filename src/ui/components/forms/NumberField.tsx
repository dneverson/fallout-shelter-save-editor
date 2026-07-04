import { useState, type KeyboardEvent } from 'react';
import { useHoldRepeat } from '../../hooks/useHoldRepeat.ts';

// Numeric editor: type directly + [-]/[+] steppers. Values clamp to
// [min, max] on commit unless `allowOutOfRange` is set (the power toggle), in
// which case any number is accepted. Typing is buffered in local string state so a
// partial entry never fires an edit; the value commits on blur, Enter, or a stepper
// click - giving one undo step per deliberate change rather than one per keystroke.

interface NumberFieldProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  allowOutOfRange?: boolean;
  disabled?: boolean;
  className?: string;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  allowOutOfRange = false,
  disabled = false,
  className,
}: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);

  // Re-sync the buffer when the committed value changes outside this field (undo,
  // external edit) - the React-endorsed "adjust state during render" pattern rather
  // than an effect, so a stale buffer never flashes.
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value));
  }

  const bound = (n: number): number => (allowOutOfRange ? n : clamp(n, min, max));

  const commit = (raw: string): void => {
    const parsed = Number(raw);
    if (raw.trim() === '' || Number.isNaN(parsed)) {
      setText(String(value)); // revert invalid/empty input
      return;
    }
    const next = bound(Math.trunc(parsed));
    setText(String(next));
    if (next !== value) onCommit(next);
  };

  const stepBy = (delta: number): void => {
    const next = bound(value + delta);
    if (next !== value) onCommit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  const decrementHandlers = useHoldRepeat(() => stepBy(-step), { disabled });
  const incrementHandlers = useHoldRepeat(() => stepBy(step), { disabled });

  return (
    <label className={`flex flex-col gap-0.5 ${className ?? ''}`}>
      <span className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</span>
      <span className="flex items-stretch">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={disabled}
          {...decrementHandlers}
          className="w-6 rounded-l border border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700 disabled:opacity-40 pointer-coarse:w-9"
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          aria-label={label}
          disabled={disabled}
          value={text}
          min={allowOutOfRange ? undefined : min}
          max={allowOutOfRange ? undefined : max}
          step={step}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full min-w-0 border-y border-neutral-700 bg-neutral-950 px-2 py-1 text-center text-sm tabular-nums text-neutral-100 disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={disabled}
          {...incrementHandlers}
          className="w-6 rounded-r border border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700 disabled:opacity-40 pointer-coarse:w-9"
        >
          +
        </button>
      </span>
    </label>
  );
}
