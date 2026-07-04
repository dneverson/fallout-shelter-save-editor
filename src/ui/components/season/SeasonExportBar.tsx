import { useSaveStore } from '../../../state/saveStore.ts';
import { useUIStore } from '../../../state/uiStore.ts';
import { SEASON_FILE_NAMES } from '../../../domain/codec/platformTargets.ts';

// Season-tab export entry point. It does NOT export on its own - a single
// "Export" button opens the one shared export chooser (ExportDialog) that the TopBar uses, so
// the season files, the vault `.sav`, the backup and the where-to-put-them help all live in one
// consistent place. This bar just shows what's being worked on and reminds the user to keep a
// backup before the dialog takes over.

export function SeasonExportBar() {
  const fileName = useSaveStore((s) => s.fileName) ?? 'Vault1.sav';
  const seasonSource = useSaveStore((s) => s.seasonSource);
  const seasonFileName = useSaveStore((s) => s.seasonFileName);
  const openExport = useUIStore((s) => s.openExport);

  const source =
    seasonSource === 'file'
      ? `Editing ${seasonFileName ?? SEASON_FILE_NAMES.spd}`
      : 'New season pass (from catalog)';

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <p className="text-neutral-200">{source}</p>
          <p className="mt-0.5 text-xs text-neutral-400">
            Saves into vault <code className="text-neutral-300">{fileName}</code> +{' '}
            <code className="text-neutral-300">{SEASON_FILE_NAMES.spd}</code> /{' '}
            <code className="text-neutral-300">{SEASON_FILE_NAMES.nvf}</code>.
          </p>
        </div>

        <button
          type="button"
          onClick={openExport}
          className="rounded bg-amber-500 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-amber-400"
        >
          Export
        </button>
      </div>

      <p className="mt-3 rounded border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300/90">
        Keep a backup of your original files before replacing them. The season files must sit in the
        same folder as your <code className="text-amber-200">{fileName}</code>. Steam Cloud can
        silently overwrite local edits - close the game and disable its cloud sync first.
      </p>
    </div>
  );
}
