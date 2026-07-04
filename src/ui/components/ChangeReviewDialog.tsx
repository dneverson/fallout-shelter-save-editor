import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { MODAL_LARGE } from '../lib/modalClasses.ts';
import type { ChangeSummary } from '../../domain/diff/changeSummary.ts';
import type { HealthReport } from '../../domain/health/healthCheck.ts';
import {
  PLATFORM_TARGETS,
  platformTarget,
  type PlatformId,
} from '../../domain/codec/platformTargets.ts';

// Pre-export change-review dialog + multi-file export chooser. Shown when the user
// hits Export: a plain-language summary of every
// change vs the imported original, plus the health report, plus an independent checkbox
// per output file - the vault `.sav`, the season pair (`spd.dat` + `nvf.dat`, only when
// season data was edited), and the safety backup of the untouched original (opt-out-able,
// but default on) - under one "Select everything" master toggle. The copy assumes a
// non-technical user: files are named by what they ARE and why they matter, with concrete,
// step-by-step guidance on where they go and how to undo a bad edit. Confirm runs the actual
// backup + export (owned by the caller, ExportDialog).

interface ChangeReviewDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  summary: ChangeSummary | null;
  health: HealthReport | null;
  exporting: boolean;
  error: string | null;
  /** The working `.sav` file name, e.g. "Vault1.sav" - used in placement/revert copy. */
  fileName: string;

  // --- File chooser (each output is an independent, defaulted-on-but-optional file) ---
  includeSav: boolean;
  onIncludeSavChange: (value: boolean) => void;
  /** True when season data was edited - gates whether the `spd.dat`/`nvf.dat` row is offered. */
  seasonEdited: boolean;
  includeSeason: boolean;
  onIncludeSeasonChange: (value: boolean) => void;
  /** True for the bundled sandbox save - there is no user original, so backup is hidden. */
  isSandbox: boolean;
  /** True when an untouched original `.sav` exists to back up. */
  hasOriginal: boolean;
  includeBackup: boolean;
  onIncludeBackupChange: (value: boolean) => void;

  // --- Platform target ---
  /** Cross-platform target - informational; the exported bytes are identical. */
  platform: PlatformId;
  onPlatformChange: (id: PlatformId) => void;
  /** True when the browser supports "save in place" - the `.sav` opens a native save dialog. */
  saveInPlaceSupported: boolean;
}

// The change summary is collapsed to a few headline lines by default - the full per-dweller
// field-by-field detail is information overload in an export confirm. A "Show all changes"
// toggle reveals the granular history (added/removed names + every edited field) on demand.
function SummaryBody({ summary }: { summary: ChangeSummary | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!summary || !summary.hasChanges) {
    return (
      <p className="text-sm text-neutral-400">No changes since import - exporting a fresh copy.</p>
    );
  }

  const {
    dwellersAdded,
    dwellersRemoved,
    dwellersModified,
    roomsAdded,
    roomsRemoved,
    roomsModified,
    resourcesChanged,
    itemsChanged,
    boxesChanged,
    recipesAdded,
    recipesRemoved,
    inventoryDelta,
    otherChanges,
    otherChangesTruncated,
    otherSectionsChanged,
  } = summary;

  // Condensed headline: dweller/room counts, resources, storage delta, other sections.
  const dwellerCounts = [
    dwellersAdded.length > 0 ? `${dwellersAdded.length} added` : null,
    dwellersRemoved.length > 0 ? `${dwellersRemoved.length} removed` : null,
    dwellersModified.length > 0 ? `${dwellersModified.length} edited` : null,
  ].filter((s): s is string => s !== null);
  const roomCounts = [
    roomsAdded.length > 0 ? `${roomsAdded.length} built` : null,
    roomsRemoved.length > 0 ? `${roomsRemoved.length} removed` : null,
    roomsModified.length > 0 ? `${roomsModified.length} edited` : null,
  ].filter((s): s is string => s !== null);

  // Only the names + field changes are worth expanding for; counts already cover the headline.
  const hasDetail =
    dwellersAdded.length > 0 ||
    dwellersRemoved.length > 0 ||
    dwellersModified.length > 0 ||
    roomsAdded.length > 0 ||
    roomsRemoved.length > 0 ||
    roomsModified.length > 0 ||
    resourcesChanged.length > 0 ||
    itemsChanged.length > 0 ||
    boxesChanged.length > 0 ||
    recipesAdded.length > 0 ||
    recipesRemoved.length > 0 ||
    otherChanges.length > 0;

  const CAP = 25;
  const capped = (ids: string[]): string =>
    ids.length <= CAP
      ? ids.join(', ')
      : `${ids.slice(0, CAP).join(', ')} … and ${ids.length - CAP} more`;

  return (
    <div className="text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          {dwellerCounts.length > 0 && (
            <p className="text-neutral-300">Dwellers: {dwellerCounts.join(', ')}</p>
          )}
          {roomCounts.length > 0 && (
            <p className="text-neutral-300">Rooms: {roomCounts.join(', ')}</p>
          )}
          {resourcesChanged.length > 0 && (
            <p className="text-neutral-300">
              Resources:{' '}
              {resourcesChanged.map((f) => `${f.label} ${f.before} → ${f.after}`).join(', ')}
            </p>
          )}
          {(itemsChanged.length > 0 || boxesChanged.length > 0) && (
            <p className="text-neutral-300">
              Items:{' '}
              {[...itemsChanged, ...boxesChanged]
                .slice(0, 6)
                .map((f) => `${f.label} ${f.before} → ${f.after}`)
                .join(', ')}
              {itemsChanged.length + boxesChanged.length > 6 &&
                ` … and ${itemsChanged.length + boxesChanged.length - 6} more`}
            </p>
          )}
          {recipesAdded.length > 0 && (
            <p className="text-neutral-300">Recipes unlocked: {recipesAdded.length}</p>
          )}
          {recipesRemoved.length > 0 && (
            <p className="text-neutral-300">Recipes removed: {recipesRemoved.length}</p>
          )}
          {inventoryDelta && (
            <p className="text-neutral-300">
              Storage items: {inventoryDelta.before} → {inventoryDelta.after}
            </p>
          )}
          {otherChanges.length > 0 && (
            <p className="text-neutral-400">
              Other data changed: {otherSectionsChanged.join(', ')} ({otherChanges.length}
              {otherChangesTruncated > 0 ? '+' : ''} field
              {otherChanges.length === 1 && otherChangesTruncated === 0 ? '' : 's'})
            </p>
          )}
        </div>
        {hasDetail && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-amber-300 hover:bg-neutral-800"
          >
            {expanded ? 'Hide changes' : 'Show all changes'}
          </button>
        )}
      </div>

      {hasDetail && expanded && (
        <div className="mt-2 flex flex-col gap-2 border-t border-neutral-800 pt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Changes you made
          </p>
          {dwellersAdded.length > 0 && (
            <div>
              <p className="font-medium text-emerald-300">
                {dwellersAdded.length} dweller(s) added
              </p>
              <p className="text-xs text-neutral-400">
                {dwellersAdded.map((d) => d.name).join(', ')}
              </p>
            </div>
          )}
          {dwellersRemoved.length > 0 && (
            <div>
              <p className="font-medium text-red-300">
                {dwellersRemoved.length} dweller(s) removed
              </p>
              <p className="text-xs text-neutral-400">
                {dwellersRemoved.map((d) => d.name).join(', ')}
              </p>
            </div>
          )}
          {dwellersModified.length > 0 && (
            <div>
              <p className="font-medium text-amber-300">
                {dwellersModified.length} dweller(s) edited
              </p>
              <ul className="mt-1 flex flex-col gap-1.5">
                {dwellersModified.map((d) => (
                  <li key={d.serializeId} className="rounded bg-neutral-950/60 px-2 py-1">
                    <span className="text-neutral-200">{d.name}</span>
                    <span className="text-neutral-400"> - </span>
                    <span className="text-xs text-neutral-400">
                      {d.fields.map((f) => `${f.label}: ${f.before} → ${f.after}`).join('; ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {roomsAdded.length > 0 && (
            <div>
              <p className="font-medium text-emerald-300">{roomsAdded.length} room(s) built</p>
              <p className="text-xs text-neutral-400">{roomsAdded.join(', ')}</p>
            </div>
          )}
          {roomsRemoved.length > 0 && (
            <div>
              <p className="font-medium text-red-300">{roomsRemoved.length} room(s) removed</p>
              <p className="text-xs text-neutral-400">{roomsRemoved.join(', ')}</p>
            </div>
          )}
          {roomsModified.length > 0 && (
            <div>
              <p className="font-medium text-amber-300">{roomsModified.length} room(s) edited</p>
              <ul className="mt-1 flex flex-col gap-1.5">
                {roomsModified.map((r) => (
                  <li key={r.label} className="rounded bg-neutral-950/60 px-2 py-1">
                    <span className="text-neutral-200">{r.label}</span>
                    <span className="text-neutral-400"> - </span>
                    <span className="text-xs text-neutral-400">
                      {r.fields.map((f) => `${f.label}: ${f.before} → ${f.after}`).join('; ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(itemsChanged.length > 0 || boxesChanged.length > 0) && (
            <div>
              <p className="font-medium text-amber-300">Item counts changed</p>
              <p className="text-xs text-neutral-400">
                {[...itemsChanged, ...boxesChanged]
                  .map((f) => `${f.label}: ${f.before} → ${f.after}`)
                  .join(', ')}
              </p>
            </div>
          )}
          {recipesAdded.length > 0 && (
            <div>
              <p className="font-medium text-emerald-300">
                {recipesAdded.length} recipe(s) unlocked
              </p>
              <p className="text-xs text-neutral-400">{capped(recipesAdded)}</p>
            </div>
          )}
          {recipesRemoved.length > 0 && (
            <div>
              <p className="font-medium text-red-300">{recipesRemoved.length} recipe(s) removed</p>
              <p className="text-xs text-neutral-400">{capped(recipesRemoved)}</p>
            </div>
          )}
          {otherChanges.length > 0 && (
            <div>
              <p className="font-medium text-amber-300">Other fields changed</p>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-neutral-400">
                {otherChanges.map((c) => (
                  <li key={c.path}>
                    <span className="font-mono text-neutral-300">{c.path}</span>: {c.before} →{' '}
                    {c.after}
                  </li>
                ))}
                {otherChangesTruncated > 0 && (
                  <li className="text-neutral-500">…and {otherChangesTruncated} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const FILE_ROW = 'flex gap-2 rounded bg-neutral-950/40 px-3 py-2';
const FILE_CHECKBOX = 'mt-0.5 accent-amber-500';

export function ChangeReviewDialog({
  open,
  onClose,
  onConfirm,
  summary,
  health,
  exporting,
  error,
  fileName,
  includeSav,
  onIncludeSavChange,
  seasonEdited,
  includeSeason,
  onIncludeSeasonChange,
  isSandbox,
  hasOriginal,
  includeBackup,
  onIncludeBackupChange,
  platform,
  onPlatformChange,
  saveInPlaceSupported,
}: ChangeReviewDialogProps) {
  const issues = health?.issues ?? [];
  const target = platformTarget(platform);
  const base = fileName.replace(/\.sav$/i, '');
  // A sandbox baseline has no user original to protect, so the backup is neither shown nor counted.
  const canBackup = hasOriginal && !isSandbox;

  // "Select everything" master toggle. It spans only the files actually on offer (the season
  // pair appears only after a season edit; the backup only when there's an original to copy),
  // and shows the indeterminate (mixed) state when some - but not all - are ticked.
  const availableCount = 1 + (seasonEdited ? 1 : 0) + (canBackup ? 1 : 0);
  const selectedCount =
    (includeSav ? 1 : 0) +
    (seasonEdited && includeSeason ? 1 : 0) +
    (canBackup && includeBackup ? 1 : 0);
  const allSelected = selectedCount === availableCount;
  const nothingSelected = selectedCount === 0;

  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected;
    }
  }, [selectedCount, allSelected]);

  const setAll = (value: boolean): void => {
    onIncludeSavChange(value);
    if (seasonEdited) onIncludeSeasonChange(value);
    if (canBackup) onIncludeBackupChange(value);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_LARGE} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-semibold">Save your changes</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-neutral-400">
                Here&apos;s what changed and which files we&apos;ll save. The defaults are safe -
                most people can just press Export.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="rounded px-2 py-1 text-neutral-400 hover:text-neutral-100"
            >
              ✕
            </Dialog.Close>
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            <SummaryBody summary={summary} />

            {issues.length > 0 && (
              <div className="mt-4 border-t border-neutral-800 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Save health
                </p>
                <ul className="mt-1 flex flex-col gap-1 text-sm">
                  {issues.map((issue, i) => (
                    <li
                      key={i}
                      className={issue.severity === 'error' ? 'text-red-300' : 'text-amber-300'}
                    >
                      {issue.severity === 'error' ? '⛔ ' : '⚠ '}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 border-t border-neutral-800 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                What to save
              </p>

              {availableCount > 1 && (
                <label className="mt-2 flex items-center gap-2 px-3 text-sm">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => setAll(e.target.checked)}
                    className="accent-amber-500"
                  />
                  <span className="text-neutral-200">Save everything</span>
                  <span className="text-xs text-neutral-500">(recommended)</span>
                </label>
              )}

              <div className="mt-2 flex flex-col gap-2">
                <label className={FILE_ROW}>
                  <input
                    type="checkbox"
                    checked={includeSav}
                    onChange={(e) => onIncludeSavChange(e.target.checked)}
                    className={FILE_CHECKBOX}
                  />
                  <span className="text-sm">
                    <span className="text-neutral-200">Your vault save</span>{' '}
                    <code className="text-neutral-400">{fileName}</code>
                    <span className="mt-0.5 block text-xs text-neutral-400">
                      Everything in your shelter - dwellers, rooms, caps and items - with your edits
                      applied.
                      {saveInPlaceSupported &&
                        ' Opens a “save” window so you can write it straight back over the original.'}
                    </span>
                  </span>
                </label>

                {seasonEdited && (
                  <label className={FILE_ROW}>
                    <input
                      type="checkbox"
                      checked={includeSeason}
                      onChange={(e) => onIncludeSeasonChange(e.target.checked)}
                      className={FILE_CHECKBOX}
                    />
                    <span className="text-sm">
                      <span className="text-neutral-200">Your season-pass progress</span>{' '}
                      <code className="text-neutral-400">spd.dat</code>
                      <span className="text-neutral-500"> + </span>
                      <code className="text-neutral-400">nvf.dat</code>
                      <span className="mt-0.5 block text-xs text-neutral-400">
                        Your season level, claimed rewards and premium status. These two files work
                        as a pair, so they&apos;re saved together to stay in sync.
                      </span>
                    </span>
                  </label>
                )}

                {canBackup && (
                  <label className={FILE_ROW}>
                    <input
                      type="checkbox"
                      checked={includeBackup}
                      onChange={(e) => onIncludeBackupChange(e.target.checked)}
                      className={FILE_CHECKBOX}
                    />
                    <span className="text-sm">
                      <span className="text-neutral-200">A safety backup</span>{' '}
                      <code className="text-neutral-400">{base}.backup-…sav</code>
                      <span className="mt-0.5 block text-xs text-neutral-400">
                        An untouched copy of your save from before these edits. Keep it - if
                        anything looks wrong in the game, you can put this one back. Strongly
                        recommended.
                      </span>
                    </span>
                  </label>
                )}

                {isSandbox && (
                  <p className="px-3 text-xs text-neutral-500">
                    This is a practice save you started in the app - there&apos;s no original file
                    to back up.
                  </p>
                )}
              </div>

              {canBackup && includeBackup && (
                <div className="mt-2 rounded border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-400">
                  <p className="font-medium text-neutral-300">If something goes wrong later</p>
                  <p className="mt-0.5">
                    In your save folder, delete the edited{' '}
                    <code className="text-neutral-300">{fileName}</code>, then rename the backup
                    file: remove the <code className="text-neutral-300">.backup-&lt;date&gt;</code>{' '}
                    part of its name so it&apos;s called{' '}
                    <code className="text-neutral-300">{fileName}</code> again. The game will load
                    it as if the edits never happened.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 border-t border-neutral-800 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Where to put these files
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                After saving, copy the file(s) into Fallout Shelter&apos;s save folder, replacing
                the ones already there. Pick your device to see the folder - the same one holds the
                vault save and both season files:
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PLATFORM_TARGETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={platform === p.id}
                    onClick={() => onPlatformChange(p.id)}
                    className={`rounded border px-2.5 py-1 text-xs ${
                      platform === p.id
                        ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                        : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 rounded bg-neutral-950/60 px-3 py-2 text-xs">
                <code className="break-all text-neutral-300">{target.basePath}</code>
                <span className="mt-1 block text-neutral-500">
                  This folder holds <code className="text-neutral-400">{fileName}</code>,{' '}
                  <code className="text-neutral-400">spd.dat</code> and{' '}
                  <code className="text-neutral-400">nvf.dat</code>.
                </span>
                {!target.verified && (
                  <span className="mt-1 block text-amber-400">
                    Community-reported location - double-check it on your device. {target.note}
                  </span>
                )}
              </div>
              {(target.id === 'pc' || target.id === 'steamdeck') && (
                <p className="mt-2 text-xs text-amber-400">
                  Heads up: Steam Cloud can quietly put the old save back. Before you swap files,
                  close the game and turn off Steam Cloud sync for Fallout Shelter.
                </p>
              )}
            </div>
          </div>

          {saveInPlaceSupported && includeSav && (
            <p className="mt-3 text-xs text-neutral-400">
              When you press Export, a “save” window opens for your{' '}
              <code className="text-neutral-300">.sav</code> - go to the folder above and pick your
              existing <code className="text-neutral-300">Vault&lt;N&gt;.sav</code> to overwrite it.
              {(seasonEdited || canBackup) &&
                ' The other files land in your Downloads folder; move them into that same save folder.'}
            </p>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={exporting || nothingSelected}
              className="rounded bg-amber-500 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
