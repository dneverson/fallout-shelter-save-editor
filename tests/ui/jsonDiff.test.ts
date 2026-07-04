import { describe, it, expect } from 'vitest';
import { diffJson } from '../../src/ui/components/advanced/jsonDiff.ts';
import { LosslessInt } from '../../src/domain/codec/losslessJson.ts';

// The Advanced editor's live preview diffs the loaded save (which may carry boxed
// 64-bit ticks as LosslessInt) against the parsed editor buffer (also lossless).
// A boxed integer must behave as a scalar leaf, never as a `{ literal }` object.
describe('jsonDiff - LosslessInt scalar handling', () => {
  it('reports no change for equal boxed ticks', () => {
    const a = { timeMgr: { timeSaveDate: new LosslessInt('639183681557379864') } };
    const b = { timeMgr: { timeSaveDate: new LosslessInt('639183681557379864') } };
    const d = diffJson(a, b);
    expect(d.changes).toEqual([]);
    expect(d.added + d.removed + d.changed).toBe(0);
  });

  it('reports a single clean change when a boxed tick differs', () => {
    const a = { t: new LosslessInt('639183681557379864') };
    const b = { t: new LosslessInt('639183681557379999') };
    const d = diffJson(a, b);
    expect(d.changed).toBe(1);
    expect(d.changes[0]).toMatchObject({
      path: 't',
      kind: 'changed',
      before: '639183681557379864',
      after: '639183681557379999',
    });
  });

  it('detects a tick changed to a small native number without crashing', () => {
    const a = { t: new LosslessInt('639183681557379864') };
    const b = { t: 0 };
    const d = diffJson(a, b);
    expect(d.changed).toBe(1);
    expect(d.changes[0]?.before).toBe('639183681557379864');
    expect(d.changes[0]?.after).toBe('0');
  });
});
