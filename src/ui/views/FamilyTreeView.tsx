import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSaveStore } from '../../state/saveStore.ts';
import { useSectionNavigate } from '../routing/useSectionNavigate.ts';
import { useGameData } from '../hooks/useGameData.ts';
import { useVisualAssets } from '../hooks/useVisualAssets.ts';
import {
  selectBloodline,
  selectFamilyForest,
  selectFamilyStats,
  type StatGroupKey,
} from '../../domain/selectors/familyGraphSelectors.ts';
import { edgeOnBloodline, layoutForest, NODE_H, NODE_W } from '../lib/familyTreeLayout.ts';
import { FamilyTreeNode } from '../components/family/FamilyTreeNode.tsx';
import { FamilyStatsBar } from '../components/family/FamilyStatsBar.tsx';

// Family Tree tab. A single pan/zoom canvas showing every family in
// the vault as a traditional top-down genealogy chart: generations in rows, children below
// their parents. Layout is our own pure layered algorithm (familyTreeLayout) - O(V+E), it
// never hangs and places every dweller even in heavily inter-bred vaults. We render portrait
// nodes + identity-tagged SVG edges so a selected dweller's bloodline lights up while the
// rest dims.
//
// Pan/zoom is driven imperatively through refs (transform written straight to the DOM) so
// dragging never re-renders the node tree and we avoid setState-in-effect (React Compiler
// lint). Selection/highlight flows through the URL (#/family/:id, read via useParams), so a
// selected bloodline is deep-linkable and the Dwellers sheet's "View in family tree" lands
// here already focused by navigating to that dweller's id.

const MIN_SCALE = 0.1;
const MAX_SCALE = 2.5;

export function FamilyTreeView() {
  const save = useSaveStore((s) => s.save);
  const { data: gameData, status: gameDataStatus } = useGameData();
  const { assets } = useVisualAssets();
  // Selection lives in the URL (#/family/:id) - shared by deep-link from the Dwellers sheet's
  // "View in family tree", and deep-linkable on its own.
  const { detail } = useParams();
  const goTo = useSectionNavigate();
  const selectedDwellerId = detail != null && /^\d+$/.test(detail) ? Number(detail) : null;
  const selectDweller = useCallback((id: number | null) => goTo('family', id), [goTo]);

  const forest = useMemo(
    () => (save && gameData ? selectFamilyForest(save, gameData.uniqueDwellers) : null),
    [save, gameData],
  );
  const layout = useMemo(() => (forest ? layoutForest(forest) : null), [forest]);
  const stats = useMemo(() => (forest ? selectFamilyStats(forest) : null), [forest]);

  // The selected dweller as a graph node (only vault members are nodes), and its bloodline.
  const selectedNodeId =
    selectedDwellerId != null && forest?.meta.has(String(selectedDwellerId))
      ? String(selectedDwellerId)
      : null;
  const bloodline = useMemo(
    () => (forest && selectedNodeId ? selectBloodline(forest, selectedNodeId) : null),
    [forest, selectedNodeId],
  );

  // A clicked stat chip highlights the exact dwellers it counts. Mutually exclusive with a
  // bloodline selection. The two highlight modes feed one `highlight` set used by rendering.
  const [activeStat, setActiveStat] = useState<StatGroupKey | null>(null);
  const statSet = useMemo(
    () => (activeStat && stats ? new Set(stats.groups[activeStat]) : null),
    [activeStat, stats],
  );
  const bloodlineActive = !!selectedNodeId && !!bloodline;
  const highlight = bloodlineActive ? bloodline : statSet;

  const viewportRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const view = useRef({ scale: 1, tx: 0, ty: 0 });

  const applyTransform = useCallback(() => {
    const el = innerRef.current;
    if (el)
      el.style.transform = `translate(${view.current.tx}px, ${view.current.ty}px) scale(${view.current.scale})`;
  }, []);

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !layout || layout.width === 0 || layout.height === 0) return;
    const pad = 80;
    const scale = Math.min(
      MAX_SCALE,
      Math.max(
        MIN_SCALE,
        Math.min((vp.clientWidth - pad) / layout.width, (vp.clientHeight - pad) / layout.height),
      ),
    );
    view.current.scale = scale;
    view.current.tx = (vp.clientWidth - layout.width * scale) / 2;
    view.current.ty = (vp.clientHeight - layout.height * scale) / 2;
    applyTransform();
  }, [layout, applyTransform]);

  const zoomBy = useCallback(
    (factor: number) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const { scale, tx, ty } = view.current;
      const mx = vp.clientWidth / 2;
      const my = vp.clientHeight / 2;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
      view.current.tx = mx - ((mx - tx) / scale) * next;
      view.current.ty = my - ((my - ty) / scale) * next;
      view.current.scale = next;
      applyTransform();
    },
    [applyTransform],
  );

  // Initial framing + re-frame when the selection or the laid-out forest changes. Mutates
  // the DOM transform via refs only (no setState), so it's allowed inside an effect.
  const positionsById = useMemo(() => {
    const map = new Map<string, { cx: number; cy: number }>();
    if (layout) for (const n of layout.nodes) map.set(n.id, { cx: n.cx, cy: n.cy });
    return map;
  }, [layout]);

  // Frame the viewport on a set of nodes (their bounding box). Used to zoom to a clicked
  // stat's dwellers. Mutates the transform via refs only.
  const fitToIds = useCallback(
    (ids: ReadonlySet<string>) => {
      const vp = viewportRef.current;
      if (!vp || ids.size === 0) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const id of ids) {
        const p = positionsById.get(id);
        if (!p) continue;
        minX = Math.min(minX, p.cx);
        minY = Math.min(minY, p.cy);
        maxX = Math.max(maxX, p.cx);
        maxY = Math.max(maxY, p.cy);
      }
      if (minX === Infinity) return;
      minX -= NODE_W;
      maxX += NODE_W;
      minY -= NODE_H;
      maxY += NODE_H;
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const scale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, Math.min(vp.clientWidth / w, vp.clientHeight / h)),
      );
      view.current.scale = scale;
      view.current.tx = vp.clientWidth / 2 - ((minX + maxX) / 2) * scale;
      view.current.ty = vp.clientHeight / 2 - ((minY + maxY) / 2) * scale;
      applyTransform();
    },
    [positionsById, applyTransform],
  );

  // Toggle a stat highlight; selecting a stat clears any bloodline selection (and vice versa).
  const toggleStat = useCallback(
    (key: StatGroupKey) => {
      selectDweller(null);
      setActiveStat((cur) => (cur === key ? null : key));
    },
    [selectDweller],
  );

  // Zoom-to-fit a selected dweller's whole bloodline; otherwise fit the entire forest, but
  // only on first mount - clearing a selection should not yank the view back to "fit".
  const didFit = useRef(false);
  useEffect(() => {
    if (!layout) return;
    if (selectedNodeId && bloodline && bloodline.size) {
      fitToIds(bloodline);
      didFit.current = true;
    } else if (!didFit.current) {
      fit();
      didFit.current = true;
    }
  }, [layout, selectedNodeId, bloodline, fitToIds, fit]);

  // Zoom-to-fit a clicked stat's dwellers so the whole highlighted set is in view.
  useEffect(() => {
    if (statSet && statSet.size) fitToIds(statSet);
  }, [statSet, fitToIds]);

  // Non-passive wheel listener so we can preventDefault and zoom around the cursor.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { scale, tx, ty } = view.current;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (e.deltaY < 0 ? 1.1 : 0.9)));
      view.current.tx = mx - ((mx - tx) / scale) * next;
      view.current.ty = my - ((my - ty) / scale) * next;
      view.current.scale = next;
      applyTransform();
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [applyTransform]);

  // Drag-to-pan via pointer events (refs only - no re-render while dragging). A pointer
  // down/up on the background WITHOUT a drag is treated as a click that clears the current
  // bloodline selection (nodes stopPropagation their own pointerdown, so this only fires on
  // empty canvas). `moved` distinguishes a pan from a plain click.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
    view.current.tx += dx;
    view.current.ty += dy;
    drag.current = { x: e.clientX, y: e.clientY, moved: drag.current.moved };
    applyTransform();
  };
  const endDrag = (e: React.PointerEvent) => {
    const wasClick = drag.current != null && !drag.current.moved;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (wasClick && (selectedNodeId || activeStat)) {
      selectDweller(null);
      setActiveStat(null);
    }
  };

  if (!gameData || !forest || !layout) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400">
        {gameDataStatus === 'error' ? 'Game data unavailable.' : 'Loading family tree…'}
      </div>
    );
  }

  const hasFamilies = layout.nodes.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 p-3">
        <h2 className="text-lg font-semibold">Family Tree</h2>
        <span className="text-sm text-neutral-400">
          {forest.components.length} {forest.components.length === 1 ? 'family' : 'families'} ·{' '}
          {layout.nodes.length} members
        </span>
        {(selectedNodeId || activeStat) && (
          <span className="rounded-full border border-amber-500/60 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-300">
            {selectedNodeId
              ? `Highlighting ${forest.meta.get(selectedNodeId)?.name}'s bloodline`
              : `Highlighting ${statSet?.size ?? 0} dweller(s)`}
            <button
              type="button"
              onClick={() => {
                selectDweller(null);
                setActiveStat(null);
              }}
              className="ml-2 text-amber-400/80 hover:text-amber-200"
              aria-label="Clear highlight"
            >
              ✕
            </button>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.2)}
            className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1.2)}
            className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={fit}
            className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
          >
            Fit
          </button>
        </div>
      </div>

      {stats && hasFamilies && (
        <FamilyStatsBar stats={stats} activeStat={activeStat} onToggleStat={toggleStat} />
      )}

      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-neutral-950 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {!hasFamilies ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400">
            No dwellers to show.
          </div>
        ) : (
          <div
            ref={innerRef}
            className="absolute left-0 top-0 origin-top-left will-change-transform"
            style={{ width: layout.width, height: layout.height }}
          >
            <svg
              width={layout.width}
              height={layout.height}
              className="pointer-events-none absolute inset-0"
              aria-hidden="true"
            >
              {layout.edges.map((edge) => {
                const hot = highlight
                  ? bloodlineActive
                    ? edgeOnBloodline(edge, highlight)
                    : edge.nodeIds.every((id) => highlight.has(id))
                  : false;
                const dim = highlight != null && !hot;
                return (
                  <path
                    key={edge.id}
                    d={edge.d}
                    fill="none"
                    stroke={hot ? '#fbbf24' : '#525252'}
                    strokeWidth={hot ? 3 : 1.5}
                    strokeOpacity={dim ? 0.25 : 1}
                  />
                );
              })}
            </svg>
            {layout.nodes.map((node) => (
              <FamilyTreeNode
                key={node.id}
                node={node}
                assets={assets}
                selected={
                  bloodlineActive
                    ? node.id === selectedNodeId
                    : !!highlight && highlight.has(node.id)
                }
                dimmed={highlight != null && !highlight.has(node.id)}
                onSelect={(id) => {
                  setActiveStat(null);
                  selectDweller(id);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
