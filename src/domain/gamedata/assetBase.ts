// Runtime asset base. Vite replaces `import.meta.env.BASE_URL` at build time with the
// `base` from vite.config.ts (`'./'` here). Deriving every runtime fetch()/Assets.load()
// from it - instead of a hardcoded leading '/' - keeps game-data JSON, atlases, and sprite
// PNGs resolving under whatever path the built site is served from: a domain root, or a
// GitHub Pages project subpath (e.g. /fallout-shelter-save-editor/), with no rebuild. This
// is the same portability goal as `base: './'`; hardcoded '/gamedata' defeated it (404 on a
// project subpath). BASE_URL always ends with '/', so callers pass a slash-less sub-path.
const ASSET_BASE = import.meta.env.BASE_URL;

/** Join the served asset base with a sub-path, e.g. assetUrl('gamedata/atlas'). */
export function assetUrl(path: string): string {
  return `${ASSET_BASE}${path}`;
}
