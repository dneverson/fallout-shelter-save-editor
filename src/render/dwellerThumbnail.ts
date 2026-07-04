import type { Texture } from 'pixi.js';
import type { VisualAssets } from '../domain/gamedata/visualAssets.ts';
import type { RenderableDweller } from './dwellerAppearance.ts';
import { buildLayersWithMeta } from './dwellerLayers.ts';
import {
  createDwellerRenderer,
  type DwellerRenderer,
  type RendererLayerInput,
} from './dwellerRenderer.ts';
import { loadAtlasTexture } from './atlasTextures.ts';
import { dwellerThumbnailKey } from './dwellerThumbnailKey.ts';
import { getCachedThumbnail, setCachedThumbnail } from './dwellerThumbnailCache.ts';

// Shared offscreen dweller-thumbnail renderer for the roster table.
//
// Why one shared renderer: a browser allows only a handful of live WebGL contexts
// (~16 before the oldest is force-lost). Giving each of 100+ roster rows its own Pixi
// renderer would blow that limit and make avatars vanish. Instead we keep ONE offscreen
// renderer, draw each distinct-looking dweller into it serially, snapshot the canvas to
// a PNG data-URL, and let rows display that URL in a cheap, unlimited <img>.
//
// Results are cached by appearance key (dwellerThumbnailKey), so re-scrolling a virtual
// table is instant and identical-looking dwellers cost a single render. An edit that
// changes a dweller's look simply produces a new key - the new look renders once while
// the old cached entry stays put (no recolor thrash, no whole-cache invalidation).

const THUMB_SIZE = 128;

let rendererPromise: Promise<DwellerRenderer> | null = null;

/** The shared offscreen renderer (created once, lazily). Pixi v8 init is async. */
function getRenderer(): Promise<DwellerRenderer> {
  rendererPromise ??= createDwellerRenderer({ width: THUMB_SIZE, height: THUMB_SIZE });
  return rendererPromise;
}

const inflight = new Map<string, Promise<string>>();

// A single shared canvas can only draw one dweller at a time, so renders run serially.
let queue: Promise<unknown> = Promise.resolve();

/** Draw one dweller (all layers, no weapon/pet overlays) and capture the canvas as a PNG. */
async function drawThumbnail(dweller: RenderableDweller, assets: VisualAssets): Promise<string> {
  const renderer = await getRenderer();
  const gender: 'male' | 'female' = dweller.gender === 2 ? 'male' : 'female';
  const meshData = assets.meshSet[gender];
  const mesh = dweller.isChild ? meshData.child : meshData.adult;

  const { layers: allLayers } = buildLayersWithMeta(dweller, assets);
  // Full render: a glove pose overrides the bare fists beneath it, and an exclusive
  // helmet hides the hair beneath it (the under* fallbacks exist only for the preview's
  // view toggles).
  const layers = allLayers.filter((l) => !l.underGlove && !l.underHelmet);

  // Load every atlas the layers need once, then map textures onto the layer inputs.
  const filenames = new Set<string>();
  for (const l of layers) {
    filenames.add(l.atlas);
    if (l.coloringMask) filenames.add(l.coloringMask.atlas);
  }
  const entries = await Promise.all(
    [...filenames].map(async (f) => [f, await loadAtlasTexture(f)] as const),
  );
  const textures = new Map<string, Texture>(entries);

  const inputs: RendererLayerInput[] = layers.map((l) => ({
    ...l,
    texture: textures.get(l.atlas)!,
    ...(l.coloringMask ? { maskTexture: textures.get(l.coloringMask.atlas)! } : {}),
  }));

  renderer.render(mesh, inputs, { atlasSize: assets.meshSet.atlasSize });
  // The renderer keeps its drawing buffer (preserveDrawingBuffer), so the canvas holds
  // the frame - capture it directly for a fixed-size square PNG.
  return renderer.canvas.toDataURL('image/png');
}

/**
 * Render a dweller to a PNG data-URL through the shared offscreen renderer, cached by
 * appearance key. Repeated/identical looks resolve instantly from cache; concurrent
 * requests for the same key share one render. Rejects only if the render itself fails
 * (callers degrade to the placeholder).
 */
export function renderDwellerThumbnail(
  dweller: RenderableDweller,
  assets: VisualAssets,
): Promise<string> {
  const key = dwellerThumbnailKey(dweller);
  const cached = getCachedThumbnail(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;

  const run = queue.then(() => drawThumbnail(dweller, assets));
  // Keep the serial chain alive even when one render rejects.
  queue = run.catch(() => undefined);

  const tracked = run.then(
    (url) => {
      setCachedThumbnail(key, url);
      inflight.delete(key);
      return url;
    },
    (err: unknown) => {
      inflight.delete(key); // allow a later retry
      throw err;
    },
  );
  inflight.set(key, tracked);
  return tracked;
}
