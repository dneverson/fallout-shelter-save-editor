import { useSaveStore } from '../../state/saveStore.ts';
import { SourcePicker } from '../components/SourcePicker.tsx';
import { WheresMyFile } from '../components/season/WheresMyFile.tsx';

// Import landing: pick an existing `.sav` (drag-drop or picker) or start from a
// prebuilt sandbox vault. Both land in the same editable workspace and both download as a real
// `.sav`. Uses the shared SourcePicker so it stays visually identical to the Season onboarding.
export function ImportView() {
  const importFromText = useSaveStore((s) => s.importFromText);
  const importBaseline = useSaveStore((s) => s.importBaseline);
  const status = useSaveStore((s) => s.status);
  const error = useSaveStore((s) => s.error);

  const loadFiles = async (files: FileList) => {
    const file = files[0];
    if (file) await importFromText(await file.text(), file.name);
  };

  return (
    <SourcePicker
      title="Open a save"
      description="Edit an existing Fallout Shelter vault, or start from a prebuilt sandbox vault. Either way you get a real, downloadable .sav. It never leaves your machine."
      uploadTitle="Use an existing file"
      uploadDescription={
        <>
          Usually <code className="text-neutral-300">Vault1.sav</code>. The game&apos;s{' '}
          <code className="text-neutral-300">.sav.bkp</code> backup and this editor&apos;s own{' '}
          <code className="text-neutral-300">.backup-*.sav</code> files load too.
        </>
      }
      uploadHint={
        <>
          Or drag and drop a <code className="text-neutral-400">.sav</code> onto this card.
        </>
      }
      uploadButtonLabel="Choose .sav file"
      accept=".sav,.bkp"
      busy={status === 'loading'}
      onFiles={(files) => void loadFiles(files)}
      prebuiltTitle="No file? Build one"
      prebuiltDescription="Generates a genuine, fully-editable new-game vault you can edit and download for the real game. Handy for the Season Pass tab too."
      prebuiltButtonLabel="Start fresh / sandbox"
      prebuiltDisabled={status === 'loading'}
      onPrebuilt={() => void importBaseline()}
      error={status === 'error' ? error : null}
      help={<WheresMyFile variant="save" />}
    />
  );
}
