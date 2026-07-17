import type { Quest, Questline } from '../gamedata/schemas.ts';

// Pure layout for the Quests map (Section 1). Turns the catalog into absolutely-positioned
// nodes + edges for the pannable React Flow canvas. No framework imports here so it stays
// unit-testable in Node.
//
// The map has three stacked regions inside ONE canvas:
//   1. "Story Chains"      - narrative + seasonal questlines (dependency chains, drawn with
//                            edges; cross-lane edges make chain-to-chain links obvious).
//   2. "Standalone Quests" - one-off quests (types 1/2 + seasonal singles), a labelled grid.
//   3. "Repeatable / Daily"- repeatable quests (types 3/4/6), collapsed by title, a grid.
// Difficulty variants are collapsed everywhere: chains collapse in the build (one node per
// step); the flat regions collapse by title here (95 "Game Show Gauntlet" rows -> one node).

// --- geometry -------------------------------------------------------------------------
export const NODE_W = 172;
export const NODE_H = 48;
const COL_W = 208; // x step between dependency columns / grid columns
const ROW_H = 72; // y step between lanes / grid rows
const SECTION_GAP = 140; // vertical gap before each region's first row
const GRID_COLS = 12; // columns in the flat (standalone / repeatable) grids

// --- lane-title column ----------------------------------------------------------------
//
// The label column is sized to the LONGEST lane title so no chain name is ever ellipsized
// ("Horsemen of the Post-Apocalypse Part 3" needs 257px and used to clip at a fixed 236). The
// map is pannable and already far wider than any screen, so reserving the room costs nothing.
//
// The width is ESTIMATED from character count, not measured: this module is pure (no DOM, so no
// measureText). LANE_LABEL_CHAR_PX is an upper bound on the average advance width of the map's
// 14px semibold UI font - the worst lane in the shipped catalog averages 7.87px/char, so 8
// clears every real title. It is a reservation, not a clamp: the label renders `nowrap` and is
// never truncated, so were the estimate ever short the text would spill into the empty margin
// left of the map instead of losing characters.
const LANE_LABEL_CHAR_PX = 8;
const LANE_LABEL_GAP = 24; // breathing room between the label and column 0
const LANE_LABEL_MIN = 160; // keep the column a sane size when every title is short
const LANE_LABEL_STEP = 10; // round the reserved width to a whole step

/** Width to reserve for the lane-title column, rounded up to a whole LANE_LABEL_STEP. */
export function laneLabelWidth(questlines: readonly Questline[]): number {
  let longest = 0;
  for (const ql of questlines) longest = Math.max(longest, ql.title.length);
  const needed = Math.max(LANE_LABEL_MIN, longest * LANE_LABEL_CHAR_PX);
  return Math.ceil(needed / LANE_LABEL_STEP) * LANE_LABEL_STEP;
}

export type QuestMapRegion = 'chain' | 'standalone' | 'repeatable';

export interface QuestMapNode {
  /** React Flow node id (unique across the whole map). */
  id: string;
  /** Every underlying m_questName this node represents (variants collapsed). */
  questNames: string[];
  title: string;
  region: QuestMapRegion;
  /** Owning chain's lane title; chain nodes only (the flat regions have no questline). */
  questlineTitle?: string;
  x: number;
  y: number;
}

export interface QuestMapEdge {
  id: string;
  source: string;
  target: string;
}

/** A left-margin lane title for one chain; carries its quest-names so callers can show done/total. */
export interface QuestMapLaneLabel {
  id: string;
  title: string;
  total: number;
  questNames: string[];
  x: number;
  y: number;
}

export interface QuestMapSection {
  id: string;
  title: string;
  x: number;
  y: number;
}

export interface QuestMapLayout {
  nodes: QuestMapNode[];
  edges: QuestMapEdge[];
  lanes: QuestMapLaneLabel[];
  sections: QuestMapSection[];
  /** Width the lane labels are laid out against; the renderer sizes its label box to it. */
  laneLabelWidth: number;
  bounds: { width: number; height: number };
}

/** Strip a trailing `_Diff_40` / `_Diff40` difficulty suffix (mirrors build-quests baseName). */
export function baseName(name: string): string {
  return name.replace(/_Diff_?\d+$/i, '');
}

/**
 * Longest-path column for every chain node: a root sits at column 0, and every node sits one
 * column right of its furthest dependency. Cross-lane dependencies therefore push a chain's
 * continuation rightward so the connector reads left-to-right. Memoized; cycle-safe (defensive -
 * the data is acyclic).
 */
function computeColumns(nodeById: Map<string, { dependencies: string[] }>): Map<string, number> {
  const col = new Map<string, number>();
  const visiting = new Set<string>();
  const walk = (id: string): number => {
    const cached = col.get(id);
    if (cached !== undefined) return cached;
    const node = nodeById.get(id);
    if (!node || visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const dep of node.dependencies) {
      if (nodeById.has(dep)) best = Math.max(best, walk(dep) + 1);
    }
    visiting.delete(id);
    col.set(id, best);
    return best;
  };
  for (const id of nodeById.keys()) walk(id);
  return col;
}

/**
 * Order lanes so linked lanes cluster together: union-find over cross-lane dependency edges,
 * then emit lanes grouped by component (components ordered by their first lane, lanes kept in
 * their incoming - already title-sorted - order). Keeps chain-to-chain connectors short.
 */
function orderLanes(questlines: Questline[]): Questline[] {
  const laneOf = new Map<string, number>(); // node id -> lane index
  questlines.forEach((ql, i) => ql.nodes.forEach((n) => laneOf.set(n.id, i)));

  const parent = questlines.map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  questlines.forEach((ql, i) =>
    ql.nodes.forEach((n) =>
      n.dependencies.forEach((dep) => {
        const j = laneOf.get(dep);
        if (j !== undefined && j !== i) union(i, j);
      }),
    ),
  );

  const order = questlines.map((_, i) => i);
  order.sort((a, b) => {
    const ra = find(a);
    const rb = find(b);
    return ra !== rb ? ra - rb : a - b; // group by component root, then original (sorted) order
  });
  return order.map((i) => questlines[i]);
}

/** Collapse a set of quests to one node per title (fallback: quest name). */
function collapseByTitle(quests: Quest[]): { title: string; questNames: string[] }[] {
  const byTitle = new Map<string, { title: string; questNames: string[] }>();
  for (const q of quests) {
    const title = q.title || q.m_questName;
    let group = byTitle.get(title);
    if (!group) {
      group = { title, questNames: [] };
      byTitle.set(title, group);
    }
    group.questNames.push(q.m_questName);
  }
  return [...byTitle.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Build the full map layout from the pre-built questline chains and the flat quest list.
 * `quests` is the whole catalog; any quest not part of a chain lands in a flat region by type.
 */
export function buildQuestMapLayout(questlines: Questline[], quests: Quest[]): QuestMapLayout {
  const nodes: QuestMapNode[] = [];
  const edges: QuestMapEdge[] = [];
  const lanes: QuestMapLaneLabel[] = [];
  const sections: QuestMapSection[] = [];

  // Everything left of column 0 hangs off this: the label column grows with the longest chain
  // name, so the map's left margin moves with it rather than clipping the text.
  const labelWidth = laneLabelWidth(questlines);
  const LABEL_X = -(labelWidth + LANE_LABEL_GAP);

  // --- 1. chain region --------------------------------------------------------------
  const nodeById = new Map<string, { dependencies: string[] }>();
  for (const ql of questlines)
    for (const n of ql.nodes) nodeById.set(n.id, { dependencies: n.dependencies });
  const columns = computeColumns(nodeById);
  const orderedLanes = orderLanes(questlines);

  let maxCol = 0;
  orderedLanes.forEach((ql, row) => {
    const y = row * ROW_H;
    lanes.push({
      id: `lane:${ql.title}`,
      title: ql.title,
      total: ql.nodes.length,
      questNames: ql.nodes.flatMap((n) => n.questNames),
      x: LABEL_X,
      y,
    });
    for (const n of ql.nodes) {
      const col = columns.get(n.id) ?? 0;
      maxCol = Math.max(maxCol, col);
      nodes.push({
        id: n.id,
        questNames: n.questNames,
        title: n.title,
        region: 'chain',
        questlineTitle: ql.title,
        x: col * COL_W,
        y,
      });
      for (const dep of n.dependencies) {
        if (nodeById.has(dep)) edges.push({ id: `${dep}->${n.id}`, source: dep, target: n.id });
      }
    }
  });
  const chainHeight = orderedLanes.length * ROW_H;
  const chainWidth = (maxCol + 1) * COL_W;
  if (orderedLanes.length > 0) {
    sections.push({ id: 'sec:chains', title: 'Story Chains', x: LABEL_X, y: -SECTION_GAP / 2 });
  }

  // --- 2 & 3. flat regions ----------------------------------------------------------
  const chainIds = nodeById;
  const isChained = (q: Quest): boolean =>
    chainIds.has(q.m_questName) || chainIds.has(baseName(q.m_questName));

  const standalone: Quest[] = [];
  const repeatable: Quest[] = [];
  for (const q of quests) {
    if (isChained(q)) continue;
    if (q.m_questType === 3 || q.m_questType === 4 || q.m_questType === 6) repeatable.push(q);
    else standalone.push(q); // types 1, 2, and seasonal (5) one-offs
  }

  let cursorY = chainHeight + SECTION_GAP;
  const addGrid = (title: string, region: QuestMapRegion, source: Quest[]): void => {
    const groups = collapseByTitle(source);
    if (groups.length === 0) return;
    sections.push({ id: `sec:${region}`, title, x: LABEL_X, y: cursorY - SECTION_GAP / 2 });
    groups.forEach((g, i) => {
      nodes.push({
        id: `${region}:${g.title}`,
        questNames: g.questNames,
        title: g.title,
        region,
        x: (i % GRID_COLS) * COL_W,
        y: cursorY + Math.floor(i / GRID_COLS) * ROW_H,
      });
    });
    const rows = Math.ceil(groups.length / GRID_COLS);
    cursorY += rows * ROW_H + SECTION_GAP;
  };
  addGrid('Standalone Quests', 'standalone', standalone);
  addGrid('Repeatable / Daily', 'repeatable', repeatable);

  const width = Math.max(chainWidth, GRID_COLS * COL_W) - LABEL_X;
  const height = cursorY;
  return { nodes, edges, lanes, sections, laneLabelWidth: labelWidth, bounds: { width, height } };
}
