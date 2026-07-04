import { useEffect, useState } from 'react';
import type { VisualAssets } from '../../domain/gamedata/visualAssets.ts';
import type { RenderableDweller } from '../../render/dwellerAppearance.ts';
import { dwellerThumbnailKey } from '../../render/dwellerThumbnailKey.ts';
import { getCachedThumbnail } from '../../render/dwellerThumbnailCache.ts';

// The Pixi renderer is imported dynamically (below) so pixi.js stays in a lazily-loaded
// chunk - the import/landing screens never pay for it. Both the seed (getCachedThumbnail)
// and the appearance key are Pixi-free, so cached avatars still show synchronously.

// Returns a PNG data-URL avatar for a dweller, rendered via the shared offscreen
// renderer (one WebGL context for the whole roster). Re-renders only when the dweller's
// appearance key changes; an already-cached look is shown immediately (no placeholder
// flash on re-scroll). Returns null while a new look is rendering or on failure, so the
// caller degrades to the grey placeholder and never blocks the table.

export function useDwellerThumbnail(
  dweller: RenderableDweller | null,
  assets: VisualAssets | null,
): string | null {
  const key = dweller ? dwellerThumbnailKey(dweller) : null;

  // Seed (and re-seed on key change) from the cache: instant for known looks, null for
  // new ones. Adjust-during-render rather than an effect - the project bans
  // setState-in-useEffect (React Compiler lint); the async render below sets state after
  // an await, which is allowed.
  const [url, setUrl] = useState<string | null>(() =>
    key ? (getCachedThumbnail(key) ?? null) : null,
  );
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setUrl(key ? (getCachedThumbnail(key) ?? null) : null);
  }

  useEffect(() => {
    if (!dweller || !assets) return;
    if (getCachedThumbnail(dwellerThumbnailKey(dweller))) return; // already shown via seed
    let cancelled = false;
    // Dynamic import keeps Pixi out of the initial bundle; it loads on first thumbnail.
    void import('../../render/dwellerThumbnail.ts')
      .then(({ renderDwellerThumbnail }) => renderDwellerThumbnail(dweller, assets))
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        /* keep the placeholder on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [dweller, assets]);

  return url;
}
