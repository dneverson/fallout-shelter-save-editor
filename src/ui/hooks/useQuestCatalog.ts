import { useEffect, useState } from 'react';
import { loadQuestCatalog, type QuestCatalog } from '../../domain/gamedata/questCatalog.ts';

// Loads the committed quest + objective catalog (quests.json + objectives.json) once and
// caches it at module scope, mirroring useSeasonCatalog. Kept separate from the core
// GameData bundle because quests.json is multi-MB and only the lazy-loaded Quest tab needs it.

export type QuestCatalogStatus = 'loading' | 'ready' | 'error';

let cache: QuestCatalog | null = null;
let inflight: Promise<QuestCatalog> | null = null;

export interface UseQuestCatalogResult {
  data: QuestCatalog | null;
  status: QuestCatalogStatus;
  error: string | null;
}

export function useQuestCatalog(): UseQuestCatalogResult {
  const [data, setData] = useState<QuestCatalog | null>(cache);
  const [status, setStatus] = useState<QuestCatalogStatus>(cache ? 'ready' : 'loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache) return;
    let active = true;
    inflight ??= loadQuestCatalog();
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
          setError(e instanceof Error ? e.message : 'Failed to load the quest catalog.');
          setStatus('error');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return { data, status, error };
}
