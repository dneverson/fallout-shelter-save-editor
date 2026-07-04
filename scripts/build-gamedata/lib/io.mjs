// Offline game-data generators - shared IO + path resolution.
// These read the gitignored game-file export (tools/export) plus the extracted enums
// (scripts/extract/enums.json) and write the committed derived JSON to public/gamedata.
// Not shipped with the app.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // scripts/build-gamedata/lib
export const REPO_ROOT = resolve(HERE, '../../..');

const EXPORT_ROOT = join(REPO_ROOT, 'tools/export/ExportedProject/Assets');
export const PATHS = {
  gameParams: join(EXPORT_ROOT, 'GameObject/GameParameters.prefab'),
  i2: join(EXPORT_ROOT, 'Resources/I2Languages.prefab'),
  pets: join(EXPORT_ROOT, 'MonoBehaviour/PetsCustomizationData.asset'),
  // Vault-settings sources: the room-unlock objective catalog + per-room
  // capacity prefabs (one GameObject prefab per ERoomType) + the base-resource defaults.
  unlockableMgr: join(EXPORT_ROOT, 'GameObject/Unlockable MGR.prefab'),
  vaultLogic: join(EXPORT_ROOT, 'GameObject/VaultLogic.prefab'),
  gameObjectDir: join(EXPORT_ROOT, 'GameObject'),
  // Visual-asset sources: dweller meshes, customization pieces, atlases.
  dwellerCatalog: join(EXPORT_ROOT, 'GameObject/DwellerCatalog.prefab'),
  meshDir: join(EXPORT_ROOT, 'Mesh'),
  animDir: join(EXPORT_ROOT, 'AnimationClip'),
  scriptsDir: join(EXPORT_ROOT, 'Scripts/Assembly-CSharp'),
  monoBehaviourDir: join(EXPORT_ROOT, 'MonoBehaviour'),
  dwellerAtlasDir: join(EXPORT_ROOT, 'Resources/dwelleratlases/new'),
  uiAtlasDir: join(EXPORT_ROOT, 'Resources/atlas'),
  // Extraction intermediates: the full enum set (build input) + the untrimmed parse
  // dumps the pet/unlockable builders write for reuse. Co-located with the Python
  // extractor; all gitignored.
  rawDir: join(REPO_ROOT, 'scripts/extract'),
  enums: join(REPO_ROOT, 'scripts/extract/enums.json'),
  customization: join(EXPORT_ROOT, 'MonoBehaviour/DwellerCustomizationDataCatalog.asset'),
  outDir: join(REPO_ROOT, 'public/gamedata'),
  // Committed visual assets (PNGs + geometry/index JSON) ship under this subdir.
  atlasOutDir: join(REPO_ROOT, 'public/gamedata/atlas'),
};

/** Read a required source file, with a clear message if the game export is absent. */
export function readSource(path) {
  if (!existsSync(path)) {
    throw new Error(
      `Missing game-data source:\n  ${path}\n` +
        'These generators need the local Fallout Shelter export (tools/export, scripts/extract),\n' +
        'which is gitignored. The committed public/gamedata/*.json already\n' +
        'ships the derived data - you only need to re-run generators when the game updates.',
    );
  }
  return readFileSync(path, 'utf8');
}

export function readJson(path) {
  return JSON.parse(readSource(path));
}

/** Read a required source file as raw bytes (PNGs), with the same absent-file message. */
export function readSourceBuffer(path) {
  if (!existsSync(path)) {
    throw new Error(
      `Missing game-data source:\n  ${path}\n(see tools/README.md - the local export is gitignored).`,
    );
  }
  return readFileSync(path);
}

/** Write pretty JSON to public/gamedata/<name> and log a one-line summary. */
export function writeOutput(name, data) {
  mkdirSync(PATHS.outDir, { recursive: true });
  const path = join(PATHS.outDir, name);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  const count = Array.isArray(data) ? `${data.length} entries` : 'object';
  console.log(`  wrote public/gamedata/${name} (${count})`);
}

/** Write pretty JSON into public/gamedata/atlas/<name>. */
export function writeAtlasOutput(name, data) {
  mkdirSync(PATHS.atlasOutDir, { recursive: true });
  writeFileSync(join(PATHS.atlasOutDir, name), JSON.stringify(data) + '\n', 'utf8');
  console.log(`  wrote public/gamedata/atlas/${name}`);
}

/** Copy a source PNG into public/gamedata/atlas/, returning its basename. */
export function copyAtlasPng(srcPath) {
  mkdirSync(PATHS.atlasOutDir, { recursive: true });
  const name = basename(srcPath);
  copyFileSync(srcPath, join(PATHS.atlasOutDir, name));
  return name;
}
