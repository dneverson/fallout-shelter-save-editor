import { useState } from 'react';
import { SEASON_FILE_NAMES } from '../../../domain/codec/platformTargets.ts';
import { SourcePicker } from '../SourcePicker.tsx';
import { WheresMyFile } from './WheresMyFile.tsx';

// Season Pass onboarding: the user picks a SOURCE for the season
// working model. Upload their real `spd.dat` (+ optional `nvf.dat`) to recover/edit actual
// progress, or build a fresh season pass from the static catalog (nothing claimed). Both land in
// the same workspace and both can be downloaded afterwards. The layout is the shared SourcePicker
// so this stays visually identical to the Import landing. The `.sav` is already loaded (the app
// gates the section behind it), so this is purely the season-file choice.

interface SeasonOnboardingProps {
  /** Load uploaded season files into the working model (store.loadSeasonFromText). */
  onUpload: (spdText: string, nvfText: string | null, fileName: string) => Promise<void>;
  /** Build a fresh editable model from the catalog (store.startSeasonFromCatalog). */
  onContinue: () => void;
  /** False until the static catalog is loaded - gates the "Continue" card. */
  canContinue: boolean;
  /** Set when the catalog failed to load (the "Continue" path is then unavailable). */
  catalogError: string | null;
}

export function SeasonOnboarding({
  onUpload,
  onContinue,
  canContinue,
  catalogError,
}: SeasonOnboardingProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = async (files: FileList): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const list = Array.from(files);
      // Route by name: the season pointer is nvf.dat; everything else is treated as the spd.
      const nvfFile = list.find((f) => f.name.toLowerCase().includes('nvf')) ?? null;
      const spdFile = list.find((f) => f !== nvfFile) ?? null;
      if (!spdFile) {
        setError(`Select your ${SEASON_FILE_NAMES.spd} (and optionally ${SEASON_FILE_NAMES.nvf}).`);
        return;
      }
      const spdText = await spdFile.text();
      const nvfText = nvfFile ? await nvfFile.text() : null;
      await onUpload(spdText, nvfText, spdFile.name);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't read that file. Is it a real ${SEASON_FILE_NAMES.spd}? (${e.message})`
          : 'Failed to read the season file.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SourcePicker
      title="Season Pass"
      description={
        <>
          Recover season-pass rewards into your vault, or build a season pass from scratch. Either
          way you can download an updated{' '}
          <code className="text-neutral-300">{SEASON_FILE_NAMES.spd}</code> and{' '}
          <code className="text-neutral-300">{SEASON_FILE_NAMES.nvf}</code> when you&apos;re done.
        </>
      }
      uploadTitle="Use an existing file"
      uploadDescription={
        <>
          Load your real season-pass state: levels, premium, and what you&apos;ve already claimed.
          Add <code className="text-neutral-300">{SEASON_FILE_NAMES.nvf}</code> too to keep the
          active-season pointer in sync.
        </>
      }
      uploadHint={
        <>
          Or drag and drop <code className="text-neutral-400">{SEASON_FILE_NAMES.spd}</code> (and{' '}
          <code className="text-neutral-400">{SEASON_FILE_NAMES.nvf}</code>) onto this card.
        </>
      }
      uploadButtonLabel="Choose .dat file(s)"
      accept=".dat"
      multiple
      busy={busy}
      onFiles={(files) => void loadFiles(files)}
      prebuiltTitle="No file? Build one"
      prebuiltDescription={
        <>
          Generates a genuine season pass: every season, nothing claimed, level 1, no premium. Fully
          editable, and downloadable as a real{' '}
          <code className="text-neutral-300">{SEASON_FILE_NAMES.spd}</code> for the game.
        </>
      }
      prebuiltButtonLabel={canContinue ? 'Continue' : 'Loading catalog…'}
      prebuiltDisabled={!canContinue}
      onPrebuilt={onContinue}
      prebuiltError={catalogError ? `Catalog unavailable: ${catalogError}` : null}
      error={error}
      help={<WheresMyFile variant="season" />}
    />
  );
}
