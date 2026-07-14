import { useEffect, useState } from 'react';
import { loadGameData, type GameData } from '../../domain/gamedata/gameData.ts';
import { buildGuideCodeIndex } from '../../domain/items/collectionCatalog.ts';
import { setGuideCodeIndex } from '../../state/saveStore.ts';

// Loads the committed game data (weapons/outfits/junk/…) once and caches it at
// module scope so every view shares a single parsed copy. Game data is static
// reference data, not UI state, so it lives here rather than in a Zustand store.
// The roster degrades gracefully without it (selectors fall back to raw save ids),
// so a load failure is surfaced but never blocks editing.

export type GameDataStatus = 'loading' | 'ready' | 'error';

let cache: GameData | null = null;
let inflight: Promise<GameData> | null = null;

export interface UseGameDataResult {
  data: GameData | null;
  status: GameDataStatus;
  error: string | null;
}

export function useGameData(): UseGameDataResult {
  const [data, setData] = useState<GameData | null>(cache);
  const [status, setStatus] = useState<GameDataStatus>(cache ? 'ready' : 'loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache) return;
    let active = true;
    inflight ??= loadGameData();
    inflight
      .then((loaded) => {
        cache = loaded;
        // Enable Survival Guide auto-collect: from here on, edits that introduce
        // objects (items/pets/special dwellers) also mark their guide entries.
        setGuideCodeIndex(buildGuideCodeIndex(loaded));
        if (active) {
          setData(loaded);
          setStatus('ready');
        }
      })
      .catch((e: unknown) => {
        inflight = null; // allow a later retry
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load game data.');
          setStatus('error');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return { data, status, error };
}
