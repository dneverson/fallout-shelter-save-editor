import { useEffect, useState } from 'react';
import { loadSeasonCatalog, type SeasonCatalog } from '../../domain/gamedata/seasonCatalog.ts';

// Loads the committed Season Pass reward catalog (season-pass.json) once and caches it at
// module scope, mirroring useGameData. Kept separate from the core GameData bundle because
// only the lazy-loaded Season tab needs it. The catalog drives
// the "Continue without a file" path: a fresh, editable spd.dat working model is built purely
// from it (seasonOps.buildFreshSeasonSave).

export type SeasonCatalogStatus = 'loading' | 'ready' | 'error';

let cache: SeasonCatalog | null = null;
let inflight: Promise<SeasonCatalog> | null = null;

export interface UseSeasonCatalogResult {
  data: SeasonCatalog | null;
  status: SeasonCatalogStatus;
  error: string | null;
}

export function useSeasonCatalog(): UseSeasonCatalogResult {
  const [data, setData] = useState<SeasonCatalog | null>(cache);
  const [status, setStatus] = useState<SeasonCatalogStatus>(cache ? 'ready' : 'loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache) return;
    let active = true;
    inflight ??= loadSeasonCatalog();
    inflight
      .then((loaded) => {
        cache = loaded;
        if (active) {
          setData(loaded);
          setStatus('ready');
        }
      })
      .catch((e: unknown) => {
        inflight = null; // allow a later retry
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load the Season Pass catalog.');
          setStatus('error');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return { data, status, error };
}
