// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { QuestMapNode } from '../../src/domain/quests/questGraphLayout.ts';
import { matchQuestNodes } from '../../src/domain/quests/questSearch.ts';

function node(over: Partial<QuestMapNode> & Pick<QuestMapNode, 'id'>): QuestMapNode {
  return {
    questNames: [over.id],
    title: over.id,
    region: 'chain',
    x: 0,
    y: 0,
    ...over,
  };
}

const nodes: QuestMapNode[] = [
  node({ id: 'A1', title: 'The Cat Burglar', questlineTitle: 'Alpha', questNames: ['CatBurglar'] }),
  node({ id: 'A2', title: 'Nuka Rescue', questlineTitle: 'Alpha', questNames: ['NukaRescue'] }),
  node({
    id: 'repeatable:Game Show Gauntlet',
    title: 'Game Show Gauntlet',
    region: 'repeatable',
    questNames: ['GameShow_Diff_20', 'GameShow_Diff_40'],
  }),
];

describe('matchQuestNodes', () => {
  it('matches on display title, case-insensitively', () => {
    expect(matchQuestNodes(nodes, 'cat burglar')).toEqual([
      { nodeId: 'A1', questName: 'CatBurglar' },
    ]);
    expect(matchQuestNodes(nodes, 'CAT')).toHaveLength(1);
  });

  it('matches on questline title, returning every node in that chain', () => {
    expect(matchQuestNodes(nodes, 'alpha').map((m) => m.nodeId)).toEqual(['A1', 'A2']);
  });

  it('matches on any collapsed m_questName, including difficulty variants', () => {
    const hits = matchQuestNodes(nodes, 'Diff_40');
    expect(hits).toHaveLength(1);
    // Selects the representative (first) name - the same one clicking the node reports.
    expect(hits[0].questName).toBe('GameShow_Diff_20');
  });

  it('returns matches in node order, so stepping walks the map in reading order', () => {
    expect(matchQuestNodes(nodes, 'a').map((m) => m.nodeId)).toEqual([
      'A1',
      'A2',
      'repeatable:Game Show Gauntlet',
    ]);
  });

  it('a blank or whitespace-only query matches nothing', () => {
    expect(matchQuestNodes(nodes, '')).toEqual([]);
    expect(matchQuestNodes(nodes, '   ')).toEqual([]);
  });

  it('no match yields an empty list', () => {
    expect(matchQuestNodes(nodes, 'deathclaw')).toEqual([]);
  });
});
