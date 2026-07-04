import { decrypt, encrypt } from '../crypto/aesCbc.ts';
import { parseLossless, stringifyLossless } from './losslessJson.ts';
import type { SaveData } from '../model/saveSchema.ts';
import type { NvfData, SeasonSave } from '../model/seasonSchema.ts';

// Container codec:
//   .sav/.dat (base64) ──decode──► bytes ──AES-CBC decrypt──► UTF-8 ──parse──► JSON
//   JSON ──stringify──► UTF-8 ──AES-CBC encrypt──► bytes ──base64──► .sav/.dat
//
// ONE container implementation is shared by `.sav`, `spd.dat` and `nvf.dat` - they
// use the identical base64 + AES-256-CBC (same KEY/IV) + UTF-8 + JSON envelope.
// The inner JSON step is big-int lossless (losslessJson.ts) so `spd.dat`'s 64-bit
// .NET tick fields survive verbatim; for the main `.sav` (no out-of-range ints)
// this is a no-op and output stays byte-identical to plain JSON.stringify.
//
// We intentionally do NOT run the save through Zod here - codec preserves the raw
// JSON structure verbatim so untouched keys round-trip. Validation happens
// at the edit-op boundary in later phases.

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000; // avoid call-stack limits in String.fromCharCode(...spread)
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Decode any Fallout Shelter container file (base64 text) into parsed JSON.
 * Shared by `.sav`, `spd.dat` and `nvf.dat`. Integer literals beyond
 * `Number.MAX_SAFE_INTEGER` are preserved as `LosslessInt` (losslessJson.ts).
 */
export async function decodeContainer<T = unknown>(text: string): Promise<T> {
  const cipher = base64ToBytes(text.trim());
  const plain = await decrypt(cipher);
  const json = utf8Decoder.decode(plain);
  return parseLossless(json) as T;
}

/** Encode parsed JSON back into container text (base64). Counterpart to {@link decodeContainer}. */
export async function encodeContainer(value: unknown): Promise<string> {
  // Copy into an ArrayBuffer-backed array - TextEncoder may return a view over
  // SharedArrayBuffer-typed memory, which Web Crypto's BufferSource rejects.
  const plain = new Uint8Array(utf8Encoder.encode(stringifyLossless(value)));
  const cipher = await encrypt(plain);
  return bytesToBase64(cipher);
}

/** Decode `.sav` text (base64) into the parsed save JSON. */
export async function decode(savText: string): Promise<SaveData> {
  return decodeContainer<SaveData>(savText);
}

/** Encode a save JSON back into `.sav` text (base64). */
export async function encode(save: SaveData): Promise<string> {
  return encodeContainer(save);
}

/** Decode `spd.dat` text (base64) into the parsed season-pass JSON. */
export async function decodeSeason(datText: string): Promise<SeasonSave> {
  return decodeContainer<SeasonSave>(datText);
}

/** Encode a season-pass JSON back into `spd.dat` text (base64). */
export async function encodeSeason(season: SeasonSave): Promise<string> {
  return encodeContainer(season);
}

/** Decode `nvf.dat` text (base64) into the parsed current-season pointer. */
export async function decodeNvf(datText: string): Promise<NvfData> {
  return decodeContainer<NvfData>(datText);
}

/** Encode an `nvf.dat` JSON back into container text (base64). */
export async function encodeNvf(nvf: NvfData): Promise<string> {
  return encodeContainer(nvf);
}
