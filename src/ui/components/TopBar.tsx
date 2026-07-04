import { useEffect, useState } from 'react';
import {
  selectCanRedo,
  selectCanUndo,
  selectRedoLabel,
  selectUndoLabel,
  useSaveStore,
} from '../../state/saveStore.ts';
import { useUIStore } from '../../state/uiStore.ts';
import { ExportDialog } from './ExportDialog.tsx';
import { HistoryPanel } from './HistoryPanel.tsx';
import { CreditsDialog } from './CreditsDialog.tsx';
import { SupportDialog } from './SupportDialog.tsx';
import { REPO_URL } from '../lib/links.ts';

// Global top bar: file identity, edit state, undo/redo, and export. The
// "Export" button opens the one shared export chooser (ExportDialog, mounted here) - the
// same dialog the Season tab opens, so there is a single export mechanism app-wide. Undo/redo
// are also bound to Ctrl/Cmd+Z and Ctrl/Cmd+Y / Shift+Z.

const BTN =
  'rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent';

const ICON_LINK =
  'flex h-8 w-8 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100';

/** GitHub mark (octocat) as an inline path, sized by the parent. */
function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Sponsor heart. */
function HeartIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M8 14.25 6.85 13.2C2.7 9.44.9 7.79.9 5.5.9 3.64 2.36 2.2 4.2 2.2c1.04 0 2.05.49 2.7 1.26L8 4.75l1.1-1.29c.65-.77 1.66-1.26 2.7-1.26 1.84 0 3.3 1.44 3.3 3.3 0 2.29-1.8 3.94-5.95 7.7L8 14.25z" />
    </svg>
  );
}

export function TopBar() {
  const status = useSaveStore((s) => s.status);
  const fileName = useSaveStore((s) => s.fileName);
  const metadata = useSaveStore((s) => s.health?.metadata ?? null);
  const edited = useSaveStore((s) => s.past.length > 0);
  const canUndo = useSaveStore(selectCanUndo);
  const canRedo = useSaveStore(selectCanRedo);
  const undoLabel = useSaveStore(selectUndoLabel);
  const redoLabel = useSaveStore(selectRedoLabel);
  const undo = useSaveStore((s) => s.undo);
  const redo = useSaveStore((s) => s.redo);
  const clear = useSaveStore((s) => s.clear);
  const openExport = useUIStore((s) => s.openExport);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const hasSave = status === 'loaded';

  useEffect(() => {
    if (!hasSave) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // The Advanced raw editor (CodeMirror) keeps its own undo/redo history. Let Ctrl+Z/Y act on
      // that text buffer when focus is inside it, rather than firing an app-wide save undo - which
      // would remount the editor and discard the in-progress buffer.
      if (e.target instanceof Element && e.target.closest('.cm-editor')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasSave, undo, redo]);

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-neutral-800 px-4 py-2">
      <h1 className="flex items-end gap-1.5 text-base font-semibold text-neutral-100">
        <span>Fallout Shelter Save Editor</span>
        <span className="text-xs font-normal text-neutral-500">v{__APP_VERSION__}</span>
      </h1>

      {hasSave && (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <span className="hidden text-neutral-200 sm:inline">{fileName}</span>
          {metadata && (
            <span className="hidden text-neutral-400 lg:inline">
              · Vault {metadata.vaultName} · {metadata.dwellerCount} dwellers
            </span>
          )}
          {edited && <span className="text-amber-400">● unsaved changes</span>}
        </div>
      )}

      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          title="Source and README on GitHub"
          aria-label="GitHub repository"
          className={ICON_LINK}
        >
          <GitHubIcon />
        </a>
        <button
          type="button"
          onClick={() => setSupportOpen(true)}
          title="Enjoying the editor? Support the developer"
          aria-label="Support the developer"
          className="flex h-8 items-center gap-1.5 rounded px-2 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-pink-400"
        >
          <HeartIcon />
          <span>Support</span>
        </button>
        <button
          type="button"
          onClick={() => setCreditsOpen(true)}
          title="Credits: the projects that inspired this editor"
          className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          Credits
        </button>

        {hasSave && (
          <>
            <button
              type="button"
              className={BTN}
              onClick={undo}
              disabled={!canUndo}
              title={canUndo ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
            >
              Undo
            </button>
            <button
              type="button"
              className={BTN}
              onClick={redo}
              disabled={!canRedo}
              title={canRedo ? `Redo: ${redoLabel} (Ctrl+Y)` : 'Nothing to redo'}
            >
              Redo
            </button>
            <button
              type="button"
              className={BTN}
              onClick={() => setHistoryOpen(true)}
              title="Edit history - jump to any prior point"
            >
              History
            </button>
            <button type="button" className={BTN} onClick={clear}>
              Load file
            </button>
            <button
              type="button"
              onClick={openExport}
              className="rounded bg-amber-500 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              Export
            </button>
          </>
        )}
      </div>

      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <ExportDialog />
      {creditsOpen && <CreditsDialog onClose={() => setCreditsOpen(false)} />}
      {supportOpen && <SupportDialog onClose={() => setSupportOpen(false)} />}
    </header>
  );
}
