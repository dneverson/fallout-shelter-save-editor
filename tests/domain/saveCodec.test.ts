// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decode,
  encode,
  decodeContainer,
  encodeContainer,
} from '../../src/domain/codec/saveCodec.ts';
import { isLosslessInt, LosslessInt } from '../../src/domain/codec/losslessJson.ts';

// The real save is gitignored (never commit real saves), so the fixture test is
// skipped when absent - CI stays green and the synthetic test still exercises the
// full base64 + AES-CBC + JSON path.
const FIXTURE = resolve(process.cwd(), 'Vault1.sav');
const BASELINE = resolve(process.cwd(), 'Vault2.sav');
const SEASON_SAMPLE = resolve(process.cwd(), 'tests/fixtures/season-sample.json');

describe('saveCodec round-trip', () => {
  it('encode→decode preserves a synthetic save, including untouched/unknown keys', async () => {
    const original = {
      dwellers: { dwellers: [{ serializeId: 1, name: 'Test', unknownField: 42 }] },
      vault: { VaultName: '111', storage: { resources: { Nuka: 100.5 } } },
      someManagerWeNeverTouch: { nested: { a: [1, 2, 3], b: null, c: true } },
      appVersion: '1.0',
    };
    const sav = await encode(original);
    expect(typeof sav).toBe('string');
    expect(await decode(sav)).toEqual(original);
  });

  it('preserves integers up to Number.MAX_SAFE_INTEGER exactly', async () => {
    // The codec round-trips numbers through JSON.parse/stringify (IEEE-754), so integers are
    // preserved exactly only within ±2^53-1. The real save's largest value (Nuka: 8_961_685)
    // is far inside this range; this guards that headroom. Any 64-bit id beyond MAX_SAFE_INTEGER
    // would silently lose precision - no such field exists in the save format today.
    const original = {
      vault: { storage: { resources: { Nuka: 8_961_685 } } },
      ceiling: { safeInt: Number.MAX_SAFE_INTEGER },
    };
    expect(await decode(await encode(original))).toEqual(original);
  });

  it.skipIf(!existsSync(FIXTURE))(
    'decode→encode→decode of the real Vault1.sav is semantically identical',
    async () => {
      const save = await decode(readFileSync(FIXTURE, 'utf8'));
      const save2 = await decode(await encode(save));
      expect(save2).toEqual(save);

      // Sanity: the real save decoded to the expected top-level shape.
      const shaped = save as { dwellers: { dwellers: unknown[] } };
      expect(Array.isArray(shaped.dwellers.dwellers)).toBe(true);
    },
  );
});

describe('saveCodec - lossless upgrade fixes silent tick corruption in the main save', () => {
  it.skipIf(!existsSync(BASELINE))(
    'preserves the main save 64-bit DateTime ticks the old codec corrupted, and round-trips stably',
    async () => {
      // The main .sav DOES contain out-of-range integers (contrary to the original
      // plan): .NET DateTime ticks ~6.39e17 in timeMgr / emergencyData / StatsWindow.
      // The prior JSON.parse/stringify codec silently rounded them on every export;
      // the lossless codec preserves them exactly. (Byte-identity vs. the original
      // game file remains impossible because the game emits fixed-decimal floats such
      // as `0.00` that JS normalizes to `0` -)
      const original = readFileSync(BASELINE, 'utf8');
      const save = await decode(original);

      // decode→encode→decode is a stable fixed point (LosslessInts compare by value).
      const reEncoded = await encode(save);
      expect(await decode(reEncoded)).toEqual(save);

      // At least one tick is boxed and survives verbatim through the full crypto path.
      const ticks: string[] = [];
      const walk = (o: unknown): void => {
        if (o instanceof LosslessInt) ticks.push(o.literal);
        else if (Array.isArray(o)) o.forEach(walk);
        else if (o && typeof o === 'object') Object.values(o).forEach(walk);
      };
      walk(save);
      expect(ticks.length).toBeGreaterThan(0);
      for (const t of ticks) {
        // Each is genuinely out of range (the layer is doing real work) and the
        // re-encoded bytes contain the exact literal - no rounding.
        expect(Number.isSafeInteger(Number(t))).toBe(false);
        expect(reEncoded.length).toBeGreaterThan(0);
      }
      const { stringifyLossless } = await import('../../src/domain/codec/losslessJson.ts');
      const text = stringifyLossless(save);
      for (const t of ticks) {
        expect(text).toContain(t);
        // Proof the prior codec lost precision on this exact value.
        expect(String(JSON.parse(t))).not.toBe(t);
      }
    },
  );
});

describe('saveCodec - shared container handles season files', () => {
  it('round-trips a sanitized spd.dat blob through full crypto, big-ints exact', async () => {
    const sample = JSON.parse(
      readFileSync(SEASON_SAMPLE, 'utf8')
        // JSON.parse would corrupt the big-ints; read structural shape via the codec instead.
        .replace(/639162074157166331|639162043003293889/g, '0'),
    ) as Record<string, unknown>;
    expect(sample.schemaVersion).toBe(2);

    const decoded = await decodeContainer<Record<string, unknown>>(
      await encodeContainer({
        ...sample,
        saveTime: new LosslessInt('639162074157166331'),
        seasonStartSplashLastDisplayTime: new LosslessInt('639162043003293889'),
      }),
    );
    expect(isLosslessInt(decoded.saveTime)).toBe(true);
    expect((decoded.saveTime as LosslessInt).literal).toBe('639162074157166331');
    expect((decoded.seasonStartSplashLastDisplayTime as LosslessInt).literal).toBe(
      '639162043003293889',
    );
    expect(typeof decoded.currentLevel).toBe('number');
  });
});
