import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { pushToast } from '../../../state/toastStore.ts';
import type { JsonNode, JsonValueType } from './jsonTreeModel.ts';

// VSCode-style explorer for the Advanced raw editor. Renders the parsed
// save as a collapsible, VIRTUALIZED tree so it stays smooth on large saves, and lets a
// user FIND their location: search matches keys or leaf values, with prev/next navigation
// that auto-expands ancestors, scrolls the row into view, and reveals the matching span in
// the editor. Clicking any node highlights + scrolls to it WITHOUT focusing the editor (so a
// click never leaves an editable selection); each row can copy its JSONPath.

const ROW_HEIGHT = 22;

/** Per-type color for the value preview, matching the editor's syntax palette. */
const TYPE_CLASS: Record<JsonValueType, string> = {
  object: 'text-neutral-500',
  array: 'text-neutral-500',
  string: 'text-green-300',
  number: 'text-amber-300',
  boolean: 'text-violet-300',
  null: 'text-violet-300',
};

interface NodeIndex {
  byId: Map<string, JsonNode>;
  parentOf: Map<string, string | null>;
}

/** Flatten the whole tree into id→node and id→parentId maps (for ancestor expansion). */
function indexTree(root: JsonNode): NodeIndex {
  const byId = new Map<string, JsonNode>();
  const parentOf = new Map<string, string | null>();
  const visit = (n: JsonNode, parent: string | null): void => {
    byId.set(n.id, n);
    parentOf.set(n.id, parent);
    for (const c of n.children) visit(c, n.id);
  };
  visit(root, null);
  return { byId, parentOf };
}

/** Depth-first list of visible nodes: a node's children show only when it is expanded. */
function flatten(root: JsonNode, expanded: ReadonlySet<string>): JsonNode[] {
  const out: JsonNode[] = [];
  const visit = (n: JsonNode): void => {
    out.push(n);
    if (n.children.length > 0 && expanded.has(n.id)) {
      for (const c of n.children) visit(c);
    }
  };
  visit(root);
  return out;
}

/** Ids of every node whose key or (leaf) value contains the query, in document order. */
function collectMatches(root: JsonNode, query: string): string[] {
  const q = query.toLowerCase();
  const out: string[] = [];
  const visit = (n: JsonNode): void => {
    const keyHit = n.key != null && n.key.toLowerCase().includes(q);
    const valHit = n.children.length === 0 && n.preview.toLowerCase().includes(q);
    if (keyHit || valHit) out.push(n.id);
    for (const c of n.children) visit(c);
  };
  visit(root);
  return out;
}

interface JsonTreeProps {
  tree: JsonNode | null;
  /** Scroll+highlight a span WITHOUT focusing the editor - used by row clicks and search nav. */
  onPeek: (from: number, to: number) => void;
}

export function JsonTree({ tree, onPeek }: JsonTreeProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const index = useMemo(() => (tree ? indexTree(tree) : null), [tree]);
  // Seed expansion with the root ONCE. The tree is rebuilt on every (debounced) edit, but
  // node ids are JSONPaths, so the user's expanded locations stay valid across rebuilds -
  // resetting here would collapse everything on each keystroke. Paths that no longer exist
  // simply stop matching, which is harmless.
  const seededRef = useRef(false);
  useEffect(() => {
    if (tree && !seededRef.current) {
      seededRef.current = true;
      setExpanded(new Set([tree.id]));
    }
  }, [tree]);

  const matches = useMemo(
    () => (tree && query.trim() ? collectMatches(tree, query.trim()) : []),
    [tree, query],
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);

  const rows = useMemo(() => (tree ? flatten(tree, expanded) : []), [tree, expanded]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Row click: highlight + scroll the span WITHOUT focusing the editor, so a click only jumps to
  // the location and never leaves an editable selection that the next keystroke would overwrite.
  // Container rows ALSO toggle open/closed (VSCode-style) - the tiny arrow alone is an
  // impossible touch target on phones.
  const selectNode = (node: JsonNode): void => {
    setSelectedId(node.id);
    onPeek(node.from, node.to);
    if (node.children.length > 0) toggle(node.id);
  };

  // Expand every ancestor of a node and scroll its row into view, then PEEK it in the editor
  // (highlight without focus) - used by the as-you-type search so typing is never interrupted.
  const goToNode = (id: string): void => {
    if (!index) return;
    const node = index.byId.get(id);
    if (!node) return;
    const nextExpanded = new Set(expanded);
    let p = index.parentOf.get(id) ?? null;
    while (p) {
      nextExpanded.add(p);
      p = index.parentOf.get(p) ?? null;
    }
    setExpanded(nextExpanded);
    setSelectedId(id);
    onPeek(node.from, node.to);
    // Row index is computed against the post-expansion list; scroll after the row mounts.
    const visible = tree ? flatten(tree, nextExpanded) : [];
    const rowIdx = visible.findIndex((n) => n.id === id);
    if (rowIdx >= 0) {
      requestAnimationFrame(() => virtualizer.scrollToIndex(rowIdx, { align: 'center' }));
    }
  };

  // On a new search, jump to the first match.
  useEffect(() => {
    if (matches.length > 0) {
      setMatchIndex(0);
      goToNode(matches[0]);
    }
    // Only react to the match SET changing, not to goToNode/expanded identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchSet]);

  const step = (delta: number): void => {
    if (matches.length === 0) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    goToNode(matches[next]);
  };

  const copyPath = (id: string): void => {
    navigator.clipboard?.writeText(id).then(
      () => pushToast('JSONPath copied'),
      () => pushToast('Could not copy path', 'info'),
    );
  };

  if (!tree) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-neutral-500">
        The document is empty or not valid JSON, so there is no tree to show.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-neutral-800 p-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
          }}
          placeholder="Search keys & values…"
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 focus:border-amber-500/60 focus:outline-none"
        />
        {query.trim() && (
          <>
            <span className="shrink-0 tabular-nums text-[11px] text-neutral-400">
              {matches.length === 0 ? '0/0' : `${matchIndex + 1}/${matches.length}`}
            </span>
            <button
              type="button"
              aria-label="Previous match"
              onClick={() => step(-1)}
              disabled={matches.length === 0}
              className="rounded px-1.5 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Next match"
              onClick={() => step(1)}
              disabled={matches.length === 0}
              className="rounded px-1.5 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            >
              ↓
            </button>
          </>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vrow) => {
            const node = rows[vrow.index];
            const isContainer = node.children.length > 0;
            const isOpen = expanded.has(node.id);
            const isMatch = matchSet.has(node.id);
            const isActiveMatch = matches[matchIndex] === node.id;
            const isSelected = selectedId === node.id;
            const label =
              node.index !== null ? `${node.index}` : node.key !== null ? node.key : '$ (root)';
            return (
              <div
                key={node.id}
                data-index={vrow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: ROW_HEIGHT,
                  transform: `translateY(${vrow.start}px)`,
                  paddingLeft: 4 + node.depth * 12,
                }}
                onClick={() => selectNode(node)}
                className={`group flex cursor-pointer items-center gap-1 pr-2 text-xs leading-none ${
                  isSelected
                    ? 'bg-neutral-800'
                    : isActiveMatch
                      ? 'bg-amber-500/20'
                      : isMatch
                        ? 'bg-amber-500/10'
                        : 'hover:bg-neutral-900'
                }`}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden={!isContainer}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isContainer) toggle(node.id);
                  }}
                  className={`w-3 shrink-0 text-neutral-500 ${isContainer ? '' : 'invisible'}`}
                >
                  {isOpen ? '▾' : '▸'}
                </button>
                <span
                  className={`shrink-0 truncate font-medium ${node.index !== null ? 'text-neutral-400' : 'text-sky-300'}`}
                >
                  {label}
                </span>
                <span className="shrink-0 text-neutral-600">:</span>
                <span className={`truncate ${TYPE_CLASS[node.type]}`}>{node.preview}</span>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Copy JSONPath"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyPath(node.id);
                  }}
                  className="ml-auto hidden shrink-0 rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 group-hover:block"
                >
                  path
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
