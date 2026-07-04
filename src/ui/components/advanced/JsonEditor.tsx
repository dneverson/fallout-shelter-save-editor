import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, type Text } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
  bracketMatching,
  foldGutter,
  foldKeymap,
  codeFolding,
  indentOnInput,
} from '@codemirror/language';
import {
  search,
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
  closeSearchPanel,
  searchPanelOpen,
  getSearchQuery,
  findNext as cmFindNext,
  findPrevious as cmFindPrevious,
} from '@codemirror/search';
import { linter, lintGutter, lintKeymap, type Diagnostic } from '@codemirror/lint';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { tags as t } from '@lezer/highlight';
import type { JsonSyntaxNode } from './jsonTreeModel.ts';
import { parseLossless, stringifyLossless } from '../../../domain/codec/losslessJson.ts';

// CodeMirror 6 JSON editor for the Advanced raw-save view. Wraps an
// uncontrolled EditorView and exposes an imperative handle (format / minify / search nav /
// reveal-a-span) so the surrounding toolbar and the JSON tree can drive it. The host
// remounts this (via React key) to load a fresh document after Apply/Revert, mirroring the
// previous textarea's snapshot model. All JSON features the engine offers are enabled:
// highlighting, fold gutter, bracket matching, the search panel (next/prev), and a lint
// gutter fed by the JSON parse linter plus an optional host-supplied schema linter.

/** Dark highlight palette (the editor's own theme below is also dark). */
const jsonHighlight = HighlightStyle.define([
  { tag: t.propertyName, color: '#7dd3fc' }, // keys - sky-300
  { tag: t.string, color: '#86efac' }, // green-300
  { tag: t.number, color: '#fcd34d' }, // amber-300
  { tag: [t.bool, t.null], color: '#c4b5fd' }, // violet-300
  { tag: [t.separator, t.squareBracket, t.brace, t.punctuation], color: '#737373' }, // neutral-500
]);

const editorTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: '#0a0a0a', color: '#e5e5e5', fontSize: '12px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      lineHeight: '1.6',
    },
    '.cm-content': { caretColor: '#fbbf24' },
    '.cm-cursor': { borderLeftColor: '#fbbf24' },
    '.cm-gutters': { backgroundColor: '#0a0a0a', color: '#525252', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: '#171717' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#3f3f1f' },
    '.cm-panels': { backgroundColor: '#171717', color: '#e5e5e5' },
    '.cm-panels input': {
      backgroundColor: '#0a0a0a',
      color: '#e5e5e5',
      border: '1px solid #404040',
    },
    // The search panel defaults to font-size 70% (tiny). Match the left tree search:
    // 12px text with px-2/py-1 padding on the field and buttons.
    '.cm-panel.cm-search': { fontSize: '12px', padding: '6px 8px' },
    '.cm-panel.cm-search label': { fontSize: '12px' },
    '.cm-textfield': { fontSize: '12px', padding: '4px 8px' },
    '.cm-button': { fontSize: '12px', padding: '4px 8px' },
    // Hide the native "all" (select-all-matches) button - the bottom Find-all list replaces it.
    '.cm-search button[name="select"]': { display: 'none' },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(251,191,36,0.22)',
      outline: '1px solid rgba(251,191,36,0.45)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(251,191,36,0.5)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(125,211,252,0.15)' },
    '.cm-foldPlaceholder': {
      backgroundColor: '#262626',
      color: '#a3a3a3',
      border: 'none',
      padding: '0 4px',
    },
    '.cm-tooltip': { backgroundColor: '#171717', border: '1px solid #404040', color: '#e5e5e5' },
  },
  { dark: true },
);

/** Value node names - used to compute the array-index segments of the cursor breadcrumb. */
const VALUE_NAMES = new Set(['Object', 'Array', 'String', 'Number', 'True', 'False', 'Null']);

function parseKey(raw: string): string {
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === 'string' ? v : raw;
  } catch {
    return raw;
  }
}

/** Breadcrumb path (object keys + `[index]` segments) for the value at the caret. */
function pathAtCaret(state: EditorState): string[] | null {
  const tree = syntaxTree(state);
  const pos = state.selection.main.head;
  const parts: string[] = [];
  let cur: JsonSyntaxNode | null = tree.resolveInner(pos, -1);
  while (cur) {
    const parent: JsonSyntaxNode | null = cur.parent;
    if (parent && parent.name === 'Array' && VALUE_NAMES.has(cur.name)) {
      let idx = 0;
      let sib: JsonSyntaxNode | null = parent.firstChild;
      while (sib && !(sib.from === cur.from && sib.to === cur.to && sib.name === cur.name)) {
        if (VALUE_NAMES.has(sib.name)) idx++;
        sib = sib.nextSibling;
      }
      parts.unshift(`[${idx}]`);
    }
    if (cur.name === 'Property') {
      const nameNode = cur.getChild('PropertyName');
      if (nameNode) parts.unshift(parseKey(state.doc.sliceString(nameNode.from, nameNode.to)));
    }
    cur = parent;
  }
  return parts.length ? parts : null;
}

export interface JsonEditorHandle {
  getValue: () => string;
  /** Pretty-print the document; returns false (and leaves the doc untouched) if it won't parse. */
  format: () => boolean;
  /** Collapse to single-line JSON; returns false if the document won't parse. */
  minify: () => boolean;
  /** Open the search panel if closed, close it if open (toolbar Find toggle). */
  toggleSearch: () => void;
  findNext: () => void;
  findPrev: () => void;
  /** Select a character span, scroll it to center, and focus the editor (tree click). */
  reveal: (from: number, to: number) => void;
  /**
   * Scroll a span into view and highlight it WITHOUT stealing focus - for the tree's
   * as-you-type search, so the user can keep typing in the search box uninterrupted and the
   * highlighted span is never overwritten (the editor isn't focused, so keystrokes don't land
   * there).
   */
  peek: (from: number, to: number) => void;
  focus: () => void;
}

/** One "Find all" hit: its character span plus the line number and text for the results list. */
export interface FindMatch {
  from: number;
  to: number;
  line: number;
  lineText: string;
}

/** Case-insensitive substring scan of the doc → all hits with their line number and text. */
function findMatches(doc: Text, query: string): FindMatch[] {
  if (!query) return [];
  const hay = doc.toString().toLowerCase();
  const needle = query.toLowerCase();
  const out: FindMatch[] = [];
  const LIMIT = 2000; // guard against pathological queries on huge docs
  let i = hay.indexOf(needle);
  while (i !== -1 && out.length < LIMIT) {
    const lineObj = doc.lineAt(i);
    out.push({ from: i, to: i + query.length, line: lineObj.number, lineText: lineObj.text });
    i = hay.indexOf(needle, i + Math.max(1, needle.length));
  }
  return out;
}

interface JsonEditorProps {
  initialDoc: string;
  /** Caret selection to restore on mount (clamped to the doc) - used to recover the user's place. */
  initialSelection?: { anchor: number; head: number };
  /** Scroll offset (px) to restore on mount, paired with initialSelection. */
  initialScrollTop?: number;
  /** Fired on every document change (host debounces before rebuilding the tree). */
  onDocChange?: (text: string) => void;
  /** Fired when the caret moves to a new structural path (drives the breadcrumb). */
  onPathChange?: (path: string[] | null) => void;
  /** Fired when the selection changes, with raw offsets (host tracks the place to persist). */
  onSelectionChange?: (selection: { anchor: number; head: number }) => void;
  /** Fired when the editor scrolls, with the current scrollTop (host persists the place). */
  onScroll?: (scrollTop: number) => void;
  /**
   * Fired when the (top) search query changes or the doc changes under an active query - the
   * single source for the bottom Find-all list. Empty query (or closed panel) emits `[]`.
   */
  onSearchResults?: (query: string, matches: FindMatch[]) => void;
  /** Optional structural validator → inline lint diagnostics (e.g. the save zod schema). */
  schemaLint?: (text: string) => Diagnostic[];
}

function replaceAll(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

export const JsonEditor = forwardRef<JsonEditorHandle, JsonEditorProps>(function JsonEditor(
  {
    initialDoc,
    initialSelection,
    initialScrollTop,
    onDocChange,
    onPathChange,
    onSelectionChange,
    onScroll,
    onSearchResults,
    schemaLint,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Keep the latest callbacks/validator in refs so the editor is built once (on mount) yet
  // always calls through to current handlers without tearing down the view.
  const onDocChangeRef = useRef(onDocChange);
  const onPathChangeRef = useRef(onPathChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onScrollRef = useRef(onScroll);
  const onSearchResultsRef = useRef(onSearchResults);
  const schemaLintRef = useRef(schemaLint);
  onDocChangeRef.current = onDocChange;
  onPathChangeRef.current = onPathChange;
  onSelectionChangeRef.current = onSelectionChange;
  onScrollRef.current = onScroll;
  onSearchResultsRef.current = onSearchResults;
  schemaLintRef.current = schemaLint;

  useEffect(() => {
    if (!hostRef.current) return;

    let lastPathKey = '\x00'; // sentinel so the first selection always emits
    let lastSearch = '\x00'; // sentinel so the first query always emits
    const watcher = EditorView.updateListener.of((u) => {
      if (u.docChanged) onDocChangeRef.current?.(u.state.doc.toString());
      if (u.selectionSet) {
        const m = u.state.selection.main;
        onSelectionChangeRef.current?.({ anchor: m.anchor, head: m.head });
      }
      if (u.selectionSet || u.docChanged) {
        const path = pathAtCaret(u.state);
        const key = path ? path.join('\x00') : '';
        if (key !== lastPathKey) {
          lastPathKey = key;
          onPathChangeRef.current?.(path);
        }
      }
      // Drive the bottom Find-all list from the TOP search panel (single search input): emit on
      // a query change, and refresh when the doc changes under an active query (offsets shift).
      const query = searchPanelOpen(u.state) ? getSearchQuery(u.state).search : '';
      if (query !== lastSearch || (u.docChanged && query)) {
        lastSearch = query;
        onSearchResultsRef.current?.(query, findMatches(u.state.doc, query));
      }
    });

    // Report scroll so the host can persist the user's place across a tab switch.
    const scrollWatcher = EditorView.domEventHandlers({
      scroll: (_event, view) => onScrollRef.current?.(view.scrollDOM.scrollTop),
    });

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          watcher,
          scrollWatcher,
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          codeFolding(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(jsonHighlight, { fallback: true }),
          bracketMatching(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          json(),
          linter(jsonParseLinter()),
          linter((v) => schemaLintRef.current?.(v.state.doc.toString()) ?? [], { delay: 600 }),
          lintGutter(),
          keymap.of([
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...searchKeymap,
            ...lintKeymap,
          ]),
          editorTheme,
        ],
      }),
    });
    viewRef.current = view;

    // Restore the caret + scroll the user left on (recovered draft). Selection is clamped to
    // the doc; scroll is applied after layout via requestMeasure so the offset isn't lost.
    if (initialSelection) {
      const max = view.state.doc.length;
      const anchor = Math.min(Math.max(0, initialSelection.anchor), max);
      const head = Math.min(Math.max(0, initialSelection.head), max);
      view.dispatch({ selection: { anchor, head } });
    }
    if (initialScrollTop) {
      const top = initialScrollTop;
      view.requestMeasure({
        read: () => undefined,
        write: () => {
          view.scrollDOM.scrollTop = top;
        },
      });
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; the host swaps documents by remounting via React key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    (): JsonEditorHandle => ({
      getValue: () => viewRef.current?.state.doc.toString() ?? '',
      format: () => {
        const view = viewRef.current;
        if (!view) return false;
        try {
          // Lossless parse/stringify so prettifying never rounds the save's 64-bit ticks.
          const parsed = parseLossless(view.state.doc.toString());
          replaceAll(view, stringifyLossless(parsed, 2));
          return true;
        } catch {
          return false;
        }
      },
      minify: () => {
        const view = viewRef.current;
        if (!view) return false;
        try {
          const parsed = parseLossless(view.state.doc.toString());
          replaceAll(view, stringifyLossless(parsed));
          return true;
        } catch {
          return false;
        }
      },
      toggleSearch: () => {
        const view = viewRef.current;
        if (!view) return;
        if (searchPanelOpen(view.state)) {
          closeSearchPanel(view);
          view.focus();
        } else {
          openSearchPanel(view);
          view.focus();
        }
      },
      findNext: () => {
        const view = viewRef.current;
        if (view) cmFindNext(view);
      },
      findPrev: () => {
        const view = viewRef.current;
        if (view) cmFindPrevious(view);
      },
      reveal: (from, to) => {
        const view = viewRef.current;
        if (!view) return;
        const max = view.state.doc.length;
        const a = Math.min(Math.max(0, from), max);
        const b = Math.min(Math.max(0, to), max);
        view.dispatch({
          selection: { anchor: a, head: b },
          effects: EditorView.scrollIntoView(a, { y: 'center' }),
        });
        view.focus();
      },
      peek: (from, to) => {
        const view = viewRef.current;
        if (!view) return;
        const max = view.state.doc.length;
        const a = Math.min(Math.max(0, from), max);
        const b = Math.min(Math.max(0, to), max);
        // Selection acts as a highlight only - no view.focus(), so the search box keeps focus
        // and the user's typing is never redirected into (and overwriting) this span.
        view.dispatch({
          selection: { anchor: a, head: b },
          effects: EditorView.scrollIntoView(a, { y: 'center' }),
        });
      },
      focus: () => viewRef.current?.focus(),
    }),
  );

  // `isolate` contains CodeMirror's internal z-indexes (the sticky search panel's base
  // theme sets z-index 300) in this component's own stacking context, so the Find bar
  // can never paint above the History panel / modal overlays (fixed z-50).
  return <div ref={hostRef} className="isolate h-full min-h-0 overflow-hidden" />;
});
