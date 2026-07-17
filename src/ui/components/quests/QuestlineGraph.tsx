import { Fragment } from 'react';
import type { Questline, QuestlineNode } from '../../../domain/gamedata/schemas.ts';

// The horizontal questline graph (Section 1): one lane per questline, nodes laid left-to-right
// along the dependency chain (build-quests emits them topo-sorted). A node is a quest; a node is
// GREEN when any of its collapsed variant quest-names is in the completion ledger, else AMBER. The
// connector line into a node takes that node's colour ("green lines to green dots"). Clicking a
// node opens its detail panel. Cross-lane dependency edges aren't drawn (v1); the in-lane sequence
// is the visual, matching the user's GitHub-graph intent.

function isNodeComplete(node: QuestlineNode, completed: ReadonlySet<string>): boolean {
  return node.questNames.some((n) => completed.has(n));
}

function Connector({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`h-0.5 w-6 shrink-0 ${done ? 'bg-emerald-500' : 'bg-amber-500/70'}`}
    />
  );
}

function Node({
  node,
  done,
  selected,
  onSelect,
}: {
  node: QuestlineNode;
  done: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={node.title}
      aria-pressed={selected}
      className={`flex w-36 shrink-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
        selected
          ? 'border-sky-500 ring-1 ring-sky-500/60'
          : done
            ? 'border-emerald-700/60 hover:border-emerald-500'
            : 'border-amber-700/50 hover:border-amber-500'
      } bg-neutral-900/60`}
    >
      <span
        aria-hidden="true"
        className={`h-3 w-3 shrink-0 rounded-full ${done ? 'bg-emerald-500' : 'bg-amber-500'}`}
      />
      <span className="truncate text-xs text-neutral-200">{node.title}</span>
    </button>
  );
}

export interface QuestlineGraphProps {
  questlines: Questline[];
  completed: ReadonlySet<string>;
  /** The quest-name whose node is highlighted (the open detail), or null. */
  selectedName: string | null;
  onSelectNode: (questName: string) => void;
}

export function QuestlineGraph({
  questlines,
  completed,
  selectedName,
  onSelectNode,
}: QuestlineGraphProps) {
  return (
    <div className="flex flex-col gap-4">
      {questlines.map((ql) => {
        const doneCount = ql.nodes.filter((n) => isNodeComplete(n, completed)).length;
        return (
          <div key={ql.title} className="min-w-0">
            <div className="mb-1 flex items-baseline gap-2">
              <h3 className="truncate text-sm font-semibold text-neutral-200" title={ql.title}>
                {ql.title}
              </h3>
              <span className="shrink-0 text-[11px] text-neutral-500">
                {doneCount}/{ql.nodes.length}
              </span>
            </div>
            <div className="flex items-center overflow-x-auto pb-1">
              {ql.nodes.map((node, i) => {
                const done = isNodeComplete(node, completed);
                return (
                  <Fragment key={node.id}>
                    {i > 0 && <Connector done={done} />}
                    <Node
                      node={node}
                      done={done}
                      selected={selectedName != null && node.questNames.includes(selectedName)}
                      onSelect={() => onSelectNode(node.id)}
                    />
                  </Fragment>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
