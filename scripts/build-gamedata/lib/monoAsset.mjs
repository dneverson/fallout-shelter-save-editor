// Generic parser for the clean, uniform Unity-YAML MonoBehaviour `.asset` exports
// (AssetRipper output). Unlike the line-scanning helpers in prefab.mjs, this walks the
// full indentation tree so a deeply-nested record (quest -> rooms[] -> loot slots ->
// combat/dialogue) can be captured whole. It only supports the subset these exports use:
//   - block mappings   (`m_key: value` / `m_key:` + deeper block)
//   - block sequences  (`- item`, dash at the same indent as its key)
//   - scalars          (numbers, bare/single-quoted strings, empty)
//   - inline `[]`      (empty sequence) and `{...}` (kept verbatim as a string; the only
//                       inline maps here are `{fileID: N}` refs the callers ignore)
// Verified against the Fallout Shelter 2.4.1 export - no block scalars (`|`/`>`) or
// double-quoted values occur in the quest/objective assets.

import { splitLines } from './prefab.mjs';

/** Unwrap a single-quoted YAML scalar (`''` -> `'`); trim otherwise. */
function unquote(v) {
  const s = v.trim();
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

/** Convert a scalar's raw text to number | boolean-ish stays number | string | []. */
function scalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v === '[]') return [];
  if (v === '{}') return {};
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d*\.\d+$/.test(v)) return Number(v);
  return unquote(v);
}

const KEY_RE = /^([\w.]+):(?:\s+(.*))?$/;

/**
 * Parse a block of `preprocessed` lines (each `{ indent, text }`) starting at `state.i`,
 * consuming every line indented at exactly `indent` (mappings) or dash-led at `indent`
 * (sequences). Recurses for deeper blocks. Advances `state.i` past the block.
 */
function parseBlock(lines, indent, state) {
  const first = lines[state.i];
  if (first.text.startsWith('- ')) return parseSequence(lines, indent, state);
  return parseMapping(lines, indent, state);
}

function parseMapping(lines, indent, state) {
  const obj = {};
  while (state.i < lines.length) {
    const line = lines[state.i];
    if (line.indent !== indent || line.text.startsWith('- ')) break;
    const m = line.text.match(KEY_RE);
    if (!m) break; // shouldn't happen in these exports
    const key = m[1];
    const inlineVal = m[2];
    state.i++;
    if (inlineVal !== undefined && inlineVal !== '') {
      obj[key] = scalar(inlineVal);
    } else {
      // No inline value: a deeper block (mapping/sequence), a same-indent sequence,
      // or an empty scalar.
      const next = lines[state.i];
      if (next && next.indent > indent) {
        obj[key] = parseBlock(lines, next.indent, state);
      } else if (next && next.indent === indent && next.text.startsWith('- ')) {
        obj[key] = parseSequence(lines, indent, state);
      } else {
        obj[key] = '';
      }
    }
  }
  return obj;
}

function parseSequence(lines, indent, state) {
  const arr = [];
  while (state.i < lines.length) {
    const line = lines[state.i];
    if (line.indent !== indent || !line.text.startsWith('- ')) break;
    const rest = line.text.slice(2); // strip "- "
    if (KEY_RE.test(rest)) {
      // Mapping item: rewrite this line as a same-mapping line at indent+2 (the column
      // the dash's first key actually sits at), then parse it as a mapping.
      lines[state.i] = { indent: indent + 2, text: rest };
      arr.push(parseMapping(lines, indent + 2, state));
    } else {
      state.i++;
      arr.push(scalar(rest));
    }
  }
  return arr;
}

/**
 * Parse a whole `.asset` document into the top-level `MonoBehaviour` mapping object.
 * Strips the `%YAML`/`%TAG`/`--- !u!114 &id` header and the `MonoBehaviour:` wrapper,
 * returning its children (`m_Name`, `m_questInformations`, ...).
 */
export function parseMonoBehaviour(text) {
  const lines = [];
  for (const raw of splitLines(text)) {
    if (raw === '' || /^%YAML|^%TAG|^--- /.test(raw)) continue;
    if (/^MonoBehaviour:\s*$/.test(raw)) continue;
    const indentMatch = raw.match(/^(\s*)/);
    const indent = indentMatch[1].length;
    const t = raw.slice(indent);
    if (t === '') continue;
    lines.push({ indent, text: t });
  }
  if (lines.length === 0) return {};
  // After stripping the `MonoBehaviour:` wrapper its children sit at indent 2.
  const state = { i: 0 };
  return parseMapping(lines, lines[0].indent, state);
}
