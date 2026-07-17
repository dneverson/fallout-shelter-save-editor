// objectives.json - the daily-objective catalog (the 3 rotating tasks in objectiveMgr).
//
// Source: GameObject/Objective MGR.prefab. One "Objective MGR" MonoBehaviour holds an
// ordered `m_objectives[]` ref list of 530 objective MonoBehaviours (script guid
// 0aca04db26949e7e4e559fdcf6beaca8). Each objective references its requirement rows
// (guid 7dab647c..., the m_requirementID/scaling + m_baseGoalResources) and assignment
// requisites (guid d08ca458..., dweller-count gates) by fileID, resolved here into nested
// records. Every objective is captured WHOLE (bookkeeping stripped) per the "capture all
// fields" decision, with m_descriptionLocalizerKey resolved to English via I2Languages.
//
// Output shape:
//   { resolvedText: Record<locKey,string>, objectives: ObjectiveRecord[] }
//     resolvedText - one shared, de-duplicated loc-key -> English map (many objectives
//                    share a description key, e.g. Objective_Food; stored once).
//     objectives   - one record per m_objectiveID, in the MGR's m_objectives[] order,
//                    each with resolved `requirements[]`, `assignmentRequisites[]`, and a
//                    convenience `description`.
//
// Re-run via `pnpm gamedata:build` when the game ships new objectives.
import { pathToFileURL } from 'node:url';
import { PATHS, readSource, writeOutput } from './lib/io.mjs';
import { parseLocalization, parseDocuments } from './lib/prefab.mjs';
import { parseMonoBehaviour } from './lib/monoAsset.mjs';

// Unity per-object bookkeeping fields shared by every MonoBehaviour - never editor-relevant.
const BOOKKEEPING = new Set([
  'm_ObjectHideFlags',
  'm_CorrespondingSourceObject',
  'm_PrefabInstance',
  'm_PrefabAsset',
  'm_GameObject',
  'm_Enabled',
  'm_EditorHideFlags',
  'm_Script',
  'm_Name',
  'm_EditorClassIdentifier',
]);

/** Pull the numeric target out of a `{fileID: N}` reference string, or null. */
function refId(v) {
  const m = typeof v === 'string' ? v.match(/fileID:\s*(\d+)/) : null;
  return m ? m[1] : null;
}

/** Drop the Unity bookkeeping keys (and any listed extras) from a parsed MonoBehaviour. */
function slim(obj, extraDrop = []) {
  const drop = new Set([...BOOKKEEPING, ...extraDrop]);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!drop.has(k)) out[k] = v;
  }
  return out;
}

export function buildObjectives() {
  const loc = parseLocalization(readSource(PATHS.i2));
  const text = readSource(PATHS.objectiveMgr);

  // fileID -> parsed MonoBehaviour (GameObject/Transform docs parse too; we only look up
  // the objective/requirement/requisite ids we reference, so the rest are simply ignored).
  const docs = parseDocuments(text);
  const byId = new Map();
  for (const [id, docText] of docs) byId.set(id, parseMonoBehaviour(docText));

  // The single "Objective MGR" MonoBehaviour owns the canonical ordered id list - the 510
  // objectives in the live shuffle pool. 20 more objective definitions exist outside it
  // (SurviveMoleratNoStimpack*, ExploreWastelandDays*, DailyRewards*, ...); a save can still
  // reference those, so append them after the rotation set (all 530 captured, MGR order first).
  let mgrIds = null;
  for (const obj of byId.values()) {
    if (Array.isArray(obj.m_objectives)) {
      mgrIds = obj.m_objectives.map(refId).filter(Boolean);
      break;
    }
  }
  if (!mgrIds) throw new Error('Objective MGR: no m_objectives ref list found');

  const inList = new Set(mgrIds);
  const extraIds = [...byId.keys()].filter(
    (id) => !inList.has(id) && byId.get(id).m_objectiveID !== undefined,
  );
  const orderedIds = [...mgrIds, ...extraIds];

  const resolvedText = {}; // shared, de-duplicated loc-key -> English
  const objectives = [];
  for (const fileId of orderedIds) {
    const raw = byId.get(fileId);
    if (!raw || raw.m_objectiveID === undefined) continue;

    // Requirement rows carry an m_objective back-ref to this objective - drop it.
    const requirements = (raw.m_requirements ?? [])
      .map((r) => byId.get(refId(r)))
      .filter(Boolean)
      .map((r) => slim(r, ['m_objective']));
    const assignmentRequisites = (raw.m_assignmentRequisites ?? [])
      .map((r) => byId.get(refId(r)))
      .filter(Boolean)
      .map((r) => slim(r));

    const locKey = raw.m_descriptionLocalizerKey;
    if (typeof locKey === 'string' && locKey !== '') {
      const english = loc.get(locKey);
      if (english !== undefined) resolvedText[locKey] = english;
    }

    objectives.push({
      ...slim(raw, ['m_requirements', 'm_assignmentRequisites']),
      requirements,
      assignmentRequisites,
      description: loc.get(locKey) ?? '',
    });
  }

  return { resolvedText, objectives };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('objectives.json', buildObjectives());
}
