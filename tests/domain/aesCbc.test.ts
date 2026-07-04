// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { decrypt, encrypt } from '../../src/domain/crypto/aesCbc.ts';

describe('aesCbc', () => {
  it('decrypt∘encrypt returns the original bytes (any length → PKCS#7 padding)', async () => {
    for (const len of [0, 1, 15, 16, 17, 1000]) {
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) data[i] = (i * 37) % 256;
      const restored = await decrypt(await encrypt(data));
      expect(Array.from(restored)).toEqual(Array.from(data));
    }
  });
});
