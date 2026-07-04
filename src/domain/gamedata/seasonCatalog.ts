import {
  seasonPassCatalogSchema,
  type SeasonCatalogEntry,
  type SeasonPassCatalog,
} from './schemas.ts';
import { assetUrl } from './assetBase.ts';

// Season Pass catalog access layer, mirroring gameData.ts.
// Validates the committed season-pass.json and indexes it by season id. Kept separate
// from the core GameData bundle because only the lazy-loaded Season tab needs it.

export interface SeasonCatalog {
  /** Inert `ncqReward` placeholder template (claim state stripped), or null if absent. */
  ncqReward: SeasonPassCatalog['ncqReward'];
  /** Seasons in catalog order (== the order they appear in the reference spd.dat). */
  seasons: SeasonCatalogEntry[];
  /** Season ids in catalog order - the season switcher's pill order. */
  seasonIds: string[];
  /** season id → catalog entry. */
  seasonById: ReadonlyMap<string, SeasonCatalogEntry>;
}

/** Validate raw season-pass.json and index it. Pure - no I/O, so it's unit-testable in Node. */
export function parseSeasonCatalog(raw: unknown): SeasonCatalog {
  const catalog = seasonPassCatalogSchema.parse(raw);
  return {
    ncqReward: catalog.ncqReward,
    seasons: catalog.seasons,
    seasonIds: catalog.seasons.map((s) => s.id),
    seasonById: new Map(catalog.seasons.map((s) => [s.id, s])),
  };
}

/** Fetch + validate the Season Pass catalog from the served gamedata directory (browser). */
export async function loadSeasonCatalog(baseUrl = assetUrl('gamedata')): Promise<SeasonCatalog> {
  const res = await fetch(`${baseUrl}/season-pass.json`);
  if (!res.ok) throw new Error(`Failed to load season-pass.json (HTTP ${res.status})`);
  return parseSeasonCatalog((await res.json()) as unknown);
}
