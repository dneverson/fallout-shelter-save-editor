import { useRef, useState, type ReactNode } from 'react';

// Shared onboarding chooser used by BOTH the Import landing (pick a `.sav`) and the Season Pass
// onboarding (pick `spd.dat`/`nvf.dat`). One layout, two callers: an "existing file" card (with
// drag-drop) on the left, a "prebuilt starter" card on the right, an error slot, and an
// always-shown help block underneath. Keeping it in one component is why the two screens stay
// visually identical (per the product ask) instead of drifting.

const CARD = 'flex flex-col rounded-lg border border-neutral-800 bg-neutral-900/40 p-5';
// The existing-file card is a drop target, so it wears a dashed border to signal that.
const UPLOAD_CARD =
  'flex flex-col rounded-lg border-2 border-dashed border-neutral-700 bg-neutral-900/40 p-5';
const PRIMARY_BTN =
  'rounded bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-amber-400 disabled:opacity-50';
const SECONDARY_BTN =
  'rounded border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-800 disabled:opacity-50';

export interface SourcePickerProps {
  /** Section heading. */
  title: string;
  /** Section sub-copy under the heading. */
  description: ReactNode;

  // --- Existing-file card (drag-drop enabled) ---
  uploadTitle: string;
  uploadDescription: ReactNode;
  /** Small line under the picker button, e.g. a drag-drop hint. */
  uploadHint?: ReactNode;
  uploadButtonLabel: string;
  uploadBusyLabel?: string;
  /** File input `accept` (e.g. ".sav,.bkp" or ".dat"). */
  accept: string;
  multiple?: boolean;
  busy: boolean;
  /** Raw files from either the picker or a drop; the caller reads/routes them. */
  onFiles: (files: FileList) => void;

  // --- Prebuilt-starter card ---
  prebuiltTitle: string;
  prebuiltDescription: ReactNode;
  /** Caller computes this (it may reflect a not-ready state). */
  prebuiltButtonLabel: string;
  prebuiltDisabled?: boolean;
  onPrebuilt: () => void;
  prebuiltError?: string | null;

  // --- Shared ---
  error?: string | null;
  /** Always-shown help block (e.g. <WheresMyFile />) rendered under the cards. */
  help?: ReactNode;
}

export function SourcePicker(props: SourcePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      <p className="mt-1 text-sm text-neutral-400">{props.description}</p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Existing file: the whole card is a drop target and highlights while dragging. */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length > 0) props.onFiles(e.dataTransfer.files);
          }}
          className={`${UPLOAD_CARD} ${dragOver ? '!border-amber-400 bg-neutral-900' : ''}`}
        >
          <h3 className="text-sm font-semibold text-neutral-200">{props.uploadTitle}</h3>
          <p className="mt-1 flex-1 text-xs text-neutral-400">{props.uploadDescription}</p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={props.busy}
              className={PRIMARY_BTN}
            >
              {props.busy ? (props.uploadBusyLabel ?? 'Reading…') : props.uploadButtonLabel}
            </button>
            {props.uploadHint && (
              <p className="mt-2 text-xs text-neutral-500">{props.uploadHint}</p>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={props.accept}
              multiple={props.multiple}
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) props.onFiles(files);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        {/* Prebuilt starter: a real, editable, downloadable model, not a bypass. */}
        <div className={CARD}>
          <h3 className="text-sm font-semibold text-neutral-200">{props.prebuiltTitle}</h3>
          <p className="mt-1 flex-1 text-xs text-neutral-400">{props.prebuiltDescription}</p>
          <div className="mt-4">
            <button
              type="button"
              onClick={props.onPrebuilt}
              disabled={props.prebuiltDisabled}
              className={SECONDARY_BTN}
            >
              {props.prebuiltButtonLabel}
            </button>
            {props.prebuiltError && (
              <p className="mt-2 text-xs text-red-400" role="alert">
                {props.prebuiltError}
              </p>
            )}
          </div>
        </div>
      </div>

      {props.error && (
        <p
          className="mt-4 rounded border border-red-800 bg-red-950/50 p-3 text-sm text-red-300"
          role="alert"
        >
          {props.error}
        </p>
      )}

      {props.help && <div className="mt-5">{props.help}</div>}
    </div>
  );
}
