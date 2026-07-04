// Game-data verification gate - the "nothing game-breaking" check.
// Runs against the COMMITTED public/gamedata/*.json (no game files needed), so it works
// locally after a refresh AND in CI.
//
//   pnpm gamedata:verify            warn-only report (default; always exit 0)
//   pnpm gamedata:verify --fix      re-derive meta.json counts so they match the data
//   pnpm gamedata:verify --ci       strict: exit 1 on any failure (used by CI)
//   pnpm gamedata:verify --save=…   use a specific .sav for the id-resolution check
//
// Checks:
//   1. Schema   - every catalog validates against the app's own zod schemas (src is the
//                 single source of truth, imported via Node type-stripping).
//   2. Meta     - meta.json counts match the actual array/object lengths (catches the
//                 hand-edit drift). `--fix` rewrites them.
//   3. Diff     - count deltas vs the committed git HEAD (a catalog dropping to ~0 means a
//                 parser broke against a new game build). Advisory.
//   4. Save ids - every gamedata id a real save references still resolves in the new data
//                 (orphaned equipment/pet/room/unique ids would break real saves).
//                 Uses Vault1.sav if present, else the committed sanitized fixture.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const GD = join(REPO_ROOT, 'public', 'gamedata');

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const saveArg = process.argv
  .slice(2)
  .find((a) => a.startsWith('--save='))
  ?.slice('--save='.length);
const MODE_FIX = flags.has('--fix');
const MODE_STRICT = flags.has('--ci') || flags.has('--strict');

// --- findings -------------------------------------------------------------------
/** @type {{level:'fail'|'warn'|'info', area:string, msg:string}[]} */
const findings = [];
const fail = (area, msg) => findings.push({ level: 'fail', area, msg });
const warn = (area, msg) => findings.push({ level: 'warn', area, msg });
const info = (area, msg) => findings.push({ level: 'info', area, msg });

const readJson = (file) => JSON.parse(readFileSync(join(GD, file), 'utf8'));

// --- load committed data --------------------------------------------------------
let raw;
try {
  raw = {
    weapons: readJson('weapons.json'),
    outfits: readJson('outfits.json'),
    junk: readJson('junk.json'),
    pets: readJson('pets.json'),
    handies: readJson('handies.json'),
    hair: readJson('hair.json'),
    enums: readJson('enums.json'),
    meta: readJson('meta.json'),
    unlockables: readJson('unlockables.json'),
    roomCapacity: readJson('room-capacity.json'),
    roomMetadata: readJson('room-metadata.json'),
    roomProduction: readJson('room-production.json'),
    uniqueDwellers: readJson('unique-dwellers.json'),
  };
} catch (err) {
  console.error(`verify: cannot read public/gamedata - ${err.message}`);
  process.exit(1);
}

// --- 1. schema validation (app's own zod schemas = single source of truth) ------
const schemas = await import('../src/domain/gamedata/schemas.ts');
const checkSchema = (label, schema, value) => {
  const res = schema.safeParse(value);
  if (!res.success) {
    fail(
      'schema',
      `${label}: ${res.error.issues.length} issue(s) - ${res.error.issues[0]?.message} at ${res.error.issues[0]?.path?.join('.')}`,
    );
    return null;
  }
  return res.data;
};

const weapons = checkSchema('weapons', z.array(schemas.weaponSchema), raw.weapons) ?? [];
const outfits = checkSchema('outfits', z.array(schemas.outfitSchema), raw.outfits) ?? [];
const junk = checkSchema('junk', z.array(schemas.junkSchema), raw.junk) ?? [];
const pets = checkSchema('pets', z.array(schemas.petSchema), raw.pets) ?? [];
const handies = checkSchema('handies', z.array(schemas.handySchema), raw.handies) ?? [];
const hair = checkSchema('hair', z.array(schemas.hairSchema), raw.hair) ?? [];
const enums = checkSchema('enums', schemas.enumsSchema, raw.enums) ?? {};
const meta = checkSchema('meta', schemas.metaSchema, raw.meta);
const unlockables = checkSchema('unlockables', schemas.unlockablesSchema, raw.unlockables) ?? {
  recipes: [],
  roomUnlocks: [],
};
const roomCapacity = checkSchema('roomCapacity', schemas.roomCapacitySchema, raw.roomCapacity) ?? {
  rooms: {},
};
const roomMetadata = checkSchema('roomMetadata', schemas.roomMetadataSchema, raw.roomMetadata) ?? {
  rooms: {},
};
const roomProduction = checkSchema(
  'roomProduction',
  schemas.roomProductionSchema,
  raw.roomProduction,
) ?? { rooms: {} };
const uniqueDwellers =
  checkSchema('uniqueDwellers', schemas.uniqueDwellersSchema, raw.uniqueDwellers) ?? {};

if (findings.some((f) => f.area === 'schema'))
  info('schema', 'one or more catalogs failed schema validation (see above)');
else
  info('schema', `all 12 catalogs valid (${weapons.length} weapons, ${outfits.length} outfits, …)`);

// --- 2. meta.json self-consistency (the hand-edit guard) ---------------------
// Counts derivable from the committed JSON. `spriteAtlases` is intentionally omitted -
// it is the size of the referenced-atlas set computed during the sprite build and is not
// recoverable from the committed JSON alone, so it can't be independently re-checked here.
const derivedCounts = {
  weapons: weapons.length,
  outfits: outfits.length,
  junk: junk.length,
  hair: hair.length,
  pets: pets.length,
  handies: handies.length,
  enums: Object.keys(enums).length,
  recipes: unlockables.recipes.length,
  roomUnlocks: unlockables.roomUnlocks.length,
  roomCapacityTypes: Object.keys(roomCapacity.rooms).length,
  roomMetadataTypes: Object.keys(roomMetadata.rooms).length,
  roomProductionTypes: Object.keys(roomProduction.rooms).length,
  uniqueDwellers: Object.keys(uniqueDwellers).length,
};

if (meta) {
  for (const [key, actual] of Object.entries(derivedCounts)) {
    const stated = meta.counts[key];
    if (stated !== actual) {
      fail('meta', `meta.counts.${key} = ${stated} but actual data has ${actual}`);
    }
  }
}

// --- 2b. --fix: re-derive meta.json so counts match the data --------------------
if (MODE_FIX && meta) {
  const fixedCounts = { ...meta.counts, ...derivedCounts };
  const next = {
    ...meta,
    generatedAt: new Date().toISOString(),
    counts: fixedCounts,
  };
  writeFileSync(join(GD, 'meta.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');
  info('meta', 'meta.json re-derived (counts synced to data, generatedAt bumped)');
  // Remove any meta failures we just fixed.
  for (let i = findings.length - 1; i >= 0; i--)
    if (findings[i].area === 'meta' && findings[i].level === 'fail') findings.splice(i, 1);
}

// --- 3. count diff vs committed git HEAD ----------------------------------------
try {
  const headMetaText = execFileSync('git', ['show', 'HEAD:public/gamedata/meta.json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const headCounts = JSON.parse(headMetaText).counts ?? {};
  const keys = new Set([...Object.keys(headCounts), ...Object.keys(derivedCounts)]);
  let anyDelta = false;
  for (const key of keys) {
    const before = headCounts[key];
    const after = derivedCounts[key] ?? meta?.counts?.[key];
    if (before === undefined || after === undefined || before === after) continue;
    anyDelta = true;
    const drop = before > 0 && after <= before * 0.5;
    const line = `${key}: ${before} → ${after}`;
    if (after === 0 || drop) warn('diff', `${line}  (sharp drop - possible parser break)`);
    else info('diff', line);
  }
  if (!anyDelta) info('diff', 'no count changes vs git HEAD');
} catch {
  info('diff', 'skipped count diff (no git HEAD baseline available)');
}

// --- 4. save-id resolution ------------------------------------------------------
// Build id lookup sets from the (validated) catalogs.
const idSets = {
  weapons: new Set(weapons.map((w) => w.id)),
  outfits: new Set(outfits.map((o) => o.id)),
  junk: new Set(junk.map((j) => j.id)),
  pets: new Set(pets.map((p) => p.id)),
  hair: new Set(hair.map((h) => h.pieceName)),
  rooms: new Set(Object.keys(roomMetadata.rooms)),
  uniqueDwellers: new Set(Object.keys(uniqueDwellers)),
  recipes: new Set(unlockables.recipes),
  roomUnlocks: new Set(unlockables.roomUnlocks),
};

/** Collect every gamedata id a save references, grouped by catalog. */
function collectSaveIds(save) {
  const out = {
    weapons: new Set(),
    outfits: new Set(),
    junk: new Set(),
    pets: new Set(),
    hair: new Set(),
    rooms: new Set(),
    uniqueDwellers: new Set(),
    recipes: new Set(),
    roomUnlocks: new Set(),
  };
  const ITEM_BUCKET = { Weapon: 'weapons', Outfit: 'outfits', Junk: 'junk', Pet: 'pets' };
  const addItem = (item) => {
    if (!item || typeof item.id !== 'string') return;
    const bucket = ITEM_BUCKET[item.type];
    if (bucket) out[bucket].add(item.id);
  };
  const skip = (v) => !v || v === 'None';
  for (const d of save?.dwellers?.dwellers ?? []) {
    addItem(d.equipedWeapon);
    addItem(d.equipedOutfit);
    addItem(d.equippedPet);
    if (!skip(d.hair)) out.hair.add(d.hair);
    if (!skip(d.faceMask)) out.hair.add(d.faceMask);
    if (!skip(d.uniqueData)) out.uniqueDwellers.add(d.uniqueData);
  }
  for (const item of save?.vault?.inventory?.items ?? []) addItem(item);
  for (const room of save?.vault?.rooms ?? []) if (room?.type) out.rooms.add(room.type);
  for (const r of save?.survivalW?.recipes ?? []) out.recipes.add(r);
  for (const c of save?.unlockableMgr?.claimed ?? [])
    if (typeof c === 'string') out.roomUnlocks.add(c);
  return out;
}

// Categories whose orphans are game-breaking (hard fail in strict mode) vs advisory.
const HARD = new Set(['weapons', 'outfits', 'junk', 'pets', 'rooms', 'uniqueDwellers']);

// Structural/scenery tiles that are real save room types but deliberately absent from the
// room catalog (the app treats them as non-rooms - see src/domain/rooms/layout.ts
// FAKE_WASTELAND_TYPE). Referencing one is expected, not an orphan.
const KNOWN_NON_CATALOG_ROOMS = new Set(['FakeWasteland']);

function checkOrphans(referenced, source) {
  for (const [cat, refs] of Object.entries(referenced)) {
    const known = idSets[cat];
    let orphans = [...refs].filter((id) => !known.has(id));
    if (cat === 'rooms') orphans = orphans.filter((id) => !KNOWN_NON_CATALOG_ROOMS.has(id));
    if (orphans.length === 0) continue;
    const sample = orphans.slice(0, 8).join(', ') + (orphans.length > 8 ? ', …' : '');
    const msg = `${orphans.length} ${cat} id(s) in ${source} not in new gamedata: ${sample}`;
    if (HARD.has(cat)) fail('save-ids', msg);
    else warn('save-ids', msg);
  }
}

const realSave = saveArg ?? join(REPO_ROOT, 'Vault1.sav');
const fixture = join(REPO_ROOT, 'tests', 'fixtures', 'vault1-ids.json');
if (existsSync(realSave)) {
  try {
    const { decode } = await import('../src/domain/codec/saveCodec.ts');
    const save = await decode(readFileSync(realSave, 'utf8'));
    checkOrphans(collectSaveIds(save), `Vault1.sav`);
    info(
      'save-ids',
      `resolved ids from real save (${save?.dwellers?.dwellers?.length ?? 0} dwellers)`,
    );
  } catch (err) {
    warn('save-ids', `could not decode ${realSave}: ${err.message}`);
  }
} else if (existsSync(fixture)) {
  const refs = JSON.parse(readFileSync(fixture, 'utf8')).referenced ?? {};
  const referenced = Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, new Set(v)]));
  checkOrphans(referenced, 'fixture');
  info('save-ids', 'resolved ids from committed sanitized fixture');
} else {
  warn('save-ids', 'no save or fixture available - id-resolution check skipped');
}

// --- report ---------------------------------------------------------------------
const ICON = { fail: '✗', warn: '!', info: '·' };
console.log('\nGame-data verification\n');
for (const area of ['schema', 'meta', 'diff', 'save-ids']) {
  const group = findings.filter((f) => f.area === area);
  if (group.length === 0) continue;
  console.log(`[${area}]`);
  for (const f of group) console.log(`  ${ICON[f.level]} ${f.msg}`);
}

const fails = findings.filter((f) => f.level === 'fail').length;
const warns = findings.filter((f) => f.level === 'warn').length;
console.log(`\n${fails} failure(s), ${warns} warning(s).`);

if (MODE_STRICT && fails > 0) {
  console.error('verify: FAILED (strict mode).');
  process.exit(1);
}
process.exit(0);
