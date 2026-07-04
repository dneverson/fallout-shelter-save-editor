import { describe, it, expect } from 'vitest';
import { saveSchema } from '../../src/domain/model/saveSchema.ts';

describe('saveSchema (typed-permissive)', () => {
  it('passes unknown keys through untouched - the pass-through guarantee', () => {
    const input = { knownLater: 1, totallyUnknown: { deep: [1, 2], n: null } };
    expect(saveSchema.parse(input)).toEqual(input);
  });
});
