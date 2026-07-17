// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Quest, Questline, QuestlineNode } from '../../src/domain/gamedata/schemas.ts';
import {
  buildQuestMapLayout,
  laneLabelWidth,
  NODE_W,
} from '../../src/domain/quests/questGraphLayout.ts';

function node(id: string, deps: string[], questNames = [id]): QuestlineNode {
  return { id, title: id, questNames, dependencies: deps } as QuestlineNode;
}
function line(title: string, nodes: QuestlineNode[]): Questline {
  return { title, nodes } as Questline;
}
function quest(name: string, type: number, title = name): Quest {
  return { m_questName: name, m_questType: type, title } as Quest;
}

// Two chains: lineA is A1<-A2<-A3; lineB is B1<-B2 where B1 depends on A3 (a cross-lane edge).
const lineA = line('Alpha', [node('A1', []), node('A2', ['A1']), node('A3', ['A2'])]);
const lineB = line('Bravo', [node('B1', ['A3']), node('B2', ['B1'])]);

describe('laneLabelWidth - the lane column fits the longest chain name', () => {
  it('grows with the longest title and lands on a round step', () => {
    // The real catalog's worst case. It rendered at 257px and used to clip at a fixed 236.
    const longest = line('Horsemen of the Post-Apocalypse Part 3', [node('H1', [])]);
    const width = laneLabelWidth([lineA, longest]);
    expect(width).toBe(310); // 38 chars * 8px = 304, rounded up to the next 10
    expect(width % 10).toBe(0);
    expect(width).toBeGreaterThan(257);
  });

  it('is driven by the LONGEST title, not the first or last', () => {
    const mid = line('A Settler Needs Your Help', [node('M1', [])]);
    const long = line('Journey to the Center of Vaultopolis', [node('L1', [])]);
    expect(laneLabelWidth([mid, long, lineA])).toBe(laneLabelWidth([long]));
  });

  it('holds a floor so a map of short names keeps a sane column', () => {
    expect(laneLabelWidth([lineA, lineB])).toBe(160);
    expect(laneLabelWidth([])).toBe(160);
  });

  it('moves the whole left margin with the column, keeping the gap to column 0', () => {
    // Lane labels, section headers and the reported bounds all hang off the label column, so a
    // wider column must shift them together - otherwise the text just overlaps the first quest.
    const longest = line('Horsemen of the Post-Apocalypse Part 3', [node('H1', [])]);
    const narrow = buildQuestMapLayout([lineA], []);
    const wide = buildQuestMapLayout([lineA, longest], []);

    const gapOf = (l: ReturnType<typeof buildQuestMapLayout>): number =>
      -l.lanes[0].x - l.laneLabelWidth;
    expect(gapOf(narrow)).toBe(24);
    expect(gapOf(wide)).toBe(24);

    expect(wide.lanes[0].x).toBeLessThan(narrow.lanes[0].x);
    expect(wide.sections[0].x).toBe(wide.lanes[0].x);
    expect(wide.bounds.width).toBeGreaterThan(narrow.bounds.width);
  });
});

describe('buildQuestMapLayout - chain region', () => {
  it('columns are longest-path depth, cross-lane deps shift the continuation right', () => {
    const { nodes } = buildQuestMapLayout([lineA, lineB], []);
    const x = (id: string) => nodes.find((n) => n.id === id)!.x;
    expect(x('A1')).toBeLessThan(x('A2'));
    expect(x('A2')).toBeLessThan(x('A3'));
    // B1 depends on A3 (column 2), so it sits at column 3 - right of its cross-lane parent.
    expect(x('B1')).toBeGreaterThan(x('A3'));
    expect(x('B2')).toBeGreaterThan(x('B1'));
  });

  it('emits one edge per resolvable dependency, including the cross-lane link', () => {
    const { edges } = buildQuestMapLayout([lineA, lineB], []);
    expect(edges).toContainEqual(expect.objectContaining({ source: 'A2', target: 'A3' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'A3', target: 'B1' }));
    expect(edges).toHaveLength(4); // A2<-A1, A3<-A2, B1<-A3, B2<-B1
  });

  it('places every chain node on a lane row and yields a lane label per questline', () => {
    const { nodes, lanes } = buildQuestMapLayout([lineA, lineB], []);
    expect(nodes.filter((n) => n.region === 'chain')).toHaveLength(5);
    expect(lanes.map((l) => l.title).sort()).toEqual(['Alpha', 'Bravo']);
    const bravo = lanes.find((l) => l.title === 'Bravo')!;
    expect(bravo.total).toBe(2);
  });

  it('linked lanes cluster: Bravo is laid out on a row adjacent to Alpha', () => {
    const other = line('Charlie', [node('C1', [])]);
    // Charlie sorts between Alpha and Bravo alphabetically but is unlinked, so union-find
    // ordering must keep Alpha and Bravo (one component) on adjacent rows.
    const { lanes } = buildQuestMapLayout([lineA, other, lineB], []);
    const rowOf = (t: string) => lanes.find((l) => l.title === t)!.y;
    expect(Math.abs(rowOf('Alpha') - rowOf('Bravo'))).toBeLessThan(
      Math.abs(rowOf('Alpha') - rowOf('Charlie')),
    );
  });
});

describe('buildQuestMapLayout - flat regions', () => {
  const flatQuests: Quest[] = [
    quest('Standalone_1', 1, 'The Cat Burglar'),
    quest('Special_1', 2, 'Welcome to Paradise'),
    // Repeatable with three difficulty variants that collapse to one node by title.
    quest('GameShow_Diff_10', 4, 'Game Show Gauntlet'),
    quest('GameShow_Diff_20', 4, 'Game Show Gauntlet'),
    quest('GameShow_Diff_30', 4, 'Game Show Gauntlet'),
    quest('Daily_7', 3, 'Duo of Destruction'),
    // A quest already covered by a chain must NOT appear in a flat region.
    quest('A1', 0, 'A1'),
  ];

  it('routes non-chain quests into standalone vs repeatable and collapses variants by title', () => {
    const { nodes } = buildQuestMapLayout([lineA, lineB], flatQuests);
    const standalone = nodes
      .filter((n) => n.region === 'standalone')
      .map((n) => n.title)
      .sort();
    const repeatable = nodes
      .filter((n) => n.region === 'repeatable')
      .map((n) => n.title)
      .sort();
    expect(standalone).toEqual(['The Cat Burglar', 'Welcome to Paradise']);
    expect(repeatable).toEqual(['Duo of Destruction', 'Game Show Gauntlet']);

    const gameShow = nodes.find((n) => n.title === 'Game Show Gauntlet')!;
    expect(gameShow.questNames).toHaveLength(3); // three variants collapsed
    expect(nodes.some((n) => n.id === 'A1' && n.region !== 'chain')).toBe(false);
  });

  it('flat regions sit below the chain region and get section headers', () => {
    const { nodes, sections } = buildQuestMapLayout([lineA, lineB], flatQuests);
    const chainMaxY = Math.max(...nodes.filter((n) => n.region === 'chain').map((n) => n.y));
    const flatMinY = Math.min(...nodes.filter((n) => n.region !== 'chain').map((n) => n.y));
    expect(flatMinY).toBeGreaterThan(chainMaxY);
    expect(sections.map((s) => s.title)).toEqual([
      'Story Chains',
      'Standalone Quests',
      'Repeatable / Daily',
    ]);
  });
});

describe('buildQuestMapLayout - determinism & bounds', () => {
  it('is deterministic', () => {
    const a = buildQuestMapLayout([lineA, lineB], []);
    const b = buildQuestMapLayout([lineA, lineB], []);
    expect(a).toEqual(b);
  });
  it('reports bounds large enough to contain the rightmost node', () => {
    const { nodes, bounds } = buildQuestMapLayout([lineA, lineB], []);
    const maxX = Math.max(...nodes.map((n) => n.x));
    expect(bounds.width).toBeGreaterThanOrEqual(maxX + NODE_W);
  });
});
