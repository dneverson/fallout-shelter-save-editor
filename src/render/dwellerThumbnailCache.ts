// Pixi-free thumbnail cache (appearance key → PNG data-URL). Split out of
// dwellerThumbnail.ts so the roster can synchronously seed already-rendered avatars
// WITHOUT statically importing the Pixi renderer - that keeps pixi.js in a lazily-loaded
// chunk (perf). The renderer module writes results here; the hook reads them.

const cache = new Map<string, string>();

/** Read an already-rendered thumbnail (lets the hook avoid a placeholder flash). */
export function getCachedThumbnail(key: string): string | undefined {
  return cache.get(key);
}

export function setCachedThumbnail(key: string, url: string): void {
  cache.set(key, url);
}
