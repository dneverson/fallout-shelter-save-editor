import { Assets, type Texture } from 'pixi.js';
import { assetUrl } from '../domain/gamedata/assetBase.ts';

// Module-level cache of loaded atlas textures, keyed by filename. Atlas PNGs are large
// (1024×1024) and shared across every dweller, so we load each once and reuse the GPU
// texture. Pixi's Assets layer dedupes in-flight loads too; this map keeps our own
// filename→Texture promise so callers don't need to know the served path.

const BASE_URL = assetUrl('gamedata/atlas');
const cache = new Map<string, Promise<Texture>>();

/** Load (and cache) an atlas PNG as a Pixi texture. */
export function loadAtlasTexture(filename: string): Promise<Texture> {
  let p = cache.get(filename);
  if (!p) {
    p = Assets.load<Texture>(`${BASE_URL}/${filename}`);
    cache.set(filename, p);
  }
  return p;
}
