// quests.json - the full narrative quest catalog + questline graph.
//
// Source: Resources/FullQuestData_{0..51}.asset (1040 quest entries, script guid
// cebe7b41407df0adf858f8c14aa92021). Each entry is captured WHOLE (all m_* fields, per
// the QUEST-TAB-FINDINGS "capture ALL fields" decision) via the generic monoAsset parser,
// with every *LocID / *LocalizerKey resolved to English through I2Languages.
//
// Output shape:
//   { resolvedText: Record<locID,string>, quests: QuestRecord[], questlines: Questline[] }
//     resolvedText - one shared, de-duplicated locID -> English map for the whole file
//                    (variants repeat the same strings; stored once).
//     quests       - one full record per m_questName (the detail-panel source of truth).
//     questlines   - narrative (m_questType == 0) quests grouped by questline title,
//                    difficulty variants collapsed into one node, nodes topo-sorted along
//                    their m_questDependancies chain (the horizontal graph).
//
// Size decisions (QUEST-TAB-FINDINGS pause, approved): `m_fillingParameters` (procedural
// dungeon-gen filler + spawn weights - the editor never generates dungeons) is dropped;
// None-loot padding (m_lootType 0) is stripped from every loot slot; dialogue is kept.
//
// Re-run via `pnpm gamedata:build` when the game ships new quests.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PATHS, readSource, writeOutput } from './lib/io.mjs';
import { parseLocalization } from './lib/prefab.mjs';
import { parseMonoBehaviour } from './lib/monoAsset.mjs';

// Collapse a difficulty-variant quest name to its base node id: the game treats
// `Foo_02_Diff_40` and `Foo_02_Diff_10` as the same step (includeQuestlineQuestVariants).
function baseName(name) {
  return name.replace(/_Diff_?\d+$/i, '');
}

// Trailing `_Quest_NN` (or `_NN`) index, used as the fallback ordering when a questline's
// dependency edges are missing/ambiguous.
function stepIndex(name) {
  const m = name.match(/_(?:Quest_)?(\d+)(?:_Diff_?\d+)?$/i);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/**
 * Recursively collect every localization key referenced in a quest record (keys ending
 * in LocID / LocalizerKey with a non-empty string value) into `into` as key -> English.
 */
function collectLoc(node, loc, into) {
  if (Array.isArray(node)) {
    for (const v of node) collectLoc(v, loc, into);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && v !== '' && /(LocID|LocalizerKey)$/.test(k)) {
        const text = loc.get(v);
        if (text !== undefined) into[v] = text;
      } else {
        collectLoc(v, loc, into);
      }
    }
  }
}

/** Topologically order questline nodes along their dependency edges (Kahn), with a
 *  stable `stepIndex` fallback for ties and for nodes whose edges leave the questline. */
function orderNodes(nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const n of nodes) {
    for (const dep of n.dependencies) {
      if (ids.has(dep) && dep !== n.id) {
        adj.get(dep).push(n.id);
        indeg.set(n.id, indeg.get(n.id) + 1);
      }
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ready = nodes.filter((n) => indeg.get(n.id) === 0).sort(cmpStep);
  const out = [];
  const seen = new Set();
  while (ready.length) {
    const n = ready.shift();
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
    const next = adj
      .get(n.id)
      .filter((id) => {
        indeg.set(id, indeg.get(id) - 1);
        return indeg.get(id) === 0;
      })
      .map((id) => byId.get(id));
    ready.push(...next);
    ready.sort(cmpStep);
  }
  // Any leftover (cycles - not expected) appended in step order so nothing is dropped.
  for (const n of nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}

function cmpStep(a, b) {
  const d = stepIndex(a.id) - stepIndex(b.id);
  return d !== 0 ? d : a.id.localeCompare(b.id);
}

/** True for a padding loot slot (None). */
const isNoneLoot = (l) => !l || l.m_lootType === 0;

/**
 * Slim a quest record for shipping: drop the dungeon-gen `m_fillingParameters` block and
 * strip None-loot padding from every mandatory room's four loot slots (single-object
 * combat/roomCompletion slots are removed when None; the two array slots are filtered).
 */
function slimQuest(entry) {
  const { m_fillingParameters, m_mandatoryRooms, ...rest } = entry;
  void m_fillingParameters; // intentionally dropped
  const rooms = (m_mandatoryRooms ?? []).map((room) => {
    const r = { ...room };
    if (isNoneLoot(r.m_combatLoot)) delete r.m_combatLoot;
    if (isNoneLoot(r.m_roomCompletionLoot)) delete r.m_roomCompletionLoot;
    r.m_pickableLoot = (r.m_pickableLoot ?? []).filter((l) => !isNoneLoot(l));
    r.m_extraRoomCompletionLoot = (r.m_extraRoomCompletionLoot ?? []).filter((l) => !isNoneLoot(l));
    return r;
  });
  return { ...rest, m_mandatoryRooms: rooms };
}

export function buildQuests() {
  const loc = parseLocalization(readSource(PATHS.i2));

  const files = readdirSync(PATHS.resourcesDir)
    .filter((f) => /^FullQuestData_\d+\.asset$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  const quests = [];
  const resolvedText = {}; // one shared, de-duplicated locID -> English map
  for (const file of files) {
    const mono = parseMonoBehaviour(readSource(join(PATHS.resourcesDir, file)));
    const entries = mono.m_questInformations ?? [];
    for (const entry of entries) {
      // v2.5.0 leaks dev test entries (Quest_Dummy_NPCSpotTesting_1..4, "LEVEL UP")
      // into FullQuestData; they are not real content and would pollute questlines.
      if (entry.m_questName?.startsWith('Quest_Dummy_')) continue;
      collectLoc(entry, loc, resolvedText);
      quests.push({
        ...slimQuest(entry),
        // Convenience resolved fields (also present in resolvedText by key).
        title: loc.get(entry.m_questTitleLocID) ?? '',
        questlineTitle: loc.get(entry.m_questlineTitleLocID) ?? '',
        shortDescription: loc.get(entry.m_questShortDescriptionLocID) ?? '',
        longDescription: loc.get(entry.m_questLongDescriptionLocID) ?? '',
      });
    }
  }

  // --- questline graph (narrative + seasonal quests) ---
  // m_questType 0 = narrative story lines; 5 = seasonal event lines (Valentines, Christmas,
  // ...). Both are dependency chains, so both become graph lanes. Seasonal one-offs with no
  // questlineTitle (Halloween_01, ...) are left out here and surface in the flat region.
  const byLine = new Map(); // questlineTitleLocID -> Map<baseId, node>
  for (const q of quests) {
    if (q.m_questType !== 0 && q.m_questType !== 5) continue;
    if (!q.m_questlineTitleLocID) continue;
    const lineKey = q.m_questlineTitleLocID;
    if (!byLine.has(lineKey)) byLine.set(lineKey, new Map());
    const nodes = byLine.get(lineKey);
    const id = baseName(q.m_questName);
    let node = nodes.get(id);
    if (!node) {
      node = {
        id,
        title: q.title,
        titleLocID: q.m_questTitleLocID,
        shortDescription: q.shortDescription,
        environment: q.m_questEnvironment,
        questNames: [],
        dependencies: new Set(),
        difficultyMin: q.m_questDifficultyMin,
        difficultyMax: q.m_questDifficultyMax,
      };
      nodes.set(id, node);
    }
    node.questNames.push(q.m_questName);
    node.difficultyMin = Math.min(node.difficultyMin, q.m_questDifficultyMin);
    node.difficultyMax = Math.max(node.difficultyMax, q.m_questDifficultyMax);
    for (const dep of q.m_questDependancies ?? []) node.dependencies.add(baseName(dep));
  }

  const questlines = [];
  for (const [titleLocID, nodesMap] of byLine) {
    const raw = [...nodesMap.values()].map((n) => ({
      ...n,
      dependencies: [...n.dependencies],
    }));
    const ordered = orderNodes(raw);
    questlines.push({
      titleLocID,
      title: loc.get(titleLocID) ?? '',
      nodes: ordered,
    });
  }
  questlines.sort((a, b) => a.title.localeCompare(b.title));

  return { resolvedText, quests, questlines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('quests.json', buildQuests(), { pretty: false });
}
