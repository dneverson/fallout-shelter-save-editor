import { useEffect, useState } from 'react';
import { loadVisualAssets, type VisualAssets } from '../../domain/gamedata/visualAssets.ts';

// Loads the committed visual assets (body meshes + sprite index + item icons) once and
// caches them at module scope, mirroring useGameData: static reference data shared by the
// preview renderer and (later) the table thumbnails. A load failure is surfaced but never
// blocks editing - the character sheet still works without the preview.

export type VisualAssetsStatus = 'loading' | 'ready' | 'error';

let cache: VisualAssets | null = null;
let inflight: Promise<VisualAssets> | null = null;

export interface UseVisualAssetsResult {
  assets: VisualAssets | null;
  status: VisualAssetsStatus;
  error: string | null;
}

export function useVisualAssets(): UseVisualAssetsResult {
  const [assets, setAssets] = useState<VisualAssets | null>(cache);
  const [status, setStatus] = useState<VisualAssetsStatus>(cache ? 'ready' : 'loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache) return;
    let active = true;
    inflight ??= loadVisualAssets();
    inflight
      .then((loaded) => {
        cache = loaded;
        if (active) {
          setAssets(loaded);
          setStatus('ready');
        }
      })
      .catch((e: unknown) => {
        inflight = null; // allow a later retry
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load visual assets.');
          setStatus('error');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return { assets, status, error };
}
