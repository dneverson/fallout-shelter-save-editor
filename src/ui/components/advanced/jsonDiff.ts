// Structural diff for the Advanced editor's "preview changes" (the pre-export change
// review, raw-editor flavor). Compares the editor's parsed JSON against
// the currently loaded save and reports added / removed / changed leaf paths so a power
// user can see EXACTLY what their hand-edits (or a pasted replacement save) will do before
// committing one undo step. Object key order is irrelevant; arrays diff by index.

import { isLosslessInt } from '../../../domain/codec/losslessJson.ts';

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface Change {
  /** JSONPath-ish location, e.g. `vault.storage.resources.Nuka`. */
  path: string;
  kind: ChangeKind;
  /** Compact before/after previews (absent side = added/removed). */
  before?: string;
  after?: string;
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  /** First N changes for display; `truncated` is how many more exist. */
  changes: Change[];
  truncated: number;
}

const MAX_CHANGES = 200;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function preview(v: unknown): string {
  if (v === undefined) return 'undefined';
  // A boxed 64-bit integer is a scalar - show its literal, not `{"literal":…}`.
  if (isLosslessInt(v)) return v.literal;
  const s = JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

function joinPath(base: string, seg: string | number): string {
  if (typeof seg === 'number') return `${base}[${seg}]`;
  return base ? `${base}.${seg}` : seg;
}

/** Compare two parsed JSON values, accumulating leaf-level changes into `out`. */
function walk(a: unknown, b: unknown, path: string, out: Change[]): void {
  if (out.length > MAX_CHANGES) return;
  if (Object.is(a, b)) return;

  // Treat a boxed 64-bit integer as a scalar leaf (compare by literal), so an
  // unchanged tick never reports as a difference and a changed one shows cleanly.
  if (isLosslessInt(a) || isLosslessInt(b)) {
    const av = isLosslessInt(a) ? a.literal : JSON.stringify(a);
    const bv = isLosslessInt(b) ? b.literal : JSON.stringify(b);
    if (av !== bv) {
      out.push({ path: path || '(root)', kind: 'changed', before: preview(a), after: preview(b) });
    }
    return;
  }

  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const inA = k in a;
      const inB = k in b;
      if (inA && inB) walk(a[k], b[k], joinPath(path, k), out);
      else if (inB) out.push({ path: joinPath(path, k), kind: 'added', after: preview(b[k]) });
      else out.push({ path: joinPath(path, k), kind: 'removed', before: preview(a[k]) });
    }
    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const inA = i < a.length;
      const inB = i < b.length;
      if (inA && inB) walk(a[i], b[i], joinPath(path, i), out);
      else if (inB) out.push({ path: joinPath(path, i), kind: 'added', after: preview(b[i]) });
      else out.push({ path: joinPath(path, i), kind: 'removed', before: preview(a[i]) });
    }
    return;
  }

  // Primitives (or a type change object↔array↔primitive): a single changed leaf.
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.push({ path: path || '(root)', kind: 'changed', before: preview(a), after: preview(b) });
  }
}

/** Diff the current save (`from`) against the edited value (`to`). */
export function diffJson(from: unknown, to: unknown): DiffSummary {
  const all: Change[] = [];
  walk(from, to, '', all);
  const added = all.filter((c) => c.kind === 'added').length;
  const removed = all.filter((c) => c.kind === 'removed').length;
  const changed = all.filter((c) => c.kind === 'changed').length;
  return {
    added,
    removed,
    changed,
    changes: all.slice(0, MAX_CHANGES),
    truncated: Math.max(0, all.length - MAX_CHANGES),
  };
}
