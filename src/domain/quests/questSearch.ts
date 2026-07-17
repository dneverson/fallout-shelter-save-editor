import type { Quest } from '../gamedata/schemas.ts';
import type { QuestMapNode } from './questGraphLayout.ts';

// Find-in-map text matching for the Quests tab.
//
// Search is a FILTER FACET (see questMatchesQuery below, which questMatchesFilter calls), not a
// mechanism of its own. QuestsView's ↑/↓ stepper walks the filter's match set directly, in
// buildQuestMapLayout's node order - story chains lane-by-lane, then Standalone, then Repeatable -
// so ↓ walks the map the way you scan it.

/** One search hit: the node's map id plus the quest-name to select (the node's representative). */
export interface QuestSearchMatch {
  nodeId: string;
  questName: string;
}

/**
 * Nodes matching `query`, case-insensitively, on any of: the display title, any collapsed
 * m_questName, or the owning questline title. A blank query matches nothing.
 *
 * NOT WIRED TO THE UI, and deliberately so. This asks "which drawn nodes contain this text",
 * which is the wrong question for the ↑/↓ stepper: the drawn map includes the chain context a
 * match drags in, and text alone cannot tell context from a match, so stepping used to land on
 * nodes the filter had rejected. QuestsView reads filterQuestCatalog's match set instead, which
 * already accounts for the search facet AND every other one.
 */
export function matchQuestNodes(nodes: readonly QuestMapNode[], query: string): QuestSearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];

  const out: QuestSearchMatch[] = [];
  for (const n of nodes) {
    if (n.questNames.length === 0) continue;
    const hit =
      n.title.toLowerCase().includes(needle) ||
      (n.questlineTitle?.toLowerCase().includes(needle) ?? false) ||
      n.questNames.some((q) => q.toLowerCase().includes(needle));
    if (hit) out.push({ nodeId: n.id, questName: n.questNames[0] });
  }
  return out;
}

/**
 * Does one quest match `query`? Three fields: display title, quest id, questline title. This is
 * the ONE definition of a text hit that the app uses - it drives the search facet inside
 * questMatchesFilter, and everything downstream (the map's highlighting, the facet counts, the
 * ↑/↓ stepper) reads that one match set rather than re-deciding for itself.
 *
 * Note the blank-query result is the OPPOSITE of matchQuestNodes': blank here means "no
 * constraint" (every quest passes), because this drives a filter facet rather than a hit list.
 */
export function questMatchesQuery(quest: Quest, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return (
    quest.title.toLowerCase().includes(needle) ||
    quest.m_questName.toLowerCase().includes(needle) ||
    (quest.questlineTitle?.toLowerCase().includes(needle) ?? false)
  );
}
