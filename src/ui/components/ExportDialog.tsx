import { useMemo, useState } from 'react';
import { useSaveStore } from '../../state/saveStore.ts';
import { useUIStore } from '../../state/uiStore.ts';
import { summarizeChanges } from '../../domain/diff/changeSummary.ts';
import { type PlatformId } from '../../domain/codec/platformTargets.ts';
import { canSaveInPlace, downloadText, fileTimestamp, saveText } from '../lib/download.ts';
import { ChangeReviewDialog } from './ChangeReviewDialog.tsx';

// The single, shared export mechanism for the whole app. Both the TopBar
// "Export" button and the Season tab's "Export" button open THIS one dialog via the uiStore
// `exportOpen` flag - there is no second export path. It owns the per-file selection, the
// platform target, and the actual write (backup + `.sav` + season pair), and renders the
// plain-language `ChangeReviewDialog`. Mounted once (in TopBar) so it's available app-wide.
//
// The gate below mounts the body only while open, so the body's state initializers run fresh
// every time the dialog opens - defaulting the file selection without a reset effect.

export function ExportDialog() {
  const open = useUIStore((s) => s.exportOpen);
  if (!open) return null;
  return <ExportDialogBody />;
}

function ExportDialogBody() {
  const close = useUIStore((s) => s.closeExport);

  const save = useSaveStore((s) => s.save);
  const originalSave = useSaveStore((s) => s.originalSave);
  const fileName = useSaveStore((s) => s.fileName);
  const health = useSaveStore((s) => s.health);
  const originalSavText = useSaveStore((s) => s.originalSavText);
  const isSandbox = useSaveStore((s) => s.isSandbox);
  const seasonEdited = useSaveStore((s) => s.seasonEdited);

  const hasOriginal = originalSavText !== null;
  const canBackup = hasOriginal && !isSandbox;
  const saveInPlaceSupported = canSaveInPlace();

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<PlatformId>('pc');
  // Defaults captured at open (fresh mount): vault save on, the season pair on only when there
  // were season edits, and the safety backup on whenever there's an original to protect.
  const [includeSav, setIncludeSav] = useState(true);
  const [includeSeason, setIncludeSeason] = useState(seasonEdited);
  const [includeBackup, setIncludeBackup] = useState(canBackup);

  const summary = useMemo(
    () => (originalSave && save ? summarizeChanges(originalSave, save) : null),
    [originalSave, save],
  );

  const handleExport = async (): Promise<void> => {
    setExporting(true);
    setExportError(null);
    try {
      const store = useSaveStore.getState();
      const name = store.fileName ?? 'Vault1.sav';
      const base = name.replace(/\.sav$/i, '');
      const backupEligible = store.originalSavText !== null && !store.isSandbox;

      // The `.sav` is the one in-place-eligible file: a single click can only drive ONE
      // native save picker (it consumes transient activation), so the `.sav` takes it and
      // every other selected file is emitted as a plain download. Do the `.sav` first, while
      // the user gesture is freshest. A cancelled picker aborts the whole export.
      if (includeSav) {
        const text = await store.exportSavText();
        const result = await saveText(name, text);
        if (result.cancelled) return; // user dismissed the native picker - keep dialog open
      }

      // Timestamped download of the untouched original - always a download, so the backup
      // guarantee holds even when the `.sav` was overwritten in place.
      if (includeBackup && backupEligible && store.originalSavText) {
        downloadText(`${base}.backup-${fileTimestamp()}.sav`, store.originalSavText);
        store.markBackupDownloaded();
      }

      // Season files travel as a pair so `spd.dat` and its `nvf.dat` pointer stay in sync.
      if (includeSeason && store.seasonEdited) {
        downloadText('spd.dat', await store.exportSeasonText());
        downloadText('nvf.dat', await store.exportNvfText());
      }

      close();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <ChangeReviewDialog
      open
      onClose={close}
      onConfirm={() => void handleExport()}
      summary={summary}
      health={health}
      exporting={exporting}
      error={exportError}
      fileName={fileName ?? 'Vault1.sav'}
      includeSav={includeSav}
      onIncludeSavChange={setIncludeSav}
      seasonEdited={seasonEdited}
      includeSeason={includeSeason}
      onIncludeSeasonChange={setIncludeSeason}
      isSandbox={isSandbox}
      hasOriginal={hasOriginal}
      includeBackup={includeBackup}
      onIncludeBackupChange={setIncludeBackup}
      platform={platform}
      onPlatformChange={setPlatform}
      saveInPlaceSupported={saveInPlaceSupported}
    />
  );
}
