import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { InfoTooltip } from '../InfoTooltip.tsx';

// ARGB color editor. The save stores each color as a uint32
// 0xAARRGGBB tint; the barbershop only exposes presets, but the save accepts any
// color, so this offers BOTH: a curated swatch row for quick authentic-ish picks
// and a full custom picker (native RGB + alpha + AARRGGBB hex). Edits live-apply
// via `onCommit`. The swatch palette is a curated approximation - the game's exact
// palette isn't in the extracted data; the custom hex/RGB path is exact.

interface ColorFieldProps {
  label: string;
  value: number; // uint32 ARGB (0xAARRGGBB)
  onCommit: (value: number) => void;
  /**
   * Optional live-preview callback, fired on every native-picker move while
   * dragging (before commit). Lets a parent recolor a preview cheaply without
   * touching the global store; the committed value still flows through `onCommit`
   * once on blur. Omit it and the field behaves exactly like commit-only.
   */
  onPreview?: (value: number) => void;
  /** Optional in-game help shown as an info tooltip beside the label. */
  help?: ReactNode;
  className?: string;
}

interface Argb {
  a: number;
  r: number;
  g: number;
  b: number;
}

const toArgb = (n: number): Argb => ({
  a: (n >>> 24) & 0xff,
  r: (n >>> 16) & 0xff,
  g: (n >>> 8) & 0xff,
  b: n & 0xff,
});

const fromArgb = ({ a, r, g, b }: Argb): number => ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');
const toHex8 = (n: number): string => n.toString(16).padStart(8, '0').toUpperCase();
const toRgbCss = ({ r, g, b }: Argb): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const toRgbaCss = ({ a, r, g, b }: Argb): string => `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;

/** Parse "#AARRGGBB" / "AARRGGBB" / "#RRGGBB" (alpha defaults to FF) → uint32, or null. */
function parseHex(input: string): number | null {
  const hex = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return (0xff000000 | parseInt(hex, 16)) >>> 0;
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return parseInt(hex, 16) >>> 0;
  return null;
}

// Curated quick-pick palette (RGB; alpha is preserved from the current value).
const SWATCHES: ReadonlyArray<{ name: string; rgb: number }> = [
  { name: 'White', rgb: 0xffffff },
  { name: 'Light gray', rgb: 0xc8c8c8 },
  { name: 'Gray', rgb: 0x808080 },
  { name: 'Black', rgb: 0x000000 },
  { name: 'Fair skin', rgb: 0xf2c9a0 },
  { name: 'Tan skin', rgb: 0xc68642 },
  { name: 'Brown', rgb: 0x6b4423 },
  { name: 'Blonde', rgb: 0xe6c66e },
  { name: 'Red', rgb: 0xc0392b },
  { name: 'Green', rgb: 0x27ae60 },
  { name: 'Blue', rgb: 0x2e6fb5 },
  { name: 'Amber', rgb: 0xf0a020 },
];

export function ColorField({
  label,
  value,
  onCommit,
  onPreview,
  help,
  className,
}: ColorFieldProps) {
  const argb = toArgb(value);
  const [hexText, setHexText] = useState(toHex8(value));
  const [lastValue, setLastValue] = useState(value);
  // The native color picker fires onChange on every pointer move while open. We
  // buffer those locally (cheap, ColorField-only render) and commit to the global
  // store once on blur - otherwise each micro-movement clones the whole save, runs
  // a health check, and pushes an undo step, which makes the picker crawl.
  const [rgbDraft, setRgbDraft] = useState<string | null>(null);

  // Re-sync the hex buffer when `value` changes outside this field (adjust state
  // during render, not in an effect).
  if (value !== lastValue) {
    setLastValue(value);
    setHexText(toHex8(value));
    setRgbDraft(null);
  }

  // While dragging, preview the draft RGB (keeping current alpha); otherwise the
  // committed value.
  const previewArgb: Argb =
    rgbDraft !== null
      ? {
          a: argb.a,
          r: parseInt(rgbDraft.slice(1, 3), 16),
          g: parseInt(rgbDraft.slice(3, 5), 16),
          b: parseInt(rgbDraft.slice(5, 7), 16),
        }
      : argb;

  const commitArgb = (next: Argb): void => {
    const n = fromArgb(next);
    if (n !== value) onCommit(n);
  };

  const commitHex = (raw: string): void => {
    const parsed = parseHex(raw);
    if (parsed === null) {
      setHexText(toHex8(value)); // revert invalid
      return;
    }
    setHexText(toHex8(parsed));
    if (parsed !== value) onCommit(parsed);
  };

  // Buffer the picker's live value and, if a parent wants live feedback, hand it the
  // would-be ARGB (current alpha + dragged RGB) without committing to the store.
  const onRgbDrag = (css: string): void => {
    setRgbDraft(css);
    if (onPreview) {
      const r = parseInt(css.slice(1, 3), 16);
      const g = parseInt(css.slice(3, 5), 16);
      const b = parseInt(css.slice(5, 7), 16);
      onPreview(fromArgb({ ...argb, r, g, b }));
    }
  };

  // Commit the buffered draft (on blur / picker close), then clear it.
  const commitRgbDraft = (): void => {
    if (rgbDraft === null) return;
    const r = parseInt(rgbDraft.slice(1, 3), 16);
    const g = parseInt(rgbDraft.slice(3, 5), 16);
    const b = parseInt(rgbDraft.slice(5, 7), 16);
    setRgbDraft(null);
    commitArgb({ ...argb, r, g, b });
  };

  const onHexKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-neutral-400">
        {label}
        {help && <InfoTooltip text={help} label={`About ${label.toLowerCase()}`} />}
      </span>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-7 w-7 shrink-0 rounded border border-neutral-600"
          style={{ backgroundColor: toRgbaCss(previewArgb) }}
        />
        <input
          type="color"
          aria-label={`${label} RGB`}
          value={toRgbCss(previewArgb)}
          onChange={(e) => onRgbDrag(e.target.value)}
          onBlur={commitRgbDraft}
          className="h-7 w-8 shrink-0 cursor-pointer rounded border border-neutral-700 bg-neutral-900"
        />
        <input
          type="text"
          aria-label={`${label} hex`}
          value={hexText}
          spellCheck={false}
          onChange={(e) => setHexText(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={onHexKeyDown}
          className="w-24 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs uppercase tracking-tight text-neutral-100"
        />
        <label className="flex items-center gap-1 text-[11px] text-neutral-400">
          α
          <input
            type="number"
            aria-label={`${label} alpha`}
            min={0}
            max={255}
            value={argb.a}
            onChange={(e) => {
              const a = Math.min(255, Math.max(0, Math.trunc(Number(e.target.value) || 0)));
              commitArgb({ ...argb, a });
            }}
            className="w-14 rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-center text-xs tabular-nums text-neutral-100"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-1">
        {SWATCHES.map((s) => (
          <button
            key={s.name}
            type="button"
            title={s.name}
            aria-label={`${label} ${s.name}`}
            onClick={() =>
              commitArgb({
                a: argb.a, // keep current alpha; the swatch only sets RGB
                r: (s.rgb >>> 16) & 0xff,
                g: (s.rgb >>> 8) & 0xff,
                b: s.rgb & 0xff,
              })
            }
            className="h-5 w-5 rounded border border-neutral-600"
            style={{ backgroundColor: `#${s.rgb.toString(16).padStart(6, '0')}` }}
          />
        ))}
      </div>
    </div>
  );
}
