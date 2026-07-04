// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseLossless,
  stringifyLossless,
  LosslessInt,
  isLosslessInt,
} from '../../src/domain/codec/losslessJson.ts';

const SAMPLE = resolve(process.cwd(), 'tests/fixtures/season-sample.json');

describe('losslessJson - containment rule', () => {
  it('keeps in-range integers as native number', () => {
    const v = parseLossless('{"a":0,"b":25,"c":9007199254740991}') as Record<string, unknown>;
    // 9007199254740991 === Number.MAX_SAFE_INTEGER
    expect(typeof v.a).toBe('number');
    expect(typeof v.b).toBe('number');
    expect(typeof v.c).toBe('number');
    expect(v.c).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('keeps floats and exponents as native number, never boxed', () => {
    const v = parseLossless('[0.00,1474.40,1e21,-3.5,2.5e-3]') as unknown[];
    for (const n of v) expect(typeof n).toBe('number');
    expect(isLosslessInt(v[2])).toBe(false);
  });

  it('boxes integer literals beyond MAX_SAFE_INTEGER as LosslessInt', () => {
    const v = parseLossless('{"t":639162074157166331,"neg":-639162043003293889}') as Record<
      string,
      unknown
    >;
    expect(isLosslessInt(v.t)).toBe(true);
    expect(isLosslessInt(v.neg)).toBe(true);
    expect((v.t as LosslessInt).literal).toBe('639162074157166331');
    expect((v.neg as LosslessInt).literal).toBe('-639162043003293889');
  });
});

describe('losslessJson - parse/stringify fidelity', () => {
  it('round-trips ordinary JSON byte-identically to JSON.stringify', () => {
    const inputs = [
      '{"a":1,"b":[true,false,null],"c":{"d":"x\\ny"},"e":-0.5}',
      '[]',
      '{}',
      '"just a string"',
      '123',
      '{"unicode":"caf\\u00e9","emoji":"\\ud83d\\ude00"}',
    ];
    for (const json of inputs) {
      const value = parseLossless(json);
      expect(stringifyLossless(value)).toBe(JSON.stringify(JSON.parse(json)));
      expect(value).toEqual(JSON.parse(json));
    }
  });

  it('re-emits big-int literals unquoted and unaltered', () => {
    const json = '{"saveTime":639162074157166331,"n":5,"arr":[123456789012345678901,1]}';
    const out = stringifyLossless(parseLossless(json));
    expect(out).toBe(json);
  });

  it('rejects malformed input like JSON.parse', () => {
    expect(() => parseLossless('{')).toThrow();
    expect(() => parseLossless('{"a":}')).toThrow();
    expect(() => parseLossless('123 456')).toThrow();
    expect(() => parseLossless('')).toThrow();
  });
});

describe('losslessJson - sanitized spd.dat sample (big-int precision gate)', () => {
  it('decodes the sample with the two tick fields preserved exactly', () => {
    const text = readFileSync(SAMPLE, 'utf8');
    const v = parseLossless(text) as Record<string, unknown>;
    expect(isLosslessInt(v.saveTime)).toBe(true);
    expect(isLosslessInt(v.seasonStartSplashLastDisplayTime)).toBe(true);
    expect((v.saveTime as LosslessInt).literal).toBe('639162074157166331');
    expect((v.seasonStartSplashLastDisplayTime as LosslessInt).literal).toBe('639162043003293889');
    // In-range siblings stay native numbers (containment).
    expect(typeof v.currentLevel).toBe('number');
    expect(typeof v.lastPremiumUpsellTime).toBe('number');
  });

  it('re-encodes JSON-identical to the source sample', () => {
    const text = readFileSync(SAMPLE, 'utf8');
    expect(stringifyLossless(parseLossless(text))).toBe(text);
  });

  it('demonstrates the bug plain JSON.parse would introduce', () => {
    // Guard documenting why this layer exists: native JSON silently rounds the tick.
    expect(String(JSON.parse('639162074157166331'))).toBe('639162074157166300');
  });
});
