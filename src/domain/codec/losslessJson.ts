// Big-int-lossless JSON.
//
// Plain JSON.parse/JSON.stringify is exact only within ±Number.MAX_SAFE_INTEGER
// (2^53-1 ≈ 9.0e15). Both save files carry .NET DateTime ticks far above that -
// `spd.dat`'s saveTime and the main `.sav`'s `timeMgr.timeSaveDate`/`timeGameBegin`
// (e.g. 639162074157166331 ≈ 6.4e17) - and plain JSON.parse silently corrupts them
// (…166331 → …166300). This module replaces the inner JSON step of the shared
// container codec so those literals survive verbatim.
//
// Sentinel-containment rule (saveCodec / saveSchema depend on this): ONLY integer
// literals whose magnitude EXCEEDS MAX_SAFE_INTEGER are boxed into a `LosslessInt`.
// Every in-range number stays a native `number`, and for any value containing no
// LosslessInt, `stringifyLossless` produces byte-identical output to `JSON.stringify`.
// Tick arithmetic on boxed values lives in src/domain/tasks/taskLookup.ts (BigInt).
//
// Pure domain code: no React/DOM imports.

/**
 * Opaque carrier for an integer literal too large to hold in a JS `number`
 * without precision loss. Holds the exact source text and re-emits it unaltered.
 */
export class LosslessInt {
  /** The exact integer literal as it appeared in the source JSON (may include a leading `-`). */
  readonly literal: string;

  constructor(literal: string) {
    this.literal = literal;
  }

  /** Numeric (lossy) view - for display/sorting only; never used for re-serialization. */
  toNumber(): number {
    return Number(this.literal);
  }

  toString(): string {
    return this.literal;
  }
}

export function isLosslessInt(value: unknown): value is LosslessInt {
  return value instanceof LosslessInt;
}

/**
 * Parse JSON text, preserving integer literals beyond `Number.MAX_SAFE_INTEGER`
 * as {@link LosslessInt}. In-range numbers and all non-integer literals remain
 * native `number`. Throws `SyntaxError` on malformed input (like `JSON.parse`).
 */
export function parseLossless(text: string): unknown {
  let i = 0;
  const n = text.length;

  function fail(msg: string): never {
    throw new SyntaxError(`parseLossless: ${msg} at position ${i}`);
  }

  function skipWs(): void {
    while (i < n) {
      const c = text.charCodeAt(i);
      // space, tab, LF, CR
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  }

  function parseValue(): unknown {
    skipWs();
    if (i >= n) fail('unexpected end of input');
    const c = text[i];
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"') return parseString();
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    fail(`unexpected token '${c}'`);
  }

  function parseObject(): Record<string, unknown> {
    i++; // consume '{'
    const obj: Record<string, unknown> = {};
    skipWs();
    if (text[i] === '}') {
      i++;
      return obj;
    }
    for (;;) {
      skipWs();
      if (text[i] !== '"') fail('expected string key');
      const key = parseString();
      skipWs();
      if (text[i] !== ':') fail("expected ':'");
      i++;
      obj[key] = parseValue();
      skipWs();
      const ch = text[i];
      if (ch === ',') {
        i++;
        continue;
      }
      if (ch === '}') {
        i++;
        break;
      }
      fail("expected ',' or '}'");
    }
    return obj;
  }

  function parseArray(): unknown[] {
    i++; // consume '['
    const arr: unknown[] = [];
    skipWs();
    if (text[i] === ']') {
      i++;
      return arr;
    }
    for (;;) {
      arr.push(parseValue());
      skipWs();
      const ch = text[i];
      if (ch === ',') {
        i++;
        continue;
      }
      if (ch === ']') {
        i++;
        break;
      }
      fail("expected ',' or ']'");
    }
    return arr;
  }

  function parseString(): string {
    const start = i;
    i++; // consume opening quote
    let hasEscape = false;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        // closing quote
        const raw = text.slice(start, i + 1);
        i++;
        // Defer escape handling to JSON.parse for full spec compliance; the
        // fast path avoids it for the common no-escape case.
        return hasEscape ? (JSON.parse(raw) as string) : raw.slice(1, -1);
      }
      if (c === 0x5c) {
        // backslash - skip the escaped char
        hasEscape = true;
        i += 2;
        continue;
      }
      i++;
    }
    fail('unterminated string');
  }

  function parseNumber(): number | LosslessInt {
    const start = i;
    if (text[i] === '-') i++;
    while (i < n && text[i] >= '0' && text[i] <= '9') i++;
    let isInteger = true;
    if (text[i] === '.') {
      isInteger = false;
      i++;
      while (i < n && text[i] >= '0' && text[i] <= '9') i++;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      isInteger = false;
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      while (i < n && text[i] >= '0' && text[i] <= '9') i++;
    }
    const raw = text.slice(start, i);
    const num = Number(raw);
    if (Number.isNaN(num)) fail(`invalid number '${raw}'`);
    // Containment rule: box ONLY integer literals beyond the safe range.
    if (isInteger && !Number.isSafeInteger(num)) {
      return new LosslessInt(raw);
    }
    return num;
  }

  skipWs();
  const value = parseValue();
  skipWs();
  if (i !== n) fail('unexpected trailing characters');
  return value;
}

/**
 * Serialize a value to JSON, re-emitting {@link LosslessInt} carriers as bare
 * (unquoted) integer literals. For any value containing no `LosslessInt`, the
 * output is byte-identical to `JSON.stringify(value, null, space)`.
 *
 * @param space Optional indentation, identical in meaning to `JSON.stringify`'s
 *   third argument (a number of spaces or a pad string). Omit for compact output.
 */
export function stringifyLossless(value: unknown, space?: number | string): string {
  // Map each LosslessInt to a unique placeholder string, then swap the placeholder's
  // serialized (quoted) form back to the bare literal. The placeholder is delimited
  // by NUL bytes + a random nonce so it cannot collide with real save string data
  // (the game's JSON never contains NUL).
  const NUL = String.fromCharCode(0);
  const nonce = `${NUL}LL${Math.random().toString(36).slice(2)}${NUL}`;
  const swaps: Array<{ quoted: string; literal: string }> = [];

  const json = JSON.stringify(
    value,
    (_key, val: unknown) => {
      if (val instanceof LosslessInt) {
        const token = `${nonce}${swaps.length}${NUL}`;
        // JSON.stringify(token) is exactly how this string is emitted inside `json`.
        swaps.push({ quoted: JSON.stringify(token), literal: val.literal });
        return token;
      }
      return val;
    },
    space,
  );

  if (swaps.length === 0) return json;

  let out = json;
  for (const { quoted, literal } of swaps) {
    out = out.replace(quoted, literal);
  }
  return out;
}
