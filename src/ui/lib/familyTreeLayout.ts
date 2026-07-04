import type {
  FamilyComponent,
  FamilyForest,
  FamilyGraphNode,
  FamilyNodeMeta,
} from '../../domain/selectors/familyGraphSelectors.ts';

// Pixel-geometry layer for the Family Tree tab. We use our OWN layered (generational)
// layout rather than a library: real Fallout Shelter vaults are heavily inter-bred DAGs
// (most dwellers have two parents, many co-parent with several partners), which clean
// genealogy libraries either drop most of or infinite-loop on. A layered layout is pure,
// O(V+E), never hangs, and places EVERY dweller: row = generation depth, ordered within a
// row by the average position of its parents (a barycenter pass) to reduce edge crossings.
// We then draw identity-tagged SVG edges (parent→child elbows, spouse links) so the view
// can light up a selected dweller's bloodline path.

const COL_W = 120; // horizontal pitch between nodes in a row
const ROW_H = 150; // vertical pitch between generations
const FAMILY_GAP = 100; // blank px between separate families
export const NODE_W = 88;
export const NODE_H = 104;

/** A node placed at a pixel centre (no meta). */
export interface PlacedNode {
  id: string;
  cx: number;
  cy: number;
}

/** A placed node joined with its display metadata, ready to render. */
export interface PositionedNode extends PlacedNode {
  meta: FamilyNodeMeta;
}

export interface TreeEdge {
  id: string;
  kind: 'spouse' | 'descent';
  /** Node ids this edge touches (descent: [childId, ...parentIds]). For highlight tests. */
  nodeIds: string[];
  /** SVG path `d`. */
  d: string;
}

/** Pure pixel geometry (no meta). */
export interface ForestGeometry {
  width: number;
  height: number;
  placed: PlacedNode[];
  edges: TreeEdge[];
}

export interface FamilyLayout {
  width: number;
  height: number;
  nodes: PositionedNode[];
  edges: TreeEdge[];
}

/**
 * Compute pixel geometry for the whole forest: plain placed coordinates + edges. Pure and
 * O(V+E) - it cannot hang, so every dweller is always placed. Families are laid out one
 * after another, left to right.
 */
function computeForestGeometry(
  nodes: FamilyGraphNode[],
  components: FamilyComponent[],
): ForestGeometry {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const placed: PlacedNode[] = [];
  const edges: TreeEdge[] = [];
  let offsetX = 0;
  let maxBottom = 0;

  for (const comp of components) {
    const idSet = new Set(comp.nodeIds.filter((id) => nodeById.has(id)));
    const compNodes = [...idSet].map((id) => nodeById.get(id)!);
    const { pos, width, height } = layoutComponent(compNodes, idSet, offsetX);
    for (const p of pos.values()) placed.push(p);
    edges.push(...buildEdges(compNodes, pos));
    offsetX += width + FAMILY_GAP;
    maxBottom = Math.max(maxBottom, height);
  }

  const width = Math.max(0, offsetX - FAMILY_GAP);
  return { width, height: maxBottom, placed, edges };
}

/**
 * Layered layout of one connected family: generation depth → row, barycenter ordering
 * within a row, even horizontal spacing. Returns absolute pixel centres (shifted by
 * `offsetX`) plus the family's pixel width/height.
 */
function layoutComponent(
  compNodes: FamilyGraphNode[],
  idSet: Set<string>,
  offsetX: number,
): { pos: Map<string, PlacedNode>; width: number; height: number } {
  const byId = new Map(compNodes.map((n) => [n.id, n]));
  const inComp = (id: string): boolean => idSet.has(id);

  // Generation = longest path down from a parentless ancestor (graph is a DAG upstream).
  const gen = new Map<string, number>();
  const genOf = (id: string, stack: Set<string>): number => {
    const cached = gen.get(id);
    if (cached !== undefined) return cached;
    if (stack.has(id)) return 0; // safety net against any residual cycle
    stack.add(id);
    const parents = byId.get(id)!.parents.filter((p) => inComp(p.id));
    const g = parents.length ? Math.max(...parents.map((p) => genOf(p.id, stack) + 1)) : 0;
    stack.delete(id);
    gen.set(id, g);
    return g;
  };
  for (const n of compNodes) genOf(n.id, new Set());

  // Bucket ids by generation (rows), each row in a stable initial order.
  const maxGen = Math.max(0, ...gen.values());
  const rows: string[][] = Array.from({ length: maxGen + 1 }, () => []);
  for (const n of compNodes) rows[gen.get(n.id)!].push(n.id);

  // Order each row by the mean index of its parents in the row above (barycenter) to pull
  // children under their parents and cut edge crossings. Row 0 keeps its stable order.
  for (let g = 1; g <= maxGen; g++) {
    const above = new Map(rows[g - 1].map((id, i) => [id, i]));
    const key = (id: string): number => {
      const ps = byId.get(id)!.parents.filter((p) => above.has(p.id));
      if (!ps.length) return Number.MAX_SAFE_INTEGER; // parentless-in-row → sort to the end
      return ps.reduce((s, p) => s + above.get(p.id)!, 0) / ps.length;
    };
    rows[g] = rows[g]
      .map((id, i) => ({ id, i, k: key(id) }))
      .sort((a, b) => a.k - b.k || a.i - b.i)
      .map((e) => e.id);
  }

  const maxCols = Math.max(1, ...rows.map((r) => r.length));
  const familyWidth = maxCols * COL_W;
  const centerX = offsetX + familyWidth / 2;

  const pos = new Map<string, PlacedNode>();
  for (let g = 0; g <= maxGen; g++) {
    const row = rows[g];
    for (let i = 0; i < row.length; i++) {
      pos.set(row[i], {
        id: row[i],
        cx: centerX + (i - (row.length - 1) / 2) * COL_W,
        cy: g * ROW_H + ROW_H / 2,
      });
    }
  }

  return { pos, width: familyWidth, height: (maxGen + 1) * ROW_H };
}

/** Join geometry with per-node metadata into the renderable layout. */
function attachMeta(geo: ForestGeometry, meta: Map<string, FamilyNodeMeta>): FamilyLayout {
  const nodes: PositionedNode[] = [];
  for (const p of geo.placed) {
    const m = meta.get(p.id);
    if (m) nodes.push({ ...p, meta: m });
  }
  return { width: geo.width, height: geo.height, nodes, edges: geo.edges };
}

/** Convenience sync layout (whole forest). Used by tests; the view uses the worker path. */
export function layoutForest(forest: FamilyForest): FamilyLayout {
  return attachMeta(computeForestGeometry(forest.nodes, forest.components), forest.meta);
}

function buildEdges(compNodes: FamilyGraphNode[], pos: Map<string, PlacedNode>): TreeEdge[] {
  const edges: TreeEdge[] = [];

  for (const node of compNodes) {
    const self = pos.get(node.id);
    if (!self) continue;

    // Spouse links: one horizontal connector per couple (dedupe with id ordering).
    for (const sp of node.spouses) {
      if (node.id >= sp.id) continue;
      const other = pos.get(sp.id);
      if (!other) continue;
      edges.push({
        id: `s:${node.id}-${sp.id}`,
        kind: 'spouse',
        nodeIds: [node.id, sp.id],
        d: `M ${self.cx} ${self.cy} L ${other.cx} ${other.cy}`,
      });
    }

    // Descent: an elbow from the parent couple's midpoint down to this child.
    const parents = node.parents.map((p) => pos.get(p.id)).filter((p): p is PlacedNode => !!p);
    if (parents.length === 0) continue;
    const parentMidX = parents.reduce((sum, p) => sum + p.cx, 0) / parents.length;
    const parentCY = parents[0].cy;
    const busY = (parentCY + self.cy) / 2;
    edges.push({
      id: `d:${node.id}`,
      kind: 'descent',
      nodeIds: [node.id, ...parents.map((p) => p.id)],
      d: `M ${parentMidX} ${parentCY} V ${busY} H ${self.cx} V ${self.cy}`,
    });
  }

  return edges;
}

/** Whether an edge lies on a bloodline (set of highlighted node ids). */
export function edgeOnBloodline(edge: TreeEdge, bloodline: ReadonlySet<string>): boolean {
  if (edge.kind === 'spouse') return edge.nodeIds.every((id) => bloodline.has(id));
  // descent: child + at least one contributing parent on the line.
  const [childId, ...parentIds] = edge.nodeIds;
  return bloodline.has(childId) && parentIds.some((id) => bloodline.has(id));
}
