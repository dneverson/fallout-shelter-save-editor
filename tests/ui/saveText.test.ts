import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { canSaveInPlace, saveText } from '../../src/ui/lib/download.ts';

// `saveText` is the "save in place" seam: File System Access
// API where supported, graceful download fallback elsewhere. DOM-only globals are reached
// via `globalThis.` so the node-globals lint config doesn't flag them. The native picker
// itself can't be scripted, so the picker is stubbed to assert wiring + the fallback path.

describe('saveText', () => {
  beforeEach(() => {
    // jsdom doesn't implement these; stub so the download fallback path is observable.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('falls back to a download when the File System Access API is unavailable', async () => {
    expect(canSaveInPlace()).toBe(false);

    const result = await saveText('Vault1.sav', 'PAYLOAD');

    expect(result).toEqual({ method: 'download' });
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it('writes in place via showSaveFilePicker when supported', async () => {
    const write = vi.fn();
    const close = vi.fn();
    const createWritable = vi.fn(async () => ({ write, close }));
    const showSaveFilePicker = vi.fn(async () => ({ createWritable }));
    vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);

    expect(canSaveInPlace()).toBe(true);
    const result = await saveText('Vault1.sav', 'PAYLOAD');

    expect(result).toEqual({ method: 'fs-access' });
    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'Vault1.sav' }),
    );
    expect(write).toHaveBeenCalledOnce();
    const blob = write.mock.calls[0][0];
    expect(blob).toBeInstanceOf(globalThis.Blob);
    expect(await blob.text()).toBe('PAYLOAD');
    expect(close).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('honors an explicit cancel (AbortError) without downloading', async () => {
    const showSaveFilePicker = vi.fn(async () => {
      throw new globalThis.DOMException('The user aborted a request.', 'AbortError');
    });
    vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);

    const result = await saveText('Vault1.sav', 'PAYLOAD');

    expect(result).toEqual({ method: 'fs-access', cancelled: true });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('degrades to a download on a non-abort failure', async () => {
    const showSaveFilePicker = vi.fn(async () => {
      throw new globalThis.DOMException('No permission.', 'NotAllowedError');
    });
    vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);

    const result = await saveText('Vault1.sav', 'PAYLOAD');

    expect(result).toEqual({ method: 'download' });
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });
});
