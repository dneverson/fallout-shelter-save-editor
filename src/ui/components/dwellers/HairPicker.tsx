import { useMemo } from 'react';
import {
  hairLabel,
  hairOptions,
  type GameData,
  type HairKind,
} from '../../../domain/gamedata/gameData.ts';

// Hair / facial-hair picker. Writes the catalog `pieceName`
// straight into the dweller's `hair`/`faceMask` field. Options are gender-filtered
// from game data; the current value is always offered even if it falls outside the
// filtered set (special characters, opposite-gender pieces). For facial hair,
// `allowNone` adds a "None" choice that clears the field - the op deletes the key.
// When game data is unavailable the control degrades to a raw text input so codes
// stay editable.

interface HairPickerProps {
  label: string;
  kind: HairKind;
  value: string | null;
  gender?: number | undefined;
  gameData: GameData | null;
  onCommit: (value: string | null) => void;
  allowNone?: boolean;
  className?: string;
}

const NONE = '__none__';

export function HairPicker({
  label,
  kind,
  value,
  gender,
  gameData,
  onCommit,
  allowNone = false,
  className,
}: HairPickerProps) {
  const current = value ?? '';

  const options = useMemo(() => {
    if (!gameData) return [];
    const base = hairOptions(gameData, kind, gender);
    // Ensure the current value is selectable even if filtered out of the catalog list.
    if (current && !base.some((o) => o.value === current)) {
      return [{ value: current, label: hairLabel(gameData, current), sortId: -1 }, ...base];
    }
    return base;
  }, [gameData, kind, gender, current]);

  const fieldClass =
    'rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100';

  if (!gameData) {
    return (
      <label className={`flex flex-col gap-0.5 ${className ?? ''}`}>
        <span className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</span>
        <input
          type="text"
          aria-label={label}
          value={current}
          placeholder={allowNone ? '(none)' : ''}
          spellCheck={false}
          onChange={(e) => {
            const next = e.target.value.trim();
            onCommit(allowNone && next === '' ? null : next);
          }}
          className={fieldClass}
        />
      </label>
    );
  }

  return (
    <label className={`flex flex-col gap-0.5 ${className ?? ''}`}>
      <span className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</span>
      <select
        aria-label={label}
        value={current === '' ? NONE : current}
        onChange={(e) => {
          const v = e.target.value;
          onCommit(v === NONE ? null : v);
        }}
        className={fieldClass}
      >
        {(allowNone || current === '') && <option value={NONE}>None</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
