// Ambient declarations for the File System Access API surface this app uses.
// TypeScript's lib.dom.d.ts ships `FileSystemFileHandle` /
// `FileSystemWritableFileStream` / `createWritable`, but NOT the `showSaveFilePicker`
// entry point or its options - declared here (Chromium-only; feature-detected at
// runtime in download.ts). Kept minimal and typed (no `any`).

interface FilePickerAcceptType {
  description?: string;
  /** MIME type → list of file extensions (each starting with a dot). */
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  id?: string;
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}
