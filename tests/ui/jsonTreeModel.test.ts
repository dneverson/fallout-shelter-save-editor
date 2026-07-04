// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  buildJsonTree,
  createPathResolver,
} from '../../src/ui/components/advanced/jsonTreeModel.ts';
import { diffJson } from '../../src/ui/components/advanced/jsonDiff.ts';

// Pure model behind the Advanced raw editor's explorer tree + inline schema lint. These
// guard the two things the rest of the feature relies on: a faithful node tree, and
// path→text-span resolution that lands lint markers on the right token.

describe('buildJsonTree', () => {
  it('models objects, arrays, and leaves with keys, indices, and previews', () => {
    const text = JSON.stringify({ name: 'Vault 111', caps: 500, dwellers: [{ id: 1 }] }, null, 2);
    const root = buildJsonTree(text);
    expect(root).not.toBeNull();
    expect(root?.type).toBe('object');
    expect(root?.preview).toBe('{3 keys}');

    const byKey = new Map(root!.children.map((c) => [c.key, c]));
    expect(byKey.get('name')?.type).toBe('string');
    expect(byKey.get('name')?.preview).toBe('"Vault 111"');
    expect(byKey.get('caps')?.type).toBe('number');

    const dwellers = byKey.get('dwellers')!;
    expect(dwellers.type).toBe('array');
    expect(dwellers.preview).toBe('[1 item]');
    // Array element carries an index (not a key) and its own child.
    expect(dwellers.children[0].index).toBe(0);
    expect(dwellers.children[0].children[0].key).toBe('id');
  });

  it("returns a node whose span exactly brackets the value's source text", () => {
    const text = '{"caps": 500}';
    const root = buildJsonTree(text);
    const caps = root!.children[0];
    expect(text.slice(caps.from, caps.to)).toBe('500');
  });

  it('returns null for empty / non-JSON input', () => {
    expect(buildJsonTree('')).toBeNull();
    expect(buildJsonTree('   ')).toBeNull();
  });
});

describe('createPathResolver', () => {
  it('resolves nested object + array paths to the value span', () => {
    const text = JSON.stringify({ vault: { storage: { resources: { Nuka: 42 } } } }, null, 2);
    const span = createPathResolver(text).resolve(['vault', 'storage', 'resources', 'Nuka']);
    expect(span).not.toBeNull();
    expect(text.slice(span!.from, span!.to)).toBe('42');
  });

  it('resolves an array index segment', () => {
    const text = JSON.stringify({ dwellers: [{ name: 'A' }, { name: 'B' }] });
    const span = createPathResolver(text).resolve(['dwellers', 1, 'name']);
    expect(text.slice(span!.from, span!.to)).toBe('"B"');
  });

  it('returns null for a path that does not exist', () => {
    const text = '{"a": 1}';
    expect(createPathResolver(text).resolve(['a', 'missing'])).toBeNull();
    expect(createPathResolver(text).resolve(['nope'])).toBeNull();
  });
});

describe('diffJson', () => {
  it('counts added, removed, and changed leaves', () => {
    const before = { caps: 100, name: 'Old', rooms: [1, 2] };
    const after = { caps: 200, rooms: [1, 2, 3], extra: true };
    const d = diffJson(before, after);
    expect(d.changed).toBe(1); // caps 100 → 200
    expect(d.removed).toBe(1); // name dropped
    expect(d.added).toBe(2); // rooms[2] + extra
  });

  it('reports no changes for equal values regardless of key order', () => {
    const d = diffJson({ a: 1, b: 2 }, { b: 2, a: 1 });
    expect(d.changes).toHaveLength(0);
  });
});
