// One-command game-data refresh - the full extraction chain that keeps the editor
// in sync with a new Fallout Shelter release.
//
//   Stage 1  AssetRipper   game install  → tools/export/ExportedProject/Assets  (~1.2 GB)
//   Stage 2  Python extract Mono DLLs     → scripts/extract/enums.json
//   Stage 3  Node build     export+enums  → public/gamedata/*.json  (committed output)
//   Stage 4  Verify         output+save   → schema / diff / save-id report (warn-only)
//
// Run on the curation machine (needs the local game install + AssetRipper + the Python
// venv - all gitignored). The committed JSON is the only thing that ships.
//
//   pnpm gamedata:refresh                 full chain
//   pnpm gamedata:refresh --skip-export   reuse the existing tools/export (skip Stage 1)
//   pnpm gamedata:refresh --skip-extract  reuse existing scripts/extract/enums.json (skip Stage 2)
//   pnpm gamedata:refresh --help
//
// Machine paths come from a single config block below; FSSE_GAME_DIR overrides the
// game-install location and is forwarded to the Python stage too.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // scripts/
const REPO_ROOT = resolve(HERE, '..');

const CONFIG = {
  // Game install (Steam). Override with FSSE_GAME_DIR for a different platform/path.
  gameDir:
    process.env.FSSE_GAME_DIR ??
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Fallout Shelter',
  assetRipperExe: join(REPO_ROOT, 'tools', 'AssetRipper', 'AssetRipper.GUI.Free.exe'),
  assetRipperPort: Number(process.env.FSSE_ASSETRIPPER_PORT ?? 5612),
  // AssetRipper's own log; we poll it for the load-complete marker (the HTTP API has no
  // load-status endpoint - /Collections/* require a ?Path= and 404 otherwise).
  assetRipperLog: join(tmpdir(), 'fsse-assetripper-refresh.log'),
  exportDir: join(REPO_ROOT, 'tools', 'export'),
  venvPython: join(REPO_ROOT, 'scripts', 'extract', '.venv', 'Scripts', 'python.exe'),
  extractDir: join(REPO_ROOT, 'scripts', 'extract'),
};

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log(
    [
      'Usage: pnpm gamedata:refresh [options]',
      '',
      '  --skip-export    skip AssetRipper; reuse the existing tools/export',
      '  --skip-extract   skip the Python extract; reuse the existing scripts/extract/enums.json',
      '  --skip-build     skip the Node build of public/gamedata',
      '  --skip-verify    skip the post-build verification report',
      '  --help, -h       show this help',
    ].join('\n'),
  );
  process.exit(0);
}

// --- small helpers --------------------------------------------------------------

/** Run a child process inheriting stdio; resolve on exit 0, reject otherwise. */
function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${cmd} ${cmdArgs.join(' ')} exited with code ${code}`)),
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

// --- Stage 1: AssetRipper export ------------------------------------------------

const arBase = `http://127.0.0.1:${CONFIG.assetRipperPort}`;

async function assetRipperReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${arBase}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // server not up yet
    }
    await sleep(500);
  }
  return false;
}

async function arPostPath(route, path) {
  const res = await fetch(`${arBase}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ path }).toString(),
  });
  if (!res.ok) throw new Error(`AssetRipper ${route} failed (HTTP ${res.status})`);
  return res;
}

/**
 * Wait for the asynchronous load to finish. `/LoadFolder` returns its 302 in seconds but
 * parses+processes the ~481 MB bundle in the background; the HTTP API exposes no load-status
 * endpoint, so we poll AssetRipper's log for the definitive "Finished processing assets"
 * marker. The log is fresh per run (deleted before launch), so the marker is unambiguous.
 */
async function waitForLoad(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const log = readFileSync(CONFIG.assetRipperLog, 'utf8');
      if (log.includes('Finished processing assets')) return true;
    } catch {
      // log not created/readable yet
    }
    await sleep(1000);
  }
  return false;
}

async function stageExport() {
  section('Stage 1 / 4  ·  AssetRipper export');
  const bundle = join(CONFIG.gameDir, 'FalloutShelter_Data', 'data.unity3d');
  if (!existsSync(bundle))
    throw new Error(`Game bundle not found:\n  ${bundle}\nSet FSSE_GAME_DIR to the install path.`);
  if (!existsSync(CONFIG.assetRipperExe))
    throw new Error(`AssetRipper not found:\n  ${CONFIG.assetRipperExe}\n`);

  console.log(`  game:   ${CONFIG.gameDir}`);
  console.log(`  export: ${CONFIG.exportDir}`);
  console.log(`  launching AssetRipper headless on port ${CONFIG.assetRipperPort}…`);

  // Fresh log so waitForLoad's marker can only come from this run.
  rmSync(CONFIG.assetRipperLog, { force: true });
  const ar = spawn(
    CONFIG.assetRipperExe,
    ['--headless', '--port', String(CONFIG.assetRipperPort), '--log-path', CONFIG.assetRipperLog],
    { stdio: 'ignore', detached: false },
  );
  let arExited = false;
  ar.on('exit', () => {
    arExited = true;
  });

  try {
    if (!(await assetRipperReady(60_000)))
      throw new Error('AssetRipper did not start listening within 60s');
    console.log('  AssetRipper ready.');

    await fetch(`${arBase}/Reset`, { method: 'POST' }).catch(() => {});

    console.log('  loading game folder (parses the ~481 MB bundle, please wait)…');
    await arPostPath('/LoadFolder', CONFIG.gameDir);
    // LoadFolder loads asynchronously; wait for the log's load-complete marker.
    if (!(await waitForLoad(300_000)))
      throw new Error('AssetRipper did not finish loading within 300s - game folder not parsed');
    console.log('  game folder loaded.');

    // Export into a clean directory (AssetRipper writes ExportedProject/ under it).
    rmSync(CONFIG.exportDir, { recursive: true, force: true });
    mkdirSync(CONFIG.exportDir, { recursive: true });

    console.log('  exporting Unity project (several minutes, ~1.2 GB)…');
    const t0 = Date.now();
    await arPostPath('/Export/UnityProject', CONFIG.exportDir);
    console.log(`  export finished in ${Math.round((Date.now() - t0) / 1000)}s.`);

    const sentinel = join(
      CONFIG.exportDir,
      'ExportedProject',
      'Assets',
      'GameObject',
      'GameParameters.prefab',
    );
    if (!existsSync(sentinel))
      throw new Error(`Export produced no GameParameters.prefab:\n  ${sentinel}`);
    console.log('  export verified (GameParameters.prefab present).');
  } finally {
    if (!arExited) ar.kill();
  }
}

// --- Stage 2: Python extract ----------------------------------------------------

async function stageExtract() {
  section('Stage 2 / 4  ·  Python extract (enums)');
  if (!existsSync(CONFIG.venvPython))
    throw new Error(
      `Python venv not found:\n  ${CONFIG.venvPython}\n` +
        'Create it once:\n' +
        '  py -3 -m venv scripts/extract/.venv\n' +
        '  scripts/extract/.venv/Scripts/python -m pip install -r scripts/extract/requirements.txt',
    );
  const env = { ...process.env, FSSE_GAME_DIR: CONFIG.gameDir };
  console.log('  extract_enums.py → scripts/extract/enums.json');
  await run(CONFIG.venvPython, ['extract_enums.py'], { cwd: CONFIG.extractDir, env });

  for (const f of ['scripts/extract/enums.json']) {
    if (!existsSync(join(REPO_ROOT, f))) throw new Error(`Python extract did not produce ${f}`);
  }
  console.log('  extract verified.');
}

// --- Stage 3: Node build --------------------------------------------------------

async function stageBuild() {
  section('Stage 3 / 4  ·  Build public/gamedata');
  await run(process.execPath, [join(REPO_ROOT, 'scripts', 'build-gamedata', 'index.mjs')], {
    cwd: REPO_ROOT,
  });
}

// --- Stage 4: Verify ------------------------------------------------------------

async function stageVerify() {
  section('Stage 4 / 4  ·  Verify (warn-only report)');
  // Warn-only: a non-zero exit here should not fail the refresh; the report is advisory.
  try {
    await run(process.execPath, [join(REPO_ROOT, 'scripts', 'verify-gamedata.mjs')], {
      cwd: REPO_ROOT,
    });
  } catch {
    console.log('  (verify reported findings - review the report above)');
  }
}

// --- main -----------------------------------------------------------------------

async function main() {
  console.log('Fallout Shelter game-data refresh\n');
  if (!args.has('--skip-export')) await stageExport();
  else console.log('Stage 1 (AssetRipper export) skipped - reusing tools/export.');

  if (!args.has('--skip-extract')) await stageExtract();
  else console.log('Stage 2 (Python extract) skipped - reusing scripts/extract/enums.json.');

  if (!args.has('--skip-build')) await stageBuild();
  else console.log('Stage 3 (Node build) skipped.');

  if (!args.has('--skip-verify')) await stageVerify();
  else console.log('Stage 4 (verify) skipped.');

  console.log('\nRefresh complete. Review `git diff public/gamedata` before committing.');
}

main().catch((err) => {
  console.error(`\nRefresh failed: ${err.message}`);
  process.exit(1);
});
