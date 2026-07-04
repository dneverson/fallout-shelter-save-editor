// Shared helpers for reading the AssetRipper Unity-project export: GUID/vector
// extraction, .meta GUID maps, directory walking, NGUI UIAtlas sprite rects, and
// PNG dimensions. Used by the dweller-mesh, sprite-index, and item-icon builders.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** First `guid: <hex>` in a Unity .meta or asset text, or null. */
export function readGuid(text) {
  return text.match(/^guid:\s*([0-9a-f]+)/m)?.[1] ?? null;
}

/** The guid inside the first occurrence of `<field>: { ... guid: <hex> ... }`. */
export function refGuid(text, field) {
  return text.match(new RegExp(`${field}:\\s*\\{[^}]*guid:\\s*([0-9a-f]+)`))?.[1] ?? null;
}

/** A `{x: .., y: ..}` vector following `key:` (same or next line), as [x,y]. */
export function readVec2(text, key) {
  const m = text.match(new RegExp(`${key}:\\s*\\{x:\\s*([-\\d.eE+]+),\\s*y:\\s*([-\\d.eE+]+)`));
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}

/** Recursively list every file under `dir`. */
export function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * Map every asset's .meta GUID → its file path under `dir`, for the given asset
 * extension (e.g. '.asset', '.png'). Reads the sidecar `<file>.meta`.
 */
export function buildGuidToPath(dir, ext) {
  const map = new Map();
  for (const p of walk(dir)) {
    if (!p.endsWith(ext + '.meta')) continue;
    const guid = readGuid(readFileSync(p, 'utf8'));
    if (guid) map.set(guid, p.replace(/\.meta$/, ''));
  }
  return map;
}

/**
 * Parse an NGUI UIAtlas prefab (`*_HD.prefab`): an `mSprites:` list of
 * `{ name, x, y, width, height }` entries giving each sprite's pixel rect within
 * the companion PNG (top-left origin, Y downward).
 * @returns {Map<string,{x:number,y:number,w:number,h:number}>}
 */
export function parseNguiAtlas(prefabText) {
  const re =
    /-\s*name:\s*(.+?)\s*\n\s*x:\s*(\d+)\s*\n\s*y:\s*(\d+)\s*\n\s*width:\s*(\d+)\s*\n\s*height:\s*(\d+)/g;
  const out = new Map();
  let m;
  while ((m = re.exec(prefabText)) !== null) {
    out.set(m[1], { x: +m[2], y: +m[3], w: +m[4], h: +m[5] });
  }
  return out;
}

/** Read width/height from a PNG file's IHDR (bytes 16..23). */
export function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
