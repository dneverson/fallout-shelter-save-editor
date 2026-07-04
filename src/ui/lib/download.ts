// Browser download helpers (DOM concern - kept out of the pure domain layer).

/** Trigger a client-side download of text content as a file. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Filesystem-safe timestamp for backup filenames, e.g. 2026-06-12T15-04-05-123Z. */
export function fileTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** How {@link saveText} delivered the file. `cancelled` = user dismissed the picker. */
export interface SaveOutcome {
  method: 'fs-access' | 'download';
  cancelled?: boolean;
}

/**
 * True when the File System Access "save in place" path is available (Chromium +
 * secure context). Firefox/Safari return false → callers fall back to {@link downloadText}.
 */
export function canSaveInPlace(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

/**
 * Save text to a user-chosen file via the File System Access API ("save in place"),
 * falling back to a normal download where unsupported.
 *
 * Must be called from a user gesture (the picker requires transient activation).
 * If the user cancels the native picker the result is `{ cancelled: true }` and nothing
 * is written - an explicit cancel is NOT downgraded to a download. Any other failure
 * degrades gracefully to a download.
 */
export async function saveText(filename: string, text: string): Promise<SaveOutcome> {
  if (!canSaveInPlace()) {
    downloadText(filename, text);
    return { method: 'download' };
  }
  try {
    const handle = await window.showSaveFilePicker!({
      suggestedName: filename,
      types: [
        {
          description: 'Fallout Shelter save',
          accept: { 'application/octet-stream': ['.sav'] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(new Blob([text], { type: 'application/octet-stream' }));
    await writable.close();
    return { method: 'fs-access' };
  } catch (e) {
    // The user dismissing the picker throws AbortError - honor the cancel, don't download.
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { method: 'fs-access', cancelled: true };
    }
    // Any other failure (permissions, write error): degrade to a download so the user
    // still gets their file.
    downloadText(filename, text);
    return { method: 'download' };
  }
}
