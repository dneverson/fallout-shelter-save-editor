import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Diagnostic } from '@codemirror/lint';
import { useSaveStore } from '../../state/saveStore.ts';
import { useUIStore, type AdvancedDraft } from '../../state/uiStore.ts';
import { pushToast } from '../../state/toastStore.ts';
import { saveSchema, type SaveData } from '../../domain/model/saveSchema.ts';
import { parseLossless, stringifyLossless } from '../../domain/codec/losslessJson.ts';
import { diagnose } from '../../domain/health/diagnostics.ts';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import {
  JsonEditor,
  type JsonEditorHandle,
  type FindMatch,
} from '../components/advanced/JsonEditor.tsx';
import { JsonTree } from '../components/advanced/JsonTree.tsx';
import { buildJsonTree, createPathResolver } from '../components/advanced/jsonTreeModel.ts';
import { diffJson, type DiffSummary } from '../components/advanced/jsonDiff.ts';

// Advanced / raw JSON editor - the power-user escape hatch for any
// manager/season/shop/quest field that has no dedicated UI. Entry is TRIPLE-GATED
// (warn → confirm → "good luck") because hand-editing the raw save is the easiest way
// to corrupt it. Behind the gate is a CodeMirror-backed mini-IDE: syntax highlighting,
// search (next/prev), code folding, inline JSON + schema lint, a searchable explorer tree,
// prettify/minify, and a "preview changes" diff. On apply the text is JSON-parsed and
// validated against the typed-permissive saveSchema; the LITERAL parsed object is applied
// (not the schema's output) so any untouched/unknown manager round-trips byte-for-byte
//, and the structural diagnosis re-runs so a pasted replacement save is checked.

/** The three entry-gate dialogs, shown in sequence before the editor unlocks. */
const GATES = [
  {
    title: 'Advanced raw editor',
    message:
      'You are about to hand-edit the raw save JSON. This bypasses every safety rail the editor provides. A single wrong value can make the save fail to load in Fallout Shelter.',
    confirmLabel: 'I understand',
  },
  {
    title: 'Are you sure?',
    message:
      'There is no validation beyond a structural check - wrong ids, out-of-range numbers, and broken room layouts will be written exactly as typed. Always keep the auto-backup the editor made on first export.',
    confirmLabel: 'Yes, continue',
  },
  {
    title: 'Last warning',
    message: 'Only proceed if you know the save format. Good luck.',
    confirmLabel: 'Enter the raw editor',
  },
] as const;

const TOOLBAR_BTN =
  'rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800';

export function AdvancedView() {
  const save = useSaveStore((s) => s.save);
  const applyEdit = useSaveStore((s) => s.applyEdit);

  // Triple-gate pass is session state (uiStore) so leaving and returning to the tab does not
  // re-prompt; reading it reactively also means the editor shows immediately on return.
  const unlocked = useUIStore((s) => s.advancedUnlocked);
  const setUnlocked = useUIStore((s) => s.setAdvancedUnlocked);
  const setAdvancedDraft = useUIStore((s) => s.setAdvancedDraft);
  // In-progress editor buffer + place recovered from a prior tab visit. Snapshotted ONCE at
  // mount (non-reactive) - this view owns the draft while mounted and writes it back on
  // unmount. useState (not a ref) so the value is read render-safely.
  const [draftAtMount] = useState(() => useUIStore.getState().advancedDraft);
  // The save reference at mount, used to validate the draft below.
  const [saveAtMount] = useState(save);
  // Restore the draft only if it was derived from the still-current save. If the save changed
  // while we were away (a UI edit elsewhere, undo/redo, a history jump), the draft is stale -
  // discard it and load the live save so the editor reflects those changes.
  const draftValidAtMount =
    draftAtMount !== null && draftAtMount.text !== '' && draftAtMount.baseSave === saveAtMount;

  const [gateStep, setGateStep] = useState(0); // 0 = no dialog; 1..3 = which gate is open
  const [error, setError] = useState<string | null>(null);
  // Bumping this remounts the editor + tree with a fresh snapshot of the current save.
  const [editorKey, setEditorKey] = useState(0);
  const editorRef = useRef<JsonEditorHandle>(null);

  // Serialize once per (save, remount) rather than on every render.
  const saveText = useMemo(
    // stringifyLossless (not JSON.stringify) so the main save's 64-bit DateTime ticks
    // render as exact integer literals in the editor instead of being rounded / boxed.
    () => (save ? stringifyLossless(save, 2) : ''),
    // editorKey forces a fresh snapshot after Revert (which remounts the editor).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [save, editorKey],
  );

  // The document the editor loads: the recovered (valid) draft on the first mount of this view
  // session, otherwise the current save (and always the save after a Revert/resync remount).
  const usingDraft = editorKey === 0 && draftValidAtMount;
  const initialDoc = usingDraft && draftAtMount ? draftAtMount.text : saveText;

  // Debounced mirror of the editor content - drives the explorer tree (rebuilt off the
  // raw text) without re-parsing on every keystroke.
  const [docText, setDocText] = useState(initialDoc);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [caretPath, setCaretPath] = useState<string[] | null>(null);
  // The "preview changes" panel is always shown (collapsed to a few rows); this toggles the
  // full, scrollable list. The diff itself is derived live from the buffer below.
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [treeWidth, setTreeWidth] = useState(320);
  // Below md the fixed-width tree would swallow the whole viewport, hiding the editor; a
  // phone shows ONE pane at a time instead, switched by this toggle (md+ ignores it).
  const [mobilePane, setMobilePane] = useState<'editor' | 'tree'>('editor');

  // Notepad-style "Find all": a results list (line number + line text) at the bottom of the
  // EDITOR column, driven by the top search panel (the single search input). Shows whenever the
  // top search has a query; clicking a row jumps to that match. The panel height is user-
  // draggable (default ~2 rows); the full list scrolls within it.
  const [findQuery, setFindQuery] = useState('');
  const [findResults, setFindResults] = useState<FindMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState(-1);
  const [findHeight, setFindHeight] = useState(88);

  // Live diff of the (debounced) editor buffer vs the current save, so the preview always
  // reflects the pending changes without a manual trigger. null while the buffer isn't valid
  // JSON (mid-edit) - the panel shows a neutral "waiting" note then.
  const livePreview = useMemo((): DiffSummary | null => {
    if (!save) return null;
    let parsed: unknown;
    try {
      parsed = parseLossless(docText);
    } catch {
      return null;
    }
    return diffJson(save, parsed);
  }, [docText, save]);

  // Live snapshot of the editor (buffer + caret + scroll), kept current via the editor's
  // callbacks and written to the session draft when this view unmounts (tab switch). Seeded
  // from the recovered draft so an immediate switch-back without interaction round-trips.
  const liveRef = useRef<Omit<AdvancedDraft, 'baseSave'>>({
    text: initialDoc,
    anchor: usingDraft && draftAtMount ? draftAtMount.anchor : 0,
    head: usingDraft && draftAtMount ? draftAtMount.head : 0,
    scrollTop: usingDraft && draftAtMount ? draftAtMount.scrollTop : 0,
  });
  // The save the current buffer is derived from. Updated by Apply (commits in place) and by
  // the external-resync effect; stamped onto the draft on unmount so staleness can be detected
  // on the next mount. Read/written only outside render (react-hooks/refs).
  const baseSaveRef = useRef<typeof save>(saveAtMount);

  // Caret + scroll to restore on the NEXT editor mount. Seeded from the recovered draft, then
  // refreshed by Revert and the external-resync remount below so reloading the document NEVER
  // throws the user to the top - the viewport/caret is preserved across remounts. The user
  // controls where they are working, not the editor.
  const [restorePlace, setRestorePlace] = useState<{
    anchor: number;
    head: number;
    scrollTop: number;
  } | null>(() =>
    usingDraft && draftAtMount
      ? { anchor: draftAtMount.anchor, head: draftAtMount.head, scrollTop: draftAtMount.scrollTop }
      : null,
  );

  // Reset derived/preview state when a fresh document is loaded into the editor via a remount
  // (Revert, or the external-resync effect below). Keyed on editorKey only - Apply does NOT
  // remount, so it keeps the user's place. React's "adjust state during render" pattern,
  // preferred over a setState-in-effect which cascades an extra render.
  const [loadedKey, setLoadedKey] = useState(editorKey);
  if (loadedKey !== editorKey) {
    setLoadedKey(editorKey);
    setDocText(saveText);
    setCaretPath(null);
  }

  const handleDocChange = useCallback((next: string) => {
    liveRef.current.text = next;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDocText(next), 250);
  }, []);
  const handleSelectionChange = useCallback((sel: { anchor: number; head: number }) => {
    liveRef.current.anchor = sel.anchor;
    liveRef.current.head = sel.head;
  }, []);
  const handleScroll = useCallback((scrollTop: number) => {
    liveRef.current.scrollTop = scrollTop;
  }, []);
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // The bottom Find-all list is fed entirely by the top search panel (single search input).
  const handleSearchResults = useCallback((query: string, matches: FindMatch[]): void => {
    setFindQuery(query);
    setFindResults(matches);
    setActiveMatch(-1);
  }, []);
  // Jump to a result and mark it active (explicit click → select + focus the editor).
  const goToMatch = useCallback(
    (i: number): void => {
      const m = findResults[i];
      if (!m) return;
      setActiveMatch(i);
      editorRef.current?.reveal(m.from, m.to);
    },
    [findResults],
  );

  // Keep the editor in sync with the live save. When the save changes from OUTSIDE this editor
  // - a value edited elsewhere in the UI, undo/redo, or a history jump - remount the editor so
  // it reloads the new save. Apply commits in place and updates baseSaveRef first, so it is
  // not treated as external here (the early return). Effects may read/write refs.
  useEffect(() => {
    if (save === baseSaveRef.current) return;
    baseSaveRef.current = save;
    // Only the document reloads - keep the user's caret + scroll so the viewport never jumps to
    // the top (clamped to the new doc on mount). The user controls their location.
    const place = liveRef.current;
    setRestorePlace({ anchor: place.anchor, head: place.head, scrollTop: place.scrollTop });
    liveRef.current = {
      text: saveText,
      anchor: place.anchor,
      head: place.head,
      scrollTop: place.scrollTop,
    };
    setEditorKey((k) => k + 1);
  }, [save, saveText]);

  // Persist the in-progress buffer + place on unmount (tab switch) so returning restores it.
  // An empty buffer (no-save state) is never persisted, so it can't shadow a save loaded later;
  // baseSave stamps which save the buffer came from so a stale draft is dropped on return.
  useEffect(
    () => () => {
      const base = baseSaveRef.current;
      if (liveRef.current.text !== '' && base) {
        setAdvancedDraft({ ...liveRef.current, baseSave: base });
      }
    },
    [setAdvancedDraft],
  );

  const onApply = useCallback((): void => {
    const raw = editorRef.current?.getValue() ?? '';
    let parsed: unknown;
    try {
      parsed = parseLossless(raw);
    } catch (e) {
      setError(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const result = saveSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .slice(0, 8)
        .map((i) => `• ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
      setError(`Validation failed:\n${issues}`);
      return;
    }
    setError(null);
    // Apply the literal parsed object so unknown/untouched managers round-trip exactly.
    const next = parsed as SaveData;
    applyEdit(() => next, 'Raw JSON edit');
    // Commit IN PLACE - do NOT remount the editor. The buffer already holds the applied text,
    // so reloading would only throw the user to the top and wipe their caret/scroll/folds.
    // Advance the base to the new save so the resync effect treats this as our own edit (not
    // external) and stays quiet. The live preview re-derives itself (buffer now matches save),
    // and the live snapshot already tracks the unchanged buffer + place.
    baseSaveRef.current = next;
    // Re-run structural diagnosis (esp. after pasting a whole new save) - mirrors import.
    const found = diagnose(next);
    if (found.length > 0) {
      const affected = found.reduce((n, d) => n + d.count, 0);
      const types = `${found.length} structural issue${found.length === 1 ? '' : 's'}`;
      pushToast(
        `Raw edit applied. ${types} found (${affected} affected). See the Vault tab.`,
        'info',
      );
    } else {
      pushToast('Raw edit applied');
    }
  }, [applyEdit]);

  // Ctrl/Cmd+S applies the buffer to the save (same as the Apply button) and suppresses the
  // browser's save-page dialog. Active only once the editor is unlocked; fires regardless of which
  // Advanced-tab element has focus (the editor, the tree search, etc.).
  useEffect(() => {
    if (!unlocked) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onApply();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [unlocked, onApply]);

  const tree = useMemo(() => buildJsonTree(docText), [docText]);

  // Map the save schema's zod issues onto their text spans for inline lint markers.
  const schemaLint = useCallback((src: string): Diagnostic[] => {
    let parsed: unknown;
    try {
      parsed = parseLossless(src);
    } catch {
      return []; // pure parse errors are handled by the JSON parse linter
    }
    const result = saveSchema.safeParse(parsed);
    if (result.success) return [];
    const resolver = createPathResolver(src);
    return result.error.issues.slice(0, 50).map((issue) => {
      const path = issue.path.filter(
        (p): p is string | number => typeof p === 'string' || typeof p === 'number',
      );
      const span = resolver.resolve(path) ?? { from: 0, to: Math.min(1, src.length) };
      return {
        from: span.from,
        to: span.to,
        severity: 'error' as const,
        message: `${path.join('.') || '(root)'}: ${issue.message}`,
      };
    });
  }, []);

  // Resizable divider between the explorer and the editor. Pointer events (with capture)
  // so the drag works with mouse, pen, AND touch.
  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = treeWidth;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent): void => {
      const w = Math.min(640, Math.max(200, startW + (ev.clientX - startX)));
      setTreeWidth(w);
    };
    const onUp = (ev: PointerEvent): void => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  };

  // Drag the Find-all panel's top edge to resize its height (up = taller).
  const startFindResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = findHeight;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent): void => {
      const h = Math.min(480, Math.max(48, startH + (startY - ev.clientY)));
      setFindHeight(h);
    };
    const onUp = (ev: PointerEvent): void => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  };

  if (!save) {
    return <div className="p-6 text-sm text-neutral-400">No save loaded.</div>;
  }

  const startGate = (): void => {
    setError(null);
    setGateStep(1);
  };
  const advanceGate = (): void => {
    if (gateStep >= GATES.length) {
      setUnlocked(true);
      setGateStep(0);
    } else {
      setGateStep(gateStep + 1);
    }
  };

  const onRevert = (): void => {
    setError(null);
    // Discard in-progress edits - reload from the current save, but keep the user's caret + scroll
    // so Revert reloads the content in place rather than throwing them to the top.
    const place = liveRef.current;
    setRestorePlace({ anchor: place.anchor, head: place.head, scrollTop: place.scrollTop });
    liveRef.current = {
      text: saveText,
      anchor: place.anchor,
      head: place.head,
      scrollTop: place.scrollTop,
    };
    setEditorKey((k) => k + 1);
  };

  const onFormat = (): void => {
    if (editorRef.current?.format() === false) {
      pushToast('Cannot format - the document is not valid JSON', 'info');
    }
  };
  const onMinify = (): void => {
    if (editorRef.current?.minify() === false) {
      pushToast('Cannot minify - the document is not valid JSON', 'info');
    }
  };

  return (
    // On phones the toolbar/preview stack can be taller than the screen and would crush the
    // editor split to zero height - let the page scroll and give the split a real height
    // below md (mirrors the Rooms grid pane fix).
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4 md:overflow-y-visible md:p-6">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">Advanced</h2>
        <span className="text-sm text-neutral-400">raw JSON editor</span>
      </div>

      {!unlocked ? (
        <div className="max-w-xl space-y-4 rounded border border-red-900/50 bg-red-950/20 p-5">
          <p className="text-sm text-neutral-300">
            The raw editor lets you change any field in the save directly - managers, season and
            shop state, quests, and anything else without a dedicated screen. It is unguarded and
            can corrupt the save.
          </p>
          <button
            type="button"
            onClick={startGate}
            className="rounded border border-red-700 bg-red-900/30 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-900/50"
          >
            Enter the raw editor…
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onApply}
              className="rounded bg-amber-500 px-4 py-1.5 text-sm font-medium text-neutral-900 hover:bg-amber-400"
            >
              Apply (validate &amp; write)
            </button>
            <button type="button" onClick={onFormat} className={TOOLBAR_BTN}>
              Prettify
            </button>
            <button type="button" onClick={onMinify} className={TOOLBAR_BTN}>
              Minify
            </button>
            <button
              type="button"
              onClick={() => editorRef.current?.toggleSearch()}
              className={TOOLBAR_BTN}
            >
              Find…
            </button>
            <button type="button" onClick={onRevert} className={TOOLBAR_BTN}>
              Revert
            </button>
            <span className="text-xs text-neutral-400">
              Validated against the typed-permissive model; unknown managers round-trip unchanged.
              One Apply = one undo step.
            </span>
          </div>

          {/* Breadcrumb of the caret's structural location. */}
          <div className="flex h-4 shrink-0 items-center gap-1 overflow-hidden text-xs text-neutral-500">
            {caretPath && caretPath.length > 0 ? (
              caretPath.map((seg, i) => (
                <span key={`${seg}-${i}`} className="shrink-0">
                  {i > 0 && <span className="mx-1 text-neutral-700">›</span>}
                  <span className={i === caretPath.length - 1 ? 'text-neutral-300' : ''}>
                    {seg}
                  </span>
                </span>
              ))
            ) : (
              <span className="text-neutral-700">root</span>
            )}
          </div>

          {error && (
            <pre
              role="alert"
              className="max-h-40 shrink-0 overflow-auto whitespace-pre-wrap rounded border border-red-800 bg-red-950/40 p-3 text-xs text-red-300"
            >
              {error}
            </pre>
          )}

          {/* Live "preview changes" - always shown, collapsed to the first rows; the toolbar
              "Preview changes" button (or the toggle here) expands the full, scrollable list. */}
          {(() => {
            const COLLAPSED_ROWS = 3;
            const changes = livePreview?.changes ?? [];
            const visible = previewExpanded ? changes : changes.slice(0, COLLAPSED_ROWS);
            const hidden = changes.length - visible.length + (livePreview?.truncated ?? 0);
            return (
              <div
                className={`${previewExpanded ? 'max-h-48 overflow-auto' : ''} shrink-0 rounded border border-neutral-700 bg-neutral-900/60 p-3 text-xs`}
              >
                <div className="mb-2 flex items-center gap-3 text-neutral-300">
                  <span className="font-medium">Changes vs current save:</span>
                  {livePreview ? (
                    <>
                      <span className="text-green-400">+{livePreview.added} added</span>
                      <span className="text-amber-300">~{livePreview.changed} changed</span>
                      <span className="text-red-400">-{livePreview.removed} removed</span>
                    </>
                  ) : (
                    <span className="text-neutral-500">preview resumes when the JSON is valid</span>
                  )}
                  {(previewExpanded || hidden > 0) && (
                    <button
                      type="button"
                      onClick={() => setPreviewExpanded((v) => !v)}
                      className="ml-auto rounded px-2 py-0.5 text-neutral-400 hover:bg-neutral-800"
                    >
                      {previewExpanded ? 'Show less' : `Show all (${hidden} more)`}
                    </button>
                  )}
                </div>
                {livePreview && changes.length === 0 ? (
                  <p className="text-neutral-500">
                    No changes - the document matches the loaded save.
                  </p>
                ) : (
                  <ul className="space-y-0.5 font-mono">
                    {visible.map((c, i) => (
                      <li key={`${c.path}-${i}`} className="flex gap-2">
                        <span
                          className={
                            c.kind === 'added'
                              ? 'text-green-400'
                              : c.kind === 'removed'
                                ? 'text-red-400'
                                : 'text-amber-300'
                          }
                        >
                          {c.kind === 'added' ? '+' : c.kind === 'removed' ? '-' : '~'}
                        </span>
                        <span className="text-neutral-400">{c.path}</span>
                        <span className="truncate text-neutral-500">
                          {c.kind === 'changed'
                            ? `${c.before} → ${c.after}`
                            : (c.after ?? c.before ?? '')}
                        </span>
                      </li>
                    ))}
                    {previewExpanded && (livePreview?.truncated ?? 0) > 0 && (
                      <li className="text-neutral-600">…and {livePreview?.truncated} more</li>
                    )}
                  </ul>
                )}
              </div>
            );
          })()}

          {/* Phone-only pane switch: the split below shows one pane at a time under md. */}
          <div className="flex gap-1 md:hidden" role="tablist" aria-label="Editor pane">
            {(['editor', 'tree'] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={mobilePane === p}
                onClick={() => setMobilePane(p)}
                className={`rounded px-3 py-1.5 text-sm ${
                  mobilePane === p
                    ? 'bg-neutral-800 font-medium text-amber-300'
                    : 'text-neutral-400 hover:text-neutral-100'
                }`}
              >
                {p === 'editor' ? 'JSON editor' : 'Explorer tree'}
              </button>
            ))}
          </div>

          <div className="flex min-h-[70vh] flex-1 overflow-hidden rounded border border-neutral-800 md:min-h-0">
            <aside
              style={{ '--tree-w': `${treeWidth}px` } as React.CSSProperties}
              className={`min-h-0 w-full shrink-0 border-neutral-800 md:block md:w-[var(--tree-w)] md:border-r ${
                mobilePane === 'tree' ? 'block' : 'hidden'
              }`}
            >
              <JsonTree tree={tree} onPeek={(from, to) => editorRef.current?.peek(from, to)} />
            </aside>
            <div
              onPointerDown={startResize}
              role="separator"
              aria-orientation="vertical"
              className="hidden w-1 shrink-0 cursor-col-resize touch-none bg-neutral-800 hover:bg-amber-500/50 md:block"
            />
            <div
              className={`min-h-0 min-w-0 flex-1 flex-col md:flex ${
                mobilePane === 'editor' ? 'flex' : 'hidden'
              }`}
            >
              <div className="min-h-0 flex-1">
                <JsonEditor
                  key={editorKey}
                  ref={editorRef}
                  initialDoc={initialDoc}
                  {...(restorePlace && {
                    initialSelection: { anchor: restorePlace.anchor, head: restorePlace.head },
                    initialScrollTop: restorePlace.scrollTop,
                  })}
                  onDocChange={handleDocChange}
                  onPathChange={setCaretPath}
                  onSelectionChange={handleSelectionChange}
                  onScroll={handleScroll}
                  onSearchResults={handleSearchResults}
                  schemaLint={schemaLint}
                />
              </div>

              {/* Find-all results, driven by the top search panel. Lives INSIDE the editor column
                  so the tree spans full height. Drag the top edge to resize; list scrolls within. */}
              {findQuery !== '' && (
                <div
                  style={{ height: findHeight }}
                  className="flex shrink-0 flex-col border-t border-neutral-700 bg-neutral-900/60 text-xs"
                >
                  <div
                    onPointerDown={startFindResize}
                    role="separator"
                    aria-orientation="horizontal"
                    className="h-1 shrink-0 cursor-row-resize touch-none bg-neutral-800 hover:bg-amber-500/50"
                  />
                  <div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-2 py-1 text-neutral-300">
                    <span className="font-medium">Find all:</span>
                    <span className="truncate font-mono text-neutral-400">{findQuery}</span>
                    <span className="shrink-0 tabular-nums text-[11px] text-neutral-400">
                      {findResults.length} {findResults.length === 1 ? 'match' : 'matches'}
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto">
                    {findResults.length === 0 ? (
                      <p className="p-2 text-neutral-500">No matches.</p>
                    ) : (
                      <ul className="font-mono">
                        {findResults.map((m, i) => (
                          <li key={`${m.from}-${i}`}>
                            <button
                              type="button"
                              onClick={() => goToMatch(i)}
                              className={`flex w-full items-baseline gap-2 px-2 py-0.5 text-left hover:bg-neutral-800 ${
                                activeMatch === i ? 'bg-neutral-800' : ''
                              }`}
                            >
                              <span className="w-12 shrink-0 tabular-nums text-neutral-500">
                                L{m.line}
                              </span>
                              <span className="truncate text-neutral-300">{m.lineText.trim()}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {gateStep > 0 && (
        <ConfirmDialog
          open
          destructive
          title={GATES[gateStep - 1].title}
          message={GATES[gateStep - 1].message}
          confirmLabel={GATES[gateStep - 1].confirmLabel}
          cancelLabel="Back to safety"
          onConfirm={advanceGate}
          onCancel={() => setGateStep(0)}
        />
      )}
    </div>
  );
}
