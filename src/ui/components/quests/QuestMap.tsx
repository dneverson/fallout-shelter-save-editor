import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  NODE_H,
  NODE_W,
  type QuestMapLayout,
  type QuestMapRegion,
} from '../../../domain/quests/questGraphLayout.ts';

// The single pannable/zoomable quest map (Section 1). One React Flow canvas holding every quest:
// dependency chains up top (edges drawn, cross-lane links visible), then the flat standalone and
// repeatable regions. Selection stays owned by the parent (URL :detail); clicking a node reports
// its representative quest-name. Phase-2 center-on-select lives in CenterOnSelect below.

interface QuestNodeData extends Record<string, unknown> {
  title: string;
  questName: string; // representative name reported on click
  done: boolean;
  selected: boolean;
  region: QuestMapRegion;
  /**
   * A filter is active AND this node matched it: the quests you actually asked for. Drives the
   * aura. False with no filter on, so an unfiltered map does not light up end to end.
   */
  highlight: boolean;
  /**
   * A filter is active and this node is only on screen because a chain neighbour matched, AND it
   * is not completed. Completed steps are never context: the finished run of a line is the
   * history the map exists to show, so it stays green.
   */
  context: boolean;
}
interface LaneNodeData extends Record<string, unknown> {
  title: string;
  done: number;
  total: number;
  /** Reserved by the layout to fit the longest chain name; see laneLabelWidth. */
  width: number;
}
interface SectionNodeData extends Record<string, unknown> {
  title: string;
}

type QuestNode = Node<QuestNodeData, 'quest'>;
type LaneNode = Node<LaneNodeData, 'lane'>;
type SectionNode = Node<SectionNodeData, 'section'>;

/**
 * The card's whole look for one state, as a single class string.
 *
 * Two independent channels, deliberately kept apart:
 *   HUE says progress      - green done, amber outstanding, grey unreached context.
 *   BORDER says relevance  - a heavier, brighter border marks a filter hit.
 *
 * They have to be separate. A completed quest can be either a hit or mere chain context, and hue
 * alone (both plain green) cannot tell those apart, which is the whole reason the border weight
 * exists. Selection stays a `ring`, a third channel again, so a selected hit shows both.
 *
 * Returned as ONE string per state rather than composed from fragments because Tailwind resolves
 * competing utilities (`border-emerald-700/60` vs `border-emerald-400`) by CSS order, not by the
 * order they appear in the class list, so overlapping fragments would collide unpredictably.
 */
function questCardClasses(done: boolean, context: boolean, highlight: boolean): string {
  // Muted COLOURS, never opacity: context nodes stay fully clickable (the detail panel is the
  // point of keeping them on screen) and opacity would fade the selection ring along with them.
  if (context) {
    return 'border border-dashed border-neutral-700/70 bg-neutral-900/50 hover:border-neutral-500';
  }
  if (highlight) {
    return done
      ? 'border-2 border-emerald-400 bg-neutral-900/90'
      : 'border-2 border-amber-400 bg-neutral-900/90';
  }
  return done
    ? 'border border-emerald-700/60 bg-neutral-900/90'
    : 'border border-amber-700/50 bg-neutral-900/90';
}

const QuestNodeCard = memo(({ data }: NodeProps<QuestNode>) => {
  const { title, done, selected, highlight, context } = data;
  const dot = done
    ? highlight
      ? 'bg-emerald-400'
      : 'bg-emerald-500'
    : context
      ? 'bg-neutral-600'
      : highlight
        ? 'bg-amber-400'
        : 'bg-amber-500';
  const suffix = context
    ? ' (chain context, not a filter match)'
    : highlight
      ? ' (filter match)'
      : '';
  return (
    <div
      title={`${title}${suffix}`}
      style={{ width: NODE_W, height: NODE_H }}
      className={`flex items-center gap-2 rounded-md px-2 text-left transition-colors ${questCardClasses(done, context, highlight)} ${
        selected ? 'ring-2 ring-sky-500/70' : ''
      }`}
    >
      <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${dot}`} />
      <span
        className={`line-clamp-2 text-xs leading-tight ${
          context ? 'text-neutral-500' : highlight ? 'font-medium text-white' : 'text-neutral-100'
        }`}
      >
        {title}
      </span>
      {/* Invisible handles: edges attach here, but users can't draw new ones. */}
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!opacity-0"
      />
    </div>
  );
});
QuestNodeCard.displayName = 'QuestNodeCard';

// `nowrap` without `truncate`: the layout reserves room for the longest chain name, so the label
// must never ellipsize. Should the reservation ever fall short, the overflow spills left into the
// map's empty margin - visible, which is the point - rather than eating the end of the title.
const LaneLabel = memo(({ data }: NodeProps<LaneNode>) => (
  <div
    style={{ width: data.width, height: NODE_H }}
    className="flex flex-col justify-center pr-3 text-right"
  >
    <span className="whitespace-nowrap text-sm font-semibold text-neutral-200" title={data.title}>
      {data.title}
    </span>
    <span className="text-[11px] text-neutral-500">
      {data.done}/{data.total}
    </span>
  </div>
));
LaneLabel.displayName = 'LaneLabel';

const SectionHeader = memo(({ data }: NodeProps<SectionNode>) => (
  <div className="whitespace-nowrap text-base font-semibold text-amber-300">{data.title}</div>
));
SectionHeader.displayName = 'SectionHeader';

const nodeTypes: NodeTypes = {
  quest: QuestNodeCard,
  lane: LaneLabel,
  section: SectionHeader,
};

export interface QuestMapProps {
  layout: QuestMapLayout;
  completed: ReadonlySet<string>;
  selectedName: string | null;
  onSelectNode: (questName: string) => void;
  /**
   * Quests that matched the filter outright. Nodes outside this set are drawn greyed: they are on
   * screen only as chain context. Undefined (no active filter) means every node is a match.
   */
  matched?: ReadonlySet<string> | undefined;
  /**
   * Bump to re-frame the selected node even when `selectedName` is unchanged. Search stepping
   * needs this: landing on the already-selected quest, or hand-panning away from a single-match
   * result, would otherwise leave the viewport where it was.
   */
  focusTick?: number;
  /**
   * Bump when the layout has been re-packed by a filter change. Every node moves, so the old
   * viewport frames nothing meaningful and the map must re-fit.
   */
  refitTick?: number;
  /**
   * Viewport to open on instead of fitting the whole map - the pan/zoom the user left the tab
   * at (QuestsView keeps it in the uiStore). Null/undefined = first visit, fit as before.
   */
  initialViewport?: Viewport | null;
  /** Reports every completed pan/zoom so the owner can remember the position. */
  onViewportChange?: (viewport: Viewport) => void;
}

/**
 * Re-fits the viewport after a filter re-pack, UNLESS the selected quest survived the filter - in
 * that case CenterOnSelect is already flying to it and a competing fitView would fight it.
 *
 * The `seen` guard is what limits this to refit ticks: the effect also re-runs on selection and
 * layout changes (they are real dependencies of the body), but only a CHANGED `refitTick` gets
 * past the guard. It is seeded with the mount value so the first render defers to ReactFlow's
 * own `fitView` prop.
 */
function RefitOnRepack({
  refitTick,
  selectedName,
  layout,
}: {
  refitTick: number | undefined;
  selectedName: string | null;
  layout: QuestMapLayout;
}) {
  const { fitView } = useReactFlow();
  const seen = useRef(refitTick);

  useEffect(() => {
    if (seen.current === refitTick) return;
    seen.current = refitTick;
    const selectionSurvived =
      selectedName != null && layout.nodes.some((n) => n.questNames.includes(selectedName));
    if (!selectionSurvived) void fitView({ duration: 400 });
  }, [refitTick, selectedName, layout, fitView]);

  return null;
}

/**
 * Pans/zooms the viewport to frame the selected quest node when the selection changes.
 *
 * `skipInitial` suppresses the very first run: when the map opens on a RESTORED viewport (tab
 * revisit), that viewport - not a fly-to of the restored selection - is the position the user
 * left, and centering would immediately pan away from it. Later selection changes still center.
 */
function CenterOnSelect({
  selectedName,
  layout,
  focusTick,
  skipInitial,
}: {
  selectedName: string | null;
  layout: QuestMapLayout;
  focusTick: number | undefined;
  skipInitial: boolean;
}) {
  const { setCenter, getZoom } = useReactFlow();
  const first = useRef(true);
  useEffect(() => {
    const isFirst = first.current;
    first.current = false;
    if (isFirst && skipInitial) return;
    if (!selectedName) return;
    const target = layout.nodes.find((n) => n.questNames.includes(selectedName));
    if (!target) return;
    const zoom = Math.max(getZoom(), 0.8);
    void setCenter(target.x + NODE_W / 2, target.y + NODE_H / 2, { zoom, duration: 500 });
  }, [selectedName, layout, setCenter, getZoom, focusTick, skipInitial]);
  return null;
}

function QuestMapInner({
  layout,
  completed,
  selectedName,
  onSelectNode,
  matched,
  focusTick,
  refitTick,
  initialViewport,
  onViewportChange,
}: QuestMapProps) {
  const [showMiniMap, setShowMiniMap] = useState(true);

  // React Flow reads fitView/defaultViewport ONCE on init, so freeze the mount-time value: the
  // prop updates on every reported move (the owner echoes the store back), and letting that flip
  // `fitView` mid-session would be dead code at best, confusing at worst.
  const [restored] = useState(() => initialViewport ?? null);

  const isDone = useCallback(
    (questNames: string[]) => questNames.some((q) => completed.has(q)),
    [completed],
  );

  // No `matched` set means no active filter, so nothing is a "hit" to single out and nothing is
  // context: the map renders in its plain unfiltered look.
  const filtering = matched !== undefined;
  const isMatched = useCallback(
    (questNames: string[]) => matched === undefined || questNames.some((q) => matched.has(q)),
    [matched],
  );

  const nodes = useMemo<Node[]>(() => {
    const out: Node[] = [];
    for (const s of layout.sections) {
      out.push({
        id: s.id,
        type: 'section',
        position: { x: s.x, y: s.y },
        data: { title: s.title },
        draggable: false,
        selectable: false,
        deletable: false,
      });
    }
    for (const l of layout.lanes) {
      const done = l.questNames.filter((q) => completed.has(q)).length;
      out.push({
        id: l.id,
        type: 'lane',
        position: { x: l.x, y: l.y },
        data: { title: l.title, done, total: l.total, width: layout.laneLabelWidth },
        draggable: false,
        selectable: false,
        deletable: false,
      });
    }
    for (const n of layout.nodes) {
      const done = isDone(n.questNames);
      const hit = isMatched(n.questNames);
      out.push({
        id: n.id,
        type: 'quest',
        position: { x: n.x, y: n.y },
        width: NODE_W,
        height: NODE_H,
        data: {
          title: n.title,
          questName: n.questNames[0],
          done,
          selected: selectedName != null && n.questNames.includes(selectedName),
          region: n.region,
          highlight: filtering && hit,
          context: filtering && !hit && !done,
        },
        draggable: false,
        deletable: false,
      });
    }
    return out;
  }, [layout, completed, selectedName, isDone, isMatched, filtering]);

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map((e) => {
        const target = layout.nodes.find((n) => n.id === e.target);
        const done = target ? isDone(target.questNames) : false;
        // An edge inherits its target's state, so edges into greyed context grey out with it -
        // otherwise the lines would stay bright and the map would still read as all-matches.
        // Same rule as the node card: done wins, so edges into completed steps stay green.
        const context = target != null && !done && !isMatched(target.questNames);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'smoothstep',
          selectable: false,
          style: {
            stroke: context
              ? 'var(--color-neutral-600)'
              : done
                ? 'var(--color-emerald-500)'
                : 'var(--color-amber-500)',
            strokeOpacity: context ? 0.5 : done ? 0.8 : 0.55,
            strokeWidth: 1.5,
          },
        };
      }),
    [layout, isDone, isMatched],
  );

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const data = node.data as Partial<QuestNodeData>;
      if (data.questName) onSelectNode(data.questName);
    },
    [onSelectNode],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      fitView={restored == null}
      {...(restored != null ? { defaultViewport: restored } : {})}
      onMoveEnd={(_, viewport) => onViewportChange?.(viewport)}
      minZoom={0.15}
      maxZoom={2}
      nodesConnectable={false}
      elementsSelectable
      onlyRenderVisibleElements
      proOptions={{ hideAttribution: false }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#3f3f46" />
      <Controls showInteractive={false} />
      {showMiniMap && (
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            if (n.type !== 'quest') return 'transparent';
            const data = n.data as QuestNodeData;
            if (data.context) return '#525252';
            return data.done ? '#10b981' : '#f59e0b';
          }}
          maskColor="rgba(10,10,10,0.6)"
          className="!bg-neutral-900"
        />
      )}
      <Panel position="top-right">
        <button
          type="button"
          onClick={() => setShowMiniMap((v) => !v)}
          className="rounded border border-neutral-700 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-300 hover:border-amber-500 hover:text-amber-300"
        >
          {showMiniMap ? 'Hide minimap' : 'Show minimap'}
        </button>
      </Panel>
      <CenterOnSelect
        selectedName={selectedName}
        layout={layout}
        focusTick={focusTick}
        skipInitial={restored != null}
      />
      <RefitOnRepack refitTick={refitTick} selectedName={selectedName} layout={layout} />
    </ReactFlow>
  );
}

export function QuestMap(props: QuestMapProps) {
  return (
    <ReactFlowProvider>
      <QuestMapInner {...props} />
    </ReactFlowProvider>
  );
}
