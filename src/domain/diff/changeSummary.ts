import type { Dweller, Room, SaveData } from '../model/saveSchema.ts';
import { isLosslessInt } from '../codec/losslessJson.ts';

// Pre-export change summary. A pure
// snapshot diff of the decoded ORIGINAL save against the current working save - no edit
// journal, so it reflects real state rather than intentions and needs nothing threaded
// through the ops or undo/redo. It only knows how to describe the structured edit surface
// (the dweller fields the ops touch + inventory item count); any other top-level key
// that changed is surfaced generically as a safety net.

/** One changed field on a dweller, rendered as a plain "before → after" line. */
export interface FieldChange {
  label: string;
  before: string;
  after: string;
}

/** A dweller that was added or removed (identified for the summary list). */
export interface DwellerRef {
  serializeId: number;
  name: string;
}

/** A dweller present in both saves whose edit-surface fields differ. */
export interface DwellerModification extends DwellerRef {
  fields: FieldChange[];
}

/** A room present in both saves whose tracked fields differ ("Diner #26"). */
export interface RoomModification {
  label: string;
  fields: FieldChange[];
}

/** A generic leaf-level change anywhere in the save (the granular safety net). */
export interface PathChange {
  /** JSONPath-ish location, e.g. `MysteriousStranger.timeToAppear`. */
  path: string;
  before: string;
  after: string;
}

export interface ChangeSummary {
  dwellersAdded: DwellerRef[];
  dwellersRemoved: DwellerRef[];
  dwellersModified: DwellerModification[];
  /** Room labels built / removed, and per-room field changes (level/power/workers/…). */
  roomsAdded: string[];
  roomsRemoved: string[];
  roomsModified: RoomModification[];
  /** Resource amounts that changed (label = resource key, e.g. "Nuka"). */
  resourcesChanged: FieldChange[];
  /** Per-item stored-count changes (label = item id, e.g. "StimPack ×12 → ×25"). */
  itemsChanged: FieldChange[];
  /** Openable-box count changes by type (Lunchbox / Mr. Handy box / Pet carrier / …). */
  boxesChanged: FieldChange[];
  /** Recipe ids unlocked / removed (survivalW.recipes). */
  recipesAdded: string[];
  recipesRemoved: string[];
  /** Set when the stored inventory item count changed (e.g. a pet attached/detached). */
  inventoryDelta: { before: number; after: number } | null;
  /**
   * Leaf-level changes in every part of the save NOT covered above (managers, actors,
   * vault name/theme, rocks, …), so no edit ever shows as an unexplained label.
   */
  otherChanges: PathChange[];
  /** How many more `otherChanges` exist beyond the display cap. */
  otherChangesTruncated: number;
  /** Generic labels for any other top-level section whose reference changed. */
  otherSectionsChanged: string[];
  hasChanges: boolean;
}

const GENDER: Record<number, string> = { 1: 'Female', 2: 'Male' };
const SPECIAL_NAMES = [
  'Strength',
  'Perception',
  'Endurance',
  'Charisma',
  'Intelligence',
  'Agility',
  'Luck',
];

const num = (n: number | undefined): string => (n === undefined ? '–' : String(Math.round(n)));
const bool = (b: boolean | undefined): string => (b ? 'yes' : 'no');
const hex = (n: number | undefined): string =>
  n === undefined ? '–' : `#${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

/** Display label for an equipped item slot ("none" when absent). */
function itemLabel(item: Dweller['equippedPet']): string {
  if (!item) return 'none';
  const unique = item.extraData?.uniqueName;
  return unique ? `${item.id} (${unique})` : item.id;
}

const displayName = (d: Dweller): string =>
  [d.name, d.lastName].filter((s) => s).join(' ') || `#${d.serializeId}`;

// Each extractor renders one comparable field of a dweller to a display string. A field
// is reported only when its rendered value differs between the two snapshots.
const FIELD_EXTRACTORS: ReadonlyArray<{ label: string; get: (d: Dweller) => string }> = [
  { label: 'First name', get: (d) => d.name ?? '' },
  { label: 'Last name', get: (d) => d.lastName ?? '' },
  { label: 'Gender', get: (d) => GENDER[d.gender ?? 0] ?? '–' },
  { label: 'Rarity', get: (d) => d.rarity ?? '–' },
  ...SPECIAL_NAMES.map((name, i) => ({
    label: name,
    get: (d: Dweller) => num(d.stats?.stats?.[i + 1]?.value),
  })),
  { label: 'Level', get: (d) => num(d.experience?.currentLevel) },
  { label: 'Health', get: (d) => num(d.health?.healthValue) },
  { label: 'Max HP', get: (d) => num(d.health?.maxHealth) },
  { label: 'Radiation', get: (d) => num(d.health?.radiationValue) },
  { label: 'Happiness', get: (d) => num(d.happiness?.happinessValue) },
  { label: 'Skin color', get: (d) => hex(d.skinColor) },
  { label: 'Hair color', get: (d) => hex(d.hairColor) },
  { label: 'Outfit color', get: (d) => hex(d.outfitColor) },
  { label: 'Hair', get: (d) => d.hair ?? '–' },
  { label: 'Facial hair', get: (d) => d.faceMask ?? 'none' },
  { label: 'Pregnant', get: (d) => bool(d.pregnant) },
  { label: 'Baby ready', get: (d) => bool(d.babyReady) },
  { label: 'Weapon', get: (d) => d.equipedWeapon?.id ?? 'none' },
  { label: 'Outfit', get: (d) => d.equipedOutfit?.id ?? 'none' },
  { label: 'Pet', get: (d) => itemLabel(d.equippedPet) },
];

function diffDweller(
  before: Dweller,
  after: Dweller,
  roomLabel: (id: number | undefined) => string,
): FieldChange[] {
  const fields: FieldChange[] = [];
  for (const { label, get } of FIELD_EXTRACTORS) {
    const b = get(before);
    const a = get(after);
    if (b !== a) fields.push({ label, before: b, after: a });
  }
  // Location is resolved against the save's rooms (not an extractor - it needs context),
  // so an assignment reads "Vault door → Diner #26" instead of raw ids.
  if (before.savedRoom !== after.savedRoom) {
    fields.push({
      label: 'Location',
      before: roomLabel(before.savedRoom),
      after: roomLabel(after.savedRoom),
    });
  }
  return fields;
}

// Per-room comparable fields, rendered like the dweller extractors. Workers resolve to
// dweller names via `nameOf` so an auto-staff step reads as WHO moved WHERE.
const ROOM_EXTRACTORS: ReadonlyArray<{
  label: string;
  get: (r: Room, nameOf: (id: number) => string) => string;
}> = [
  { label: 'Level', get: (r) => num(r.level) },
  { label: 'Powered', get: (r) => bool(r.power) },
  {
    label: 'Workers',
    get: (r, nameOf) => (r.dwellers ?? []).map(nameOf).join(', ') || 'none',
  },
  { label: 'Mr. Handies', get: (r) => String((r.mrHandyList ?? []).length) },
  { label: 'Damage', get: (r) => num(r.roomHealth?.damageValue) },
  { label: 'Merged width', get: (r) => num(r.mergeLevel) },
  { label: 'Theme', get: (r) => r.assignedDecoration ?? 'none' },
  { label: 'State', get: (r) => r.currentStateName ?? '–' },
  {
    label: 'Position',
    get: (r) => (r.row !== undefined || r.col !== undefined ? `row ${r.row}, col ${r.col}` : '–'),
  },
];

const roomKey = (r: Room): string => `${r.type} #${r.deserializeID}`;

function roomMap(save: SaveData): Map<number, Room> {
  const list = save.vault?.rooms;
  const map = new Map<number, Room>();
  if (Array.isArray(list)) for (const r of list) map.set(r.deserializeID, r);
  return map;
}

function dwellerMap(save: SaveData): Map<number, Dweller> {
  const list = save.dwellers?.dwellers;
  const map = new Map<number, Dweller>();
  if (Array.isArray(list)) for (const d of list) map.set(d.serializeId, d);
  return map;
}

const inventoryCount = (save: SaveData): number => save.vault?.inventory?.items?.length ?? 0;

/** Stored-inventory counts by item id. */
function itemCountsById(save: SaveData): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of save.vault?.inventory?.items ?? []) {
    if (typeof item.id === 'string') map.set(item.id, (map.get(item.id) ?? 0) + 1);
  }
  return map;
}

/** ELunchBoxType code → display name (vault.LunchBoxesByType entries). */
const BOX_NAMES: Record<number, string> = {
  0: 'Lunchbox',
  1: 'Mr. Handy box',
  2: 'Pet carrier',
  3: 'Starter pack',
  4: 'Nuka-Cola Quantum',
  5: 'Predefined pack',
  6: 'Victor',
  7: 'Curie',
};

/** Openable-box counts by type code (vault.LunchBoxesByType is an array of codes). */
function boxCounts(save: SaveData): Map<number, number> {
  const raw = (save.vault as Record<string, unknown> | undefined)?.['LunchBoxesByType'];
  const map = new Map<number, number>();
  if (Array.isArray(raw)) {
    for (const code of raw) {
      if (typeof code === 'number') map.set(code, (map.get(code) ?? 0) + 1);
    }
  }
  return map;
}

/** The unlocked-recipe id list (survivalW.recipes). */
function recipeSet(save: SaveData): Set<string> {
  const raw = (save as Record<string, unknown>)['survivalW'];
  const list =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['recipes'] : undefined;
  return new Set(Array.isArray(list) ? list.filter((r): r is string => typeof r === 'string') : []);
}

// Top-level keys whose changes are described specifically elsewhere (so they are not
// double-reported by the generic safety net).
const HANDLED_TOP_KEYS = new Set(['dwellers', 'vault']);

// Save paths already described by a dedicated section above - the generic leaf walker
// skips them so nothing is double-reported.
const WALKER_EXCLUDED = new Set([
  'dwellers.dwellers',
  'vault.rooms',
  'vault.storage.resources',
  'vault.inventory.items',
  'vault.LunchBoxesByType',
  'vault.LunchBoxesCount',
  'survivalW.recipes',
]);

/** Display cap for the generic leaf changes (the walker stops collecting past 3×). */
const MAX_OTHER_CHANGES = 60;

const leafPreview = (v: unknown): string => {
  if (v === undefined) return '–';
  if (isLosslessInt(v)) return v.literal;
  const s = JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
};

/**
 * Generic leaf-level walker for everything without a dedicated section: managers,
 * actors, vault name/theme/rocks, season state, … Reports scalar before→after pairs
 * ("MysteriousStranger.timeToAppear: 300 → 60") so no edit is an unexplained label.
 */
function walkOther(a: unknown, b: unknown, path: string, out: PathChange[]): void {
  if (out.length > MAX_OTHER_CHANGES * 3) return; // hard stop - enough to show the cap
  if (Object.is(a, b) || WALKER_EXCLUDED.has(path)) return;
  if (isLosslessInt(a) || isLosslessInt(b)) {
    const av = leafPreview(a);
    const bv = leafPreview(b);
    if (av !== bv) out.push({ path, before: av, after: bv });
    return;
  }
  const aIsObj = typeof a === 'object' && a !== null && !Array.isArray(a);
  const bIsObj = typeof b === 'object' && b !== null && !Array.isArray(b);
  if (aIsObj && bIsObj) {
    const ar = a as Record<string, unknown>;
    const br = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ar), ...Object.keys(br)])) {
      walkOther(ar[k], br[k], path ? `${path}.${k}` : k, out);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) walkOther(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.push({ path: path || '(root)', before: leafPreview(a), after: leafPreview(b) });
  }
}

/** Diff the decoded original save against the current working save. */
export function summarizeChanges(original: SaveData, current: SaveData): ChangeSummary {
  const before = dwellerMap(original);
  const after = dwellerMap(current);
  const roomsBefore = roomMap(original);
  const roomsAfter = roomMap(current);

  // Resolvers shared by the dweller/room diffs: a savedRoom id → "Diner #26" (falling back
  // to the pre-edit rooms for ids that no longer exist), and a worker id → dweller name.
  const roomLabel = (id: number | undefined): string => {
    if (id === undefined) return '–';
    if (id === -1) return 'Vault door (unassigned)';
    const room = roomsAfter.get(id) ?? roomsBefore.get(id);
    return room ? roomKey(room) : `room #${id}`;
  };
  const nameOf = (id: number): string => {
    const d = after.get(id) ?? before.get(id);
    return d ? displayName(d) : `#${id}`;
  };

  const dwellersAdded: DwellerRef[] = [];
  const dwellersRemoved: DwellerRef[] = [];
  const dwellersModified: DwellerModification[] = [];

  for (const [id, dweller] of after) {
    if (!before.has(id)) dwellersAdded.push({ serializeId: id, name: displayName(dweller) });
  }
  for (const [id, dweller] of before) {
    if (!after.has(id)) dwellersRemoved.push({ serializeId: id, name: displayName(dweller) });
  }
  for (const [id, beforeDweller] of before) {
    const afterDweller = after.get(id);
    // Unchanged dwellers share a reference (structural sharing) - skip the field diff.
    if (!afterDweller || afterDweller === beforeDweller) continue;
    const fields = diffDweller(beforeDweller, afterDweller, roomLabel);
    if (fields.length > 0) {
      dwellersModified.push({ serializeId: id, name: displayName(afterDweller), fields });
    }
  }

  // Rooms: built / removed / field-level changes (level, power, workers, …).
  const roomsAdded: string[] = [];
  const roomsRemoved: string[] = [];
  const roomsModified: RoomModification[] = [];
  for (const [id, room] of roomsAfter) {
    if (!roomsBefore.has(id)) roomsAdded.push(roomKey(room));
  }
  for (const [id, room] of roomsBefore) {
    if (!roomsAfter.has(id)) roomsRemoved.push(roomKey(room));
  }
  for (const [id, beforeRoom] of roomsBefore) {
    const afterRoom = roomsAfter.get(id);
    if (!afterRoom || afterRoom === beforeRoom) continue;
    const fields: FieldChange[] = [];
    for (const { label, get } of ROOM_EXTRACTORS) {
      const b = get(beforeRoom, nameOf);
      const a = get(afterRoom, nameOf);
      if (b !== a) fields.push({ label, before: b, after: a });
    }
    if (fields.length > 0) roomsModified.push({ label: roomKey(afterRoom), fields });
  }

  // Resource amounts (caps, food, water, …) that changed.
  const resourcesChanged: FieldChange[] = [];
  const resBefore = original.vault?.storage?.resources ?? {};
  const resAfter = current.vault?.storage?.resources ?? {};
  if (resBefore !== resAfter) {
    const resKeys = new Set([...Object.keys(resBefore), ...Object.keys(resAfter)]);
    for (const key of resKeys) {
      const b = resBefore[key];
      const a = resAfter[key];
      if (b !== a) resourcesChanged.push({ label: key, before: num(b), after: num(a) });
    }
  }

  const beforeCount = inventoryCount(original);
  const afterCount = inventoryCount(current);
  const inventoryDelta =
    beforeCount !== afterCount ? { before: beforeCount, after: afterCount } : null;

  // Per-item stored counts ("what consumables?" - the count of each item id that moved).
  const itemsChanged: FieldChange[] = [];
  if (original.vault?.inventory?.items !== current.vault?.inventory?.items) {
    const ib = itemCountsById(original);
    const ia = itemCountsById(current);
    for (const id of new Set([...ib.keys(), ...ia.keys()])) {
      const b = ib.get(id) ?? 0;
      const a = ia.get(id) ?? 0;
      if (b !== a) itemsChanged.push({ label: id, before: `×${b}`, after: `×${a}` });
    }
  }

  // Openable-box counts by type (the "Set consumables" card writes these).
  const boxesChanged: FieldChange[] = [];
  {
    const bb = boxCounts(original);
    const ba = boxCounts(current);
    for (const code of new Set([...bb.keys(), ...ba.keys()])) {
      const b = bb.get(code) ?? 0;
      const a = ba.get(code) ?? 0;
      if (b !== a) {
        boxesChanged.push({
          label: BOX_NAMES[code] ?? `box type ${code}`,
          before: `×${b}`,
          after: `×${a}`,
        });
      }
    }
  }

  // Recipes unlocked/removed (survivalW.recipes), listed by id.
  const recipesAdded: string[] = [];
  const recipesRemoved: string[] = [];
  {
    const rb = recipeSet(original);
    const ra = recipeSet(current);
    for (const id of ra) if (!rb.has(id)) recipesAdded.push(id);
    for (const id of rb) if (!ra.has(id)) recipesRemoved.push(id);
  }

  // Generic leaf changes for everything else (managers, actors, vault name/theme, …).
  const allOther: PathChange[] = [];
  walkOther(original, current, '', allOther);
  const otherChanges = allOther.slice(0, MAX_OTHER_CHANGES);
  const otherChangesTruncated = allOther.length - otherChanges.length;

  const otherSectionsChanged: string[] = [];
  const keys = new Set([...Object.keys(original), ...Object.keys(current)]);
  for (const key of keys) {
    if (HANDLED_TOP_KEYS.has(key)) continue;
    if ((original as Record<string, unknown>)[key] !== (current as Record<string, unknown>)[key]) {
      otherSectionsChanged.push(key);
    }
  }

  const hasChanges =
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
    inventoryDelta !== null ||
    otherChanges.length > 0 ||
    otherSectionsChanged.length > 0;

  return {
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
    hasChanges,
  };
}
