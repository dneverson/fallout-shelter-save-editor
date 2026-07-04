import { PLATFORM_TARGETS, SEASON_FILE_NAMES } from '../../../domain/codec/platformTargets.ts';

// "Where's my file?" help, always shown (no collapse). Every path here is DERIVED from the
// single platform-paths source (platformTargets.ts `basePath` + the shared `SEASON_FILE_NAMES`),
// so this help and the export dialog's placement copy can never drift.
// Used by both the Import landing (variant="save") and the Season onboarding (variant="season").
// Confirmed vs community-reported platforms are marked honestly, with the Steam-Cloud-overwrite
// and console/iOS-inaccessible caveats.

interface WheresMyFileProps {
  /** "save" describes where Vault<N>.sav lives; "season" describes the two .dat files. */
  variant?: 'save' | 'season';
}

export function WheresMyFile({ variant = 'season' }: WheresMyFileProps) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 text-sm">
      <div className="border-b border-neutral-800 px-4 py-3 font-medium text-neutral-200">
        Where&apos;s my file?
      </div>
      <div className="px-4 py-3">
        <p className="text-xs text-neutral-400">
          {variant === 'save' ? (
            <>
              Your <code className="text-neutral-300">Vault&lt;N&gt;.sav</code> lives in Fallout
              Shelter&apos;s save folder, one folder per platform:
            </>
          ) : (
            <>
              The season files <code className="text-neutral-300">{SEASON_FILE_NAMES.spd}</code> and{' '}
              <code className="text-neutral-300">{SEASON_FILE_NAMES.nvf}</code> live in the same
              folder as your <code className="text-neutral-300">Vault&lt;N&gt;.sav</code>, one
              folder per platform:
            </>
          )}
        </p>

        <ul className="mt-3 flex flex-col gap-2">
          {PLATFORM_TARGETS.map((p) => (
            <li key={p.id} className="rounded bg-neutral-950/60 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-neutral-200">{p.label}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                    p.verified
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {p.verified ? 'confirmed' : 'community-reported'}
                </span>
              </div>
              <code className="mt-1 block break-all text-xs text-neutral-300">{p.basePath}</code>
              {p.note && <p className="mt-1 text-xs text-neutral-500">{p.note}</p>}
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs text-amber-400">
          Steam Cloud can silently overwrite local edits. Close the game and disable its cloud sync
          for Fallout Shelter before replacing files. Console (Switch, Xbox) and iOS saves are often
          not user-accessible without device-specific tools.
        </p>
      </div>
    </div>
  );
}
