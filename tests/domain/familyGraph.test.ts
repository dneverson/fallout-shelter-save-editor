// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import type { UniqueDwellers } from '../../src/domain/gamedata/schemas.ts';
import {
  selectBloodline,
  selectFamilyForest,
  selectFamilyStats,
} from '../../src/domain/selectors/familyGraphSelectors.ts';
import { layoutForest } from '../../src/ui/lib/familyTreeLayout.ts';

const UNIQUE: UniqueDwellers = {
  L_Max: {
    ascendancyId: -48,
    name: 'Maximus',
    lastName: '',
    gender: 2,
    hair: '03',
    faceMask: null,
    outfitId: 'BOSCasual',
    weaponId: 'T60Pistol',
    skinColor: 4286339388,
    hairColor: 4280623644,
    stats: [7, 6, 6, 5, 4, 7, 5],
    isInfertile: false,
    randomBody: false,
    randomName: false,
  },
};

function d(id: number, extra: Record<string, unknown> = {}) {
  return { serializeId: id, name: `D${id}`, lastName: 'X', gender: 2, ...extra };
}

function save(dwellers: ReturnType<typeof d>[]): SaveData {
  return { dwellers: { dwellers } } as unknown as SaveData;
}

// A couple (1 male + 2 female) with two children (3, 4); plus an unrelated lone dweller 9.
function sampleSave(): SaveData {
  return save([
    d(1, { gender: 2, relations: { partner: 2, ascendants: [-1, -1, -1, -1, -1, -1] } }),
    d(2, { gender: 1, relations: { partner: 1, ascendants: [-1, -1, -1, -1, -1, -1] } }),
    d(3, { gender: 2, relations: { partner: -1, ascendants: [1, 2, -1, -1, -1, -1] } }),
    d(4, { gender: 1, relations: { partner: -1, ascendants: [1, 2, -1, -1, -1, -1] } }),
    d(9, { gender: 2 }),
  ]);
}

describe('selectFamilyForest', () => {
  it('builds reciprocal parent/child, spouse, and sibling edges', () => {
    const { nodesById } = selectFamilyForest(sampleSave(), UNIQUE);
    const n1 = nodesById.get('1')!;
    const n3 = nodesById.get('3')!;

    expect(n1.spouses.map((r) => r.id)).toEqual(['2']);
    expect(n1.children.map((r) => r.id).sort()).toEqual(['3', '4']);
    expect(n3.parents.map((r) => r.id).sort()).toEqual(['1', '2']);
    // 3 and 4 share both parents → blood siblings, mirrored.
    expect(n3.siblings).toEqual([{ id: '4', type: 'blood' }]);
    expect(nodesById.get('4')!.siblings).toEqual([{ id: '3', type: 'blood' }]);
  });

  it('splits the save into connected families and roots each at a top ancestor', () => {
    const forest = selectFamilyForest(sampleSave(), UNIQUE);
    expect(forest.components).toHaveLength(2);
    const [big, lone] = forest.components;
    expect(big.nodeIds.sort()).toEqual(['1', '2', '3', '4']);
    expect(['1', '2']).toContain(big.rootId); // a parent, never a child
    expect(lone.nodeIds).toEqual(['9']);
  });

  it('lays out the forest placing every dweller', () => {
    const forest = selectFamilyForest(sampleSave(), UNIQUE);
    const layout = layoutForest(forest);
    // Every vault dweller node gets a position (lone dweller 9 included).
    expect(layout.nodes.length).toBe(forest.nodes.length);
    expect(new Set(layout.nodes.map((n) => n.id)).size).toBe(forest.nodes.length);
  });

  it('includes an absent special ancestor as a flagged placeholder node', () => {
    // Child 3 descends from Maximus (AscendancyID -48), who is not in the vault.
    const forest = selectFamilyForest(
      save([d(3, { relations: { partner: -1, ascendants: [-48, -1, -1, -1, -1, -1] } })]),
      UNIQUE,
    );
    const ancestor = forest.meta.get('u:-48')!;
    expect(ancestor).toMatchObject({
      serializeId: null,
      name: 'Maximus',
      special: true,
      absent: true,
    });
    expect(forest.nodesById.get('3')!.parents).toEqual([{ id: 'u:-48', type: 'blood' }]);
  });

  it('links co-parents as spouses so multiple partners are kept (calcTree drops orphans)', () => {
    // Parent 1 has a child (3) with partner 2, and another child (4) with 6 - even though
    // the save only records ONE current partner. Both co-parents must become spouses of 1.
    const forest = selectFamilyForest(
      save([
        d(1, { relations: { partner: 2, ascendants: [-1, -1, -1, -1, -1, -1] } }),
        d(2, { gender: 1, relations: { partner: 1, ascendants: [-1, -1, -1, -1, -1, -1] } }),
        d(6, { gender: 1, relations: { partner: -1, ascendants: [-1, -1, -1, -1, -1, -1] } }),
        d(3, { relations: { partner: -1, ascendants: [1, 2, -1, -1, -1, -1] } }),
        d(4, { relations: { partner: -1, ascendants: [1, 6, -1, -1, -1, -1] } }),
      ]),
      UNIQUE,
    );
    expect(
      forest.nodesById
        .get('1')!
        .spouses.map((r) => r.id)
        .sort(),
    ).toEqual(['2', '6']);
    expect(forest.nodesById.get('6')!.spouses.map((r) => r.id)).toEqual(['1']);
    // One connected family containing everyone - nobody orphaned.
    expect(forest.components).toHaveLength(1);
    expect(forest.components[0].nodeIds.sort()).toEqual(['1', '2', '3', '4', '6']);
  });

  it('breaks parent/child cycles so the descent graph is acyclic', () => {
    // Corrupt data: 1 is parent of 2, 2 is parent of 3, and 3 is parent of 1 (a cycle).
    const forest = selectFamilyForest(
      save([
        d(1, { relations: { partner: -1, ascendants: [3, -1, -1, -1, -1, -1] } }),
        d(2, { relations: { partner: -1, ascendants: [1, -1, -1, -1, -1, -1] } }),
        d(3, { relations: { partner: -1, ascendants: [2, -1, -1, -1, -1, -1] } }),
      ]),
      UNIQUE,
    );
    // No node can still reach itself by descending (proves acyclicity), and layout places all.
    for (const start of forest.nodes.map((n) => n.id)) {
      const seen = new Set<string>();
      const stack = [...forest.nodesById.get(start)!.children.map((r) => r.id)];
      while (stack.length) {
        const cur = stack.pop()!;
        expect(cur).not.toBe(start);
        if (seen.has(cur)) continue;
        seen.add(cur);
        stack.push(...forest.nodesById.get(cur)!.children.map((r) => r.id));
      }
    }
    expect(layoutForest(forest).nodes.length).toBe(3);
  });

  it('drops marriages between blood relatives (incest hangs calcTree otherwise)', () => {
    // 1 is parent of 2; 2 is parent of 3; and 3 is MARRIED to 1 (its grandparent).
    const forest = selectFamilyForest(
      save([
        d(1, { gender: 2, relations: { partner: 3, ascendants: [-1, -1, -1, -1, -1, -1] } }),
        d(2, { gender: 1, relations: { partner: -1, ascendants: [1, -1, -1, -1, -1, -1] } }),
        d(3, { gender: 1, relations: { partner: 1, ascendants: [2, -1, -1, -1, -1, -1] } }),
      ]),
      UNIQUE,
    );
    // The incest marriage is removed; blood edges still connect them.
    expect(forest.nodesById.get('1')!.spouses).toEqual([]);
    expect(forest.nodesById.get('3')!.spouses).toEqual([]);
    expect(forest.nodesById.get('1')!.children.map((r) => r.id)).toEqual(['2']);
  });

  it('ignores a partner that is not present in the vault', () => {
    const forest = selectFamilyForest(
      save([d(1, { relations: { partner: 999, ascendants: [-1, -1, -1, -1, -1, -1] } })]),
      UNIQUE,
    );
    expect(forest.nodesById.get('1')!.spouses).toEqual([]);
  });
});

describe('selectFamilyStats', () => {
  it('counts families, couples, generations, lone wolves, and founders', () => {
    const forest = selectFamilyForest(sampleSave(), UNIQUE);
    const s = selectFamilyStats(forest);
    expect(s.dwellers).toBe(5);
    expect(s.familyGroups).toBe(1); // 1,2,3,4 form one family
    expect(s.loneWolves).toBe(1); // dweller 9
    expect(s.largestFamily).toBe(4);
    expect(s.generations).toBe(2); // parents over children
    expect(s.couples).toBe(1); // 1 & 2
    expect(s.founders).toBe(3); // 1, 2, 9 have no parents
    expect(s.inbredUnions).toBe(0);
    expect(s.status.level).toBeLessThanOrEqual(1); // no inbreeding → wholesome tier
  });

  it('flags inbreeding when a child descends from two related parents', () => {
    // 1 → 2 and 1 → 3 (2 and 3 are siblings); then 2 & 3 co-parent child 4.
    const forest = selectFamilyForest(
      save([
        d(1, { gender: 2, relations: { partner: -1, ascendants: [-1, -1, -1, -1, -1, -1] } }),
        d(2, { gender: 2, relations: { partner: -1, ascendants: [1, -1, -1, -1, -1, -1] } }),
        d(3, { gender: 1, relations: { partner: -1, ascendants: [1, -1, -1, -1, -1, -1] } }),
        d(4, { relations: { partner: -1, ascendants: [2, 3, -1, -1, -1, -1] } }),
      ]),
      UNIQUE,
    );
    const s = selectFamilyStats(forest);
    expect(s.twoParentChildren).toBe(1);
    expect(s.inbredUnions).toBe(1); // 2 and 3 share ancestor 1
    expect(s.status.level).toBeGreaterThanOrEqual(4); // 100% ratio → heavily inbred
  });
});

describe('selectBloodline', () => {
  it('collects self, ancestors, descendants, and direct spouses', () => {
    // grandparent 10 → parent 1 (married to 2) → child 3.
    const forest = selectFamilyForest(
      save([
        d(10, { relations: { partner: -1, ascendants: [-1, -1, -1, -1, -1, -1] } }),
        d(1, { relations: { partner: 2, ascendants: [10, -1, -1, -1, -1, -1] } }),
        d(2, { gender: 1, relations: { partner: 1, ascendants: [-1, -1, -1, -1, -1, -1] } }),
        d(3, { relations: { partner: -1, ascendants: [1, 2, -1, -1, -1, -1] } }),
      ]),
      UNIQUE,
    );
    const blood = selectBloodline(forest, '1');
    // self(1) + ancestor(10) + descendant(3) + spouse(2).
    expect([...blood].sort()).toEqual(['1', '10', '2', '3']);
  });

  it('returns an empty set for an unknown node', () => {
    const forest = selectFamilyForest(sampleSave(), UNIQUE);
    expect(selectBloodline(forest, 'nope').size).toBe(0);
  });
});
