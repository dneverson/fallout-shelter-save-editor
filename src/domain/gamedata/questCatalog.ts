import {
  questsFileSchema,
  objectivesFileSchema,
  type Quest,
  type Questline,
  type ObjectiveDef,
} from './schemas.ts';
import { assetUrl } from './assetBase.ts';

// Quest + objective catalog access layer, mirroring seasonCatalog.ts. Validates the
// committed quests.json / objectives.json and indexes them. Kept OUT of the core GameData
// bundle (gameData.ts): quests.json alone is multi-MB, and only the lazy-loaded Quest tab
// needs it - so it is fetched on demand by useQuestCatalog, not on every app start.

export interface QuestCatalog {
  /** Shared, de-duplicated locID/loc-key -> English map spanning quests + objectives. */
  resolvedText: Record<string, string>;
  /** Every quest record in file order (the detail-panel source of truth). */
  quests: Quest[];
  /** Narrative questlines (topo-sorted nodes) - the horizontal graph lanes. */
  questlines: Questline[];
  /** The 530 daily-objective definitions in MGR-rotation order. */
  objectives: ObjectiveDef[];
  /** m_questName -> quest record (completedQuestDataManager stores these ids). */
  questByName: ReadonlyMap<string, Quest>;
  /** m_objectiveID -> objective definition. */
  objectiveById: ReadonlyMap<string, ObjectiveDef>;
}

/**
 * Validate raw quests.json + objectives.json and index them. Pure (no I/O), so it is
 * unit-testable in Node. `resolvedText` from both files is merged (the loc keyspaces are
 * disjoint: quest locIDs vs Objective_* keys).
 */
export function parseQuestCatalog(rawQuests: unknown, rawObjectives: unknown): QuestCatalog {
  const questsFile = questsFileSchema.parse(rawQuests);
  const objectivesFile = objectivesFileSchema.parse(rawObjectives);
  return {
    resolvedText: { ...questsFile.resolvedText, ...objectivesFile.resolvedText },
    quests: questsFile.quests,
    questlines: questsFile.questlines,
    objectives: objectivesFile.objectives,
    questByName: new Map(questsFile.quests.map((q) => [q.m_questName, q])),
    objectiveById: new Map(objectivesFile.objectives.map((o) => [o.m_objectiveID, o])),
  };
}

/** Fetch + validate the quest + objective catalog from the served gamedata directory. */
export async function loadQuestCatalog(baseUrl = assetUrl('gamedata')): Promise<QuestCatalog> {
  const [rawQuests, rawObjectives] = await Promise.all(
    ['quests', 'objectives'].map(async (name) => {
      const res = await fetch(`${baseUrl}/${name}.json`);
      if (!res.ok) throw new Error(`Failed to load ${name}.json (HTTP ${res.status})`);
      return res.json() as Promise<unknown>;
    }),
  );
  return parseQuestCatalog(rawQuests, rawObjectives);
}
