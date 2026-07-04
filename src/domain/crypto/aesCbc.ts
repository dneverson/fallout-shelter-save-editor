// AES-256-CBC over the Web Crypto API (crypto.subtle). The key and IV are the
// fixed, game-wide constants - Fallout Shelter
// uses the same key/IV on every platform, stable across versions to date.
// PKCS#7 padding is the Web Crypto default and matches the game.
//
// Pure domain code: no React/DOM imports. Runs in the browser
// and in Node 20+ / Vitest (both expose globalThis.crypto.subtle).

const KEY_HEX = 'a7ca9f3366d892c2f0bef417341ca971b69ae9f7bacccffcf43c62d1d7d021f9';
const IV_HEX = '7475383967656a693334307438397532'; // ASCII "tu89geji340t89u2"

// ArrayBuffer-backed bytes: Web Crypto's `BufferSource` excludes SharedArrayBuffer,
// which TS 5.7+/6 enforces via the typed-array buffer generic.
type Bytes = Uint8Array<ArrayBuffer>;

function hexToBytes(hex: string): Bytes {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const IV: Bytes = hexToBytes(IV_HEX);

let keyPromise: Promise<CryptoKey> | undefined;
function getKey(): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey('raw', hexToBytes(KEY_HEX), { name: 'AES-CBC' }, false, [
    'encrypt',
    'decrypt',
  ]);
  return keyPromise;
}

/** Decrypt AES-256-CBC ciphertext bytes → plaintext bytes (padding stripped). */
export async function decrypt(ciphertext: Bytes): Promise<Bytes> {
  const key = await getKey();
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: IV }, key, ciphertext);
  return new Uint8Array(plain);
}

/** Encrypt plaintext bytes → AES-256-CBC ciphertext bytes (PKCS#7 padded). */
export async function encrypt(plaintext: Bytes): Promise<Bytes> {
  const key = await getKey();
  const cipher = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: IV }, key, plaintext);
  return new Uint8Array(cipher);
}
