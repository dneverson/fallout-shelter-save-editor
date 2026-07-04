import type { Dweller, SaveData } from '../model/saveSchema.ts';
import type { UniqueDwellers } from '../gamedata/schemas.ts';
import { ascendancyId } from './familySelectors.ts';

// Plain graph shapes for the family forest. The pixel layout (ui/lib/familyTreeLayout.ts)
// consumes these directly; `type` is kept (blood/married/half/…) for edge styling and
// possible future use even though the layered layout only needs parents/children/spouses.
export type FamilyRelType = 'blood' | 'married' | 'divorced' | 'adopted' | 'half';
export interface FamilyRelation {
  id: string;
  type: FamilyRelType;
}
export interface FamilyGraphNode {
  id: string;
  gender: 'male' | 'female';
  parents: FamilyRelation[];
  children: FamilyRelation[];
  siblings: FamilyRelation[];
  spouses: FamilyRelation[];
}

// Family-FOREST builder for the Family Tree tab. Where
// familySelectors.ts resolves ONE dweller's immediate relatives for the character sheet,
// this projects the WHOLE save into a reciprocal relationship graph, splits it into
// connected family components (a vault usually holds several unrelated bloodlines), and
// exposes a per-node bloodline walk for the "highlight this dweller's lineage" view. The
// pixel layout (ui/lib/familyTreeLayout.ts) turns it into positions.
//
// Every edge is mirrored (parent↔child, spouse↔spouse, sibling↔sibling). Parent/child
// cycles are broken and incestuous marriages dropped so the descent graph is a clean DAG.
//
// Relationships use AscendancyIDs exactly like familySelectors: a normal dweller's
// AscendancyID == its serializeId; a unique/special dweller's == a negative per-character
// id resolved through the extracted unique-dwellers catalog. Special ancestors who are
// referenced but ABSENT from the vault still become (flagged) nodes so a lineage can show
// its descent from a named founder.

/** Per-node display/metadata the renderer needs (kept beside the bare graph nodes). */
export interface FamilyNodeMeta {
  /** Graph node id: a vault dweller's serializeId as a string, or `u:<ascId>` if absent. */
  id: string;
  /** serializeId when this node is a dweller currently in the vault, else null. */
  serializeId: number | null;
  name: string;
  /** 'male' | 'female' (save gender 2 = male, 1 = female). */
  gender: 'male' | 'female';
  /** A known unique/special character. */
  special: boolean;
  /** Referenced ancestor not present in this vault (a named placeholder only). */
  absent: boolean;
}

/** One connected family: the nodes that form it plus the root to lay it out from. */
export interface FamilyComponent {
  rootId: string;
  nodeIds: string[];
}

export interface FamilyForest {
  /** Relationship graph nodes for the whole save (all components). */
  nodes: FamilyGraphNode[];
  nodesById: Map<string, FamilyGraphNode>;
  meta: Map<string, FamilyNodeMeta>;
  /** Connected families, largest first, each ready to feed to calcTree with its rootId. */
  components: FamilyComponent[];
}

const dwellersOf = (save: SaveData): Dweller[] => save.dwellers?.dwellers ?? [];

const displayName = (d: Dweller): string =>
  `${d.name ?? ''} ${d.lastName ?? ''}`.trim() || `#${d.serializeId}`;

const genderOf = (g: number | undefined): 'male' | 'female' => (g === 2 ? 'male' : 'female');

const absentId = (ascId: number): string => `u:${ascId}`;

/** Mutable working node (the public FamilyGraphNode is the same shape). */
type WorkNode = FamilyGraphNode;

/** Push a relation once (no duplicate ids within a relation array). */
function addRel(list: FamilyRelation[], id: string, type: FamilyRelType): void {
  if (!list.some((r) => r.id === id)) list.push({ id, type });
}

/** Minimal union-find for grouping the graph into connected families. */
class DisjointSet {
  private parent = new Map<string, string>();
  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }
  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression.
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Build the whole-save family forest. Pure and read-only. Returns the relationship
 * graph, per-node metadata, and the connected components (each with a chosen root).
 */
export function selectFamilyForest(save: SaveData, unique: UniqueDwellers): FamilyForest {
  const dwellers = dwellersOf(save);

  // AscendancyID → dweller (for resolving ascendant references to vault members).
  const byAscendancy = new Map<number, Dweller>();
  for (const d of dwellers) byAscendancy.set(ascendancyId(d, unique), d);

  // AscendancyID → catalog entry (to name/gender special ancestors absent from the vault).
  const uniqueByAsc = new Map<number, { name: string; gender: number }>();
  for (const entry of Object.values(unique)) {
    if (entry.ascendancyId === -1) continue;
    if (!uniqueByAsc.has(entry.ascendancyId)) {
      uniqueByAsc.set(entry.ascendancyId, {
        name: `${entry.name} ${entry.lastName}`.trim(),
        gender: entry.gender,
      });
    }
  }

  const work = new Map<string, WorkNode>();
  const meta = new Map<string, FamilyNodeMeta>();

  // Every vault dweller becomes a node up front.
  for (const d of dwellers) {
    const id = String(d.serializeId);
    work.set(id, {
      id,
      gender: genderOf(d.gender),
      parents: [],
      children: [],
      siblings: [],
      spouses: [],
    });
    meta.set(id, {
      id,
      serializeId: d.serializeId,
      name: displayName(d),
      gender: genderOf(d.gender),
      special: !!d.uniqueData,
      absent: false,
    });
  }

  // Lazily create a placeholder node for a referenced-but-absent special ancestor.
  const ensureAbsent = (ascId: number): string | null => {
    const cat = uniqueByAsc.get(ascId);
    if (!cat) return null; // unknown / unnamed → cannot place a node
    const id = absentId(ascId);
    if (!work.has(id)) {
      work.set(id, {
        id,
        gender: genderOf(cat.gender),
        parents: [],
        children: [],
        siblings: [],
        spouses: [],
      });
      meta.set(id, {
        id,
        serializeId: null,
        name: cat.name || 'Unknown',
        gender: genderOf(cat.gender),
        special: true,
        absent: true,
      });
    }
    return id;
  };

  // Resolve one ascendant value (an AscendancyID) to a node id, or null if unplaceable.
  const resolveAscendant = (value: number | undefined): string | null => {
    if (typeof value !== 'number' || value === -1) return null;
    const inVault = byAscendancy.get(value);
    if (inVault) return String(inVault.serializeId);
    if (value < 0) return ensureAbsent(value);
    return null; // a positive id not in the vault → an unknown we can't name
  };

  const linkSpouses = (a: string, b: string): void => {
    if (a === b) return;
    addRel(work.get(a)!.spouses, b, 'married');
    addRel(work.get(b)!.spouses, a, 'married');
  };

  // Parent/child + spouse edges.
  for (const d of dwellers) {
    const childId = String(d.serializeId);
    const childNode = work.get(childId)!;
    const ascendants = d.relations?.ascendants ?? [];

    const parentIds: string[] = [];
    for (const slot of [0, 1] as const) {
      const parentId = resolveAscendant(ascendants[slot]);
      if (!parentId || parentId === childId) continue;
      addRel(childNode.parents, parentId, 'blood');
      addRel(work.get(parentId)!.children, childId, 'blood');
      parentIds.push(parentId);
    }
    // Co-parents form a couple. The save only records ONE current `partner`, so without
    // this a parent's children by an earlier/other partner - and that partner - would be
    // dropped by calcTree (it lays out children only under recognised couples). Deriving
    // the spouse link from shared children is what makes MULTIPLE PARTNERS work.
    if (parentIds.length === 2) linkSpouses(parentIds[0], parentIds[1]);

    const partnerId = d.relations?.partner ?? -1;
    if (partnerId >= 0) {
      const spouseId = String(partnerId);
      if (work.has(spouseId)) linkSpouses(childId, spouseId);
    }
  }

  // Break any parent/child cycles so the descent graph is a DAG - a corrupt or hand-edited
  // save can record a dweller as its own (grand)ancestor, which would otherwise give a node
  // an undefined generation. A DFS removes the back-edges.
  breakParentCycles(work);

  // Drop spouse links between blood relatives (real heavy-breeding/edited vaults marry
  // dwellers to their own ancestors/descendants). They stay connected by blood; we just
  // avoid drawing a marriage line spanning their own bloodline.
  removeIncestSpouses(work);

  // Siblings: any two nodes that share at least one parent. Full siblings (identical parent
  // set) are 'blood'; sharing only one parent makes them 'half' (for edge styling).
  const parentKey = (n: WorkNode): string =>
    n.parents
      .map((p) => p.id)
      .sort()
      .join(',');
  const withParents = [...work.values()].filter((n) => n.parents.length > 0);
  for (let i = 0; i < withParents.length; i++) {
    for (let j = i + 1; j < withParents.length; j++) {
      const a = withParents[i];
      const b = withParents[j];
      const aSet = new Set(a.parents.map((p) => p.id));
      const shared = b.parents.filter((p) => aSet.has(p.id)).length;
      if (shared === 0) continue;
      const type: FamilyRelType = parentKey(a) === parentKey(b) ? 'blood' : 'half';
      addRel(a.siblings, b.id, type);
      addRel(b.siblings, a.id, type);
    }
  }

  // Connected components over every edge type.
  const ds = new DisjointSet();
  for (const n of work.values()) {
    ds.add(n.id);
    for (const rel of [...n.parents, ...n.children, ...n.spouses, ...n.siblings]) {
      ds.add(rel.id);
      ds.union(n.id, rel.id);
    }
  }
  const groups = new Map<string, string[]>();
  for (const n of work.values()) {
    const root = ds.find(n.id);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(n.id);
  }

  const components: FamilyComponent[] = [...groups.values()]
    .map((nodeIds) => ({ rootId: pickRoot(nodeIds, work), nodeIds }))
    .sort((a, b) => b.nodeIds.length - a.nodeIds.length || a.rootId.localeCompare(b.rootId));

  const nodes: FamilyGraphNode[] = [...work.values()];
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  return { nodes, nodesById, meta, components };
}

/**
 * Remove parent→child back-edges (an iterative DFS) so the descent graph is a DAG. Without
 * this, a save where someone is their own ancestor would leave a node with no valid
 * generation. Each removed edge is dropped from BOTH the parent's children and the child's
 * parents lists.
 */
function breakParentCycles(work: Map<string, WorkNode>): void {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of work.keys()) color.set(id, WHITE);

  const removeEdge = (parentId: string, childId: string): void => {
    const p = work.get(parentId)!;
    const c = work.get(childId)!;
    p.children = p.children.filter((r) => r.id !== childId);
    c.parents = c.parents.filter((r) => r.id !== parentId);
  };

  // Iterative DFS with an explicit stack to avoid deep recursion on long lineages.
  for (const start of work.keys()) {
    if (color.get(start) !== WHITE) continue;
    const stack: Array<{ id: string; i: number }> = [{ id: start, i: 0 }];
    color.set(start, GRAY);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const node = work.get(frame.id)!;
      if (frame.i >= node.children.length) {
        color.set(frame.id, BLACK);
        stack.pop();
        continue;
      }
      const childId = node.children[frame.i].id;
      const c = color.get(childId);
      if (c === GRAY) {
        // Back-edge → would close a cycle. removeEdge shrinks node.children at frame.i,
        // so DON'T advance: the next element shifts into this index.
        removeEdge(frame.id, childId);
      } else if (c === WHITE) {
        frame.i++;
        color.set(childId, GRAY);
        stack.push({ id: childId, i: 0 });
      } else {
        frame.i++; // BLACK: already fully explored, skip
      }
    }
  }
}

/** True if `target` is reachable from `from` by descending child edges (a blood descendant). */
function isDescendant(from: string, target: string, work: Map<string, WorkNode>): boolean {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of work.get(cur)!.children) {
      if (c.id === target) return true;
      if (!seen.has(c.id)) {
        seen.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return false;
}

/**
 * Remove spouse edges between blood relatives (one is the other's ancestor or descendant)
 * so we never draw a marriage line spanning a node's own bloodline; the pair stays
 * connected through their blood edges. Run AFTER breakParentCycles so descent is a DAG.
 */
function removeIncestSpouses(work: Map<string, WorkNode>): void {
  for (const node of work.values()) {
    for (const sp of [...node.spouses]) {
      if (node.id >= sp.id) continue; // handle each pair once
      const related = isDescendant(node.id, sp.id, work) || isDescendant(sp.id, node.id, work);
      if (!related) continue;
      node.spouses = node.spouses.filter((r) => r.id !== sp.id);
      const other = work.get(sp.id)!;
      other.spouses = other.spouses.filter((r) => r.id !== node.id);
    }
  }
}

/**
 * Choose a layout root for a component: the topmost ancestor (a node with no parents) that
 * reaches the most descendants, so generations flow downward from it. Falls back to the
 * lowest id when every node has a parent (a cycle - shouldn't occur in real saves).
 */
function pickRoot(nodeIds: string[], work: Map<string, WorkNode>): string {
  const inComponent = new Set(nodeIds);
  const roots = nodeIds.filter((id) => work.get(id)!.parents.length === 0);
  const candidates = roots.length > 0 ? roots : nodeIds;

  let best = candidates[0];
  let bestReach = -1;
  for (const id of candidates) {
    const reach = countDescendants(id, work, inComponent);
    if (reach > bestReach || (reach === bestReach && id < best)) {
      best = id;
      bestReach = reach;
    }
  }
  return best;
}

/** Number of distinct descendants reachable from `id` via child edges (within component). */
function countDescendants(
  id: string,
  work: Map<string, WorkNode>,
  inComponent: Set<string>,
): number {
  const seen = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of work.get(cur)!.children) {
      if (inComponent.has(c.id) && !seen.has(c.id)) {
        seen.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return seen.size - 1;
}

/**
 * The bloodline of a node: itself, every ancestor (up via parents), every descendant
 * (down via children), and its direct spouses (so the couple lights up together). Used to
 * highlight a selected dweller's lineage and dim everyone else.
 */
export function selectBloodline(forest: FamilyForest, id: string): Set<string> {
  const result = new Set<string>();
  const node = forest.nodesById.get(id);
  if (!node) return result;
  result.add(id);

  const walk = (startIds: string[], dir: 'parents' | 'children'): void => {
    const stack = [...startIds];
    while (stack.length) {
      const cur = stack.pop()!;
      if (result.has(cur)) continue;
      result.add(cur);
      const n = forest.nodesById.get(cur);
      if (n) for (const rel of n[dir]) stack.push(rel.id);
    }
  };
  walk(
    node.parents.map((r) => r.id),
    'parents',
  );
  walk(
    node.children.map((r) => r.id),
    'children',
  );
  for (const s of node.spouses) result.add(s.id);
  return result;
}

// --- Vault genetics stat block (just for fun) ---------------------------------

export interface FamilyStatus {
  /** Headline label, e.g. "Massively Inbred". */
  label: string;
  emoji: string;
  /** One-line flavour text. */
  blurb: string;
  /** Severity for colour: 0 = pristine … 5 = cursed. */
  level: 0 | 1 | 2 | 3 | 4 | 5;
}

/** Stats that map to a concrete, highlightable set of dwellers in the tree. */
export type StatGroupKey =
  | 'familyGroups'
  | 'loneWolves'
  | 'largestFamily'
  | 'couples'
  | 'founders'
  | 'specials'
  | 'inbredUnions';

export interface FamilyStats {
  /** Vault dwellers in the tree (excludes absent named-only ancestors). */
  dwellers: number;
  /** Connected families with more than one member. */
  familyGroups: number;
  /** Single, unconnected dwellers. */
  loneWolves: number;
  /** Size of the biggest connected family. */
  largestFamily: number;
  /** Deepest generation count in any family. */
  generations: number;
  /** Distinct married/co-parenting couples. */
  couples: number;
  /** Dwellers with no recorded parents (the vault's founders). */
  founders: number;
  /** Special/unique characters present in the vault. */
  specials: number;
  /** Children whose two parents share a common ancestor (the spicy one). */
  inbredUnions: number;
  /** Children with two known parents (denominator for the inbreeding ratio). */
  twoParentChildren: number;
  status: FamilyStatus;
  /** Node ids each highlightable stat refers to (for click-to-highlight in the tree). */
  groups: Record<StatGroupKey, string[]>;
}

/** Ancestor set of a node (memoised). The graph is a DAG here, so this terminates. */
function ancestorsOf(
  id: string,
  nodesById: Map<string, FamilyGraphNode>,
  memo: Map<string, Set<string>>,
): Set<string> {
  const cached = memo.get(id);
  if (cached) return cached;
  const set = new Set<string>();
  memo.set(id, set); // set first to be safe against any residual cycle
  const node = nodesById.get(id);
  if (node) {
    for (const p of node.parents) {
      set.add(p.id);
      for (const a of ancestorsOf(p.id, nodesById, memo)) set.add(a);
    }
  }
  return set;
}

/** Pick the funny status from the inbreeding ratio and how dominant the biggest family is. */
function statusFor(ratio: number, largestFraction: number): FamilyStatus {
  if (ratio <= 0) {
    return largestFraction > 0.6
      ? {
          label: 'One Big Happy Family',
          emoji: '👪',
          blurb: "Everyone's related, but it's all strictly above board.",
          level: 1,
        }
      : {
          label: 'Pristine Bloodlines',
          emoji: '🧬',
          blurb: 'Textbook genetic diversity. The Overseer would be proud.',
          level: 0,
        };
  }
  if (ratio <= 0.1)
    return {
      label: 'Tight-Knit',
      emoji: '🤝',
      blurb: 'A close community. Mostly the wholesome kind of close.',
      level: 1,
    };
  if (ratio <= 0.25)
    return {
      label: 'Suspiciously Cozy',
      emoji: '👀',
      blurb: 'A few branches crossed that probably should have stayed apart.',
      level: 2,
    };
  if (ratio <= 0.5)
    return {
      label: 'Tangled Roots',
      emoji: '🌳',
      blurb: 'This family tree is starting to look more like a family wreath.',
      level: 3,
    };
  if (ratio <= 0.75)
    return {
      label: 'Massively Inbred',
      emoji: '🪕',
      blurb: 'In this vault, cousins are just future spouses.',
      level: 4,
    };
  return {
    label: 'One Cursed Bloodline',
    emoji: '💀',
    blurb: 'There is, genetically speaking, only one family. Pray for them.',
    level: 5,
  };
}

/** Compute the (fun) vault-genetics stat block from a built family forest. Pure. */
export function selectFamilyStats(forest: FamilyForest): FamilyStats {
  const vault = forest.nodes.filter((n) => {
    const m = forest.meta.get(n.id);
    return m && !m.absent;
  });
  const vaultIds = new Set(vault.map((n) => n.id));

  const dwellers = vault.length;

  // Per-component vault members, so each stat can name the exact dwellers it counts.
  const compMembers = forest.components.map((c) => c.nodeIds.filter((id) => vaultIds.has(id)));
  const sizes = compMembers.map((m) => m.length);
  const familyGroups = sizes.filter((s) => s > 1).length;
  const loneWolves = sizes.filter((s) => s === 1).length;
  const largestFamily = sizes.length ? Math.max(...sizes) : 0;

  const familyGroupIds = compMembers.filter((m) => m.length > 1).flat();
  const loneWolfIds = compMembers.filter((m) => m.length === 1).flat();
  const largestIdx = sizes.indexOf(largestFamily);
  const largestFamilyIds = largestIdx >= 0 ? compMembers[largestIdx] : [];

  const coupleIds: string[] = [];
  const founderIds: string[] = [];
  const specialIds: string[] = [];
  let couples = 0;
  for (const n of vault) {
    couples += n.spouses.filter((s) => n.id < s.id).length; // each pair once
    if (n.spouses.length > 0) coupleIds.push(n.id);
    if (n.parents.length === 0) founderIds.push(n.id);
    if (forest.meta.get(n.id)?.special) specialIds.push(n.id);
  }
  const founders = founderIds.length;
  const specials = specialIds.length;

  // Generations: deepest longest-path from a parentless ancestor, across the whole forest.
  const genMemo = new Map<string, number>();
  const genOf = (id: string, stack: Set<string>): number => {
    const cached = genMemo.get(id);
    if (cached !== undefined) return cached;
    if (stack.has(id)) return 0;
    stack.add(id);
    const ps = forest.nodesById.get(id)?.parents ?? [];
    const g = ps.length ? Math.max(...ps.map((p) => genOf(p.id, stack) + 1)) : 0;
    stack.delete(id);
    genMemo.set(id, g);
    return g;
  };
  let maxGen = 0;
  for (const n of vault) maxGen = Math.max(maxGen, genOf(n.id, new Set()));
  const generations = dwellers ? maxGen + 1 : 0;

  // Inbreeding: a child whose two parents share a common ancestor (incl. one being the
  // other's ancestor - we add each parent to its own ancestor set for that check).
  const ancMemo = new Map<string, Set<string>>();
  const inbredIds: string[] = [];
  let twoParentChildren = 0;
  for (const n of vault) {
    const parents = n.parents.map((p) => p.id);
    if (parents.length < 2) continue;
    twoParentChildren++;
    let related = false;
    for (let i = 0; i < parents.length && !related; i++) {
      for (let j = i + 1; j < parents.length && !related; j++) {
        const a = new Set([parents[i], ...ancestorsOf(parents[i], forest.nodesById, ancMemo)]);
        const b = new Set([parents[j], ...ancestorsOf(parents[j], forest.nodesById, ancMemo)]);
        for (const x of a) {
          if (b.has(x)) {
            related = true;
            break;
          }
        }
      }
    }
    if (related) inbredIds.push(n.id);
  }
  const inbredUnions = inbredIds.length;

  const ratio = twoParentChildren ? inbredUnions / twoParentChildren : 0;
  const largestFraction = dwellers ? largestFamily / dwellers : 0;

  return {
    dwellers,
    familyGroups,
    loneWolves,
    largestFamily,
    generations,
    couples,
    founders,
    specials,
    inbredUnions,
    twoParentChildren,
    status: statusFor(ratio, largestFraction),
    groups: {
      familyGroups: familyGroupIds,
      loneWolves: loneWolfIds,
      largestFamily: largestFamilyIds,
      couples: coupleIds,
      founders: founderIds,
      specials: specialIds,
      inbredUnions: inbredIds,
    },
  };
}
