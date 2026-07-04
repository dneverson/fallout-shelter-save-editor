import type { GameData } from '../gamedata/gameData.ts';
import type { Dweller, Room, SaveData } from '../model/saveSchema.ts';
import { readSpecial, type SpecialValues } from '../selectors/dwellerSelectors.ts';
import { averageHappiness } from '../selectors/advisorSelectors.ts';
import {
  STAT_KEYS,
  statKeyForSpecial,
  suggestOutfitForStat,
  suggestWeapon,
  type StatKey,
} from '../selectors/loadoutSuggest.ts';
import { createDwellerAtDoor, setHappiness, setLevel, setStat } from './dwellerOps.ts';
import { randomDwellerName } from './dwellerNames.ts';
import { applyLoadout } from './loadoutOps.ts';
import { assignDweller } from './roomOps.ts';

// Auto-staff (Rooms-tab "Auto-staff rooms" action). Fills rooms' empty work slots from the
// pool of idle dwellers, highest-stat-first per room. When the pool runs dry it can GENERATE
// the shortfall as fresh, named dwellers whose level / SPECIAL / happiness are sampled around
// the vault's own averages (a new vault gets weak recruits, a veteran vault gets strong ones),
// each equipped with that room type's preset outfit + best weapon.
//
// IMPORTANT - occupancy is read from each room's `dwellers[]` ROSTER, the assignment list
// the game actually uses (verified against a genuine save: exploring/idle dwellers keep
// their roster slot while their `savedRoom` is -1). Keying off savedRoom under-counted
// staff and made auto-staff try to over-fill already-full rooms. Ghost roster entries
// (ids with no matching dweller) are ignored; the health check owns cleaning those.
//
// Pure + composed from the existing primitives, so every run is one undoable edit and matches
// how the rest of the app mutates dwellers. RNG is injectable for deterministic tests.

/** Which rooms a run targets: every SPECIAL room, or only resource producers. */
export type StaffMode = 'all' | 'output';

const isAlive = (d: Dweller): boolean => (d.health?.healthValue ?? 1) > 0;

/** Every dweller id on some room's roster (the game's assignment lists). */
function rosteredIds(save: SaveData): Set<number> {
  const ids = new Set<number>();
  for (const room of save.vault?.rooms ?? []) {
    for (const id of room.dwellers ?? []) ids.add(id);
  }
  return ids;
}

/** Idle = alive and on NO room's roster, matching the advisor. */
function idleDwellers(save: SaveData): Dweller[] {
  const rostered = rosteredIds(save);
  return (save.dwellers?.dwellers ?? []).filter(
    (d) => isAlive(d) && typeof d.serializeId === 'number' && !rostered.has(d.serializeId),
  );
}

/**
 * Occupied slots per room: roster entries that match a REAL dweller (dead dwellers still
 * hold their slot in-game; ghost ids are ignored).
 */
function occupancyByRoom(save: SaveData): Map<number, number> {
  const existing = new Set((save.dwellers?.dwellers ?? []).map((d) => d.serializeId));
  const map = new Map<number, number>();
  for (const room of save.vault?.rooms ?? []) {
    const n = (room.dwellers ?? []).filter((id) => existing.has(id)).length;
    if (n > 0) map.set(room.deserializeID, n);
  }
  return map;
}

/** A stat-driven room with empty work slots. */
interface OpenRoom {
  deserializeID: number;
  type: string;
  statKey: StatKey;
  free: number;
  isProducer: boolean;
}

const PRIMARY_PRODUCED = ['Food', 'Water', 'Energy', 'StimPack', 'RadAway'] as const;

/** Max work slots for a room at its (mergeLevel, level), or 0 if unknown. */
function maxDwellersOf(gameData: GameData, room: Room): number {
  if (room.mergeLevel === undefined || room.level === undefined) return 0;
  return (
    gameData.roomCapacity.rooms[room.type]?.[String(room.mergeLevel)]?.[String(room.level)]
      ?.maxDwellers ?? 0
  );
}

/** Does the room produce a primary resource at its current size? */
function isProducerRoom(gameData: GameData, room: Room): boolean {
  if (room.mergeLevel === undefined || room.level === undefined) return false;
  const prod =
    gameData.roomProduction.rooms[room.type]?.[String(room.mergeLevel)]?.[String(room.level)]
      ?.produced ?? {};
  return PRIMARY_PRODUCED.some((r) => (prod[r] ?? 0) > 0);
}

/**
 * Stat-driven rooms (a SPECIAL primaryStat - excludes elevators / no-stat facilities) with
 * empty slots, occupancy by authoritative savedRoom, ordered most-empty-first (tie-break by
 * id) for a stable fill order. `mode` 'output' keeps only resource producers. `onlyRoomId`
 * narrows the sweep to a single room by deserializeID (the per-room "Auto-staff this room"
 * action); omit it to target every room matching `mode`.
 */
function openRooms(
  save: SaveData,
  gameData: GameData,
  mode: StaffMode,
  onlyRoomId?: number,
): OpenRoom[] {
  const occ = occupancyByRoom(save);
  const out: OpenRoom[] = [];
  for (const room of save.vault?.rooms ?? []) {
    if (onlyRoomId !== undefined && room.deserializeID !== onlyRoomId) continue;
    const statKey = statKeyForSpecial(gameData.roomMetadataByType.get(room.type)?.primaryStat);
    if (!statKey) continue;
    const isProducer = isProducerRoom(gameData, room);
    if (mode === 'output' && !isProducer) continue;
    const free = maxDwellersOf(gameData, room) - (occ.get(room.deserializeID) ?? 0);
    if (free > 0) {
      out.push({ deserializeID: room.deserializeID, type: room.type, statKey, free, isProducer });
    }
  }
  return out.sort((a, b) => b.free - a.free || a.deserializeID - b.deserializeID);
}

export interface AutoStaffPlan {
  /** Total empty work slots across the targeted rooms. */
  freeSlots: number;
  /** Idle alive dwellers available to assign. */
  idle: number;
  /** Slots that will be filled from existing idle dwellers. */
  toAssign: number;
  /** Slots that would require generating new dwellers. */
  toGenerate: number;
}

/**
 * Predict what an auto-staff run will do (drives the button counts + confirm + toast).
 * `onlyRoomId` scopes the prediction to a single room (the per-room button); omit for `mode`.
 */
export function autoStaffPlan(
  save: SaveData,
  gameData: GameData,
  mode: StaffMode,
  onlyRoomId?: number,
): AutoStaffPlan {
  const freeSlots = openRooms(save, gameData, mode, onlyRoomId).reduce((n, r) => n + r.free, 0);
  const idle = idleDwellers(save).length;
  const toAssign = Math.min(freeSlots, idle);
  return { freeSlots, idle, toAssign, toGenerate: freeSlots - toAssign };
}

/** Round to an int and clamp into [lo, hi]. */
function clampRound(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

/** Vault baselines that scale generated recruits (avg level + per-stat averages + happiness). */
interface Baselines {
  avgLevel: number;
  avgStat: SpecialValues;
  avgHappiness: number;
}

function computeBaselines(save: SaveData): Baselines {
  const alive = (save.dwellers?.dwellers ?? []).filter(isAlive);
  const happiness = averageHappiness(save) || 50;
  if (alive.length === 0) {
    const ones = {} as SpecialValues;
    for (const k of STAT_KEYS) ones[k] = 1;
    return { avgLevel: 1, avgStat: ones, avgHappiness: happiness };
  }
  const levelSum = alive.reduce((n, d) => n + (d.experience?.currentLevel ?? 1), 0);
  const statSum = {} as Record<StatKey, number>;
  for (const k of STAT_KEYS) statSum[k] = 0;
  for (const d of alive) {
    const sp = readSpecial(d);
    for (const k of STAT_KEYS) statSum[k] += sp[k];
  }
  const avgStat = {} as SpecialValues;
  for (const k of STAT_KEYS) avgStat[k] = statSum[k] / alive.length;
  return { avgLevel: levelSum / alive.length, avgStat, avgHappiness: happiness };
}

/**
 * Generate one recruit tailored to `room` and assign it. Level, happiness and every SPECIAL
 * are sampled around the vault's averages (so the recruit blends with the vault rather than
 * being a clone), with the room's primary stat biased upward (+2 over its average, then
 * jittered) so the recruit is genuinely useful there - without hard-pinning it to 10. NOTE:
 * a fully-maxed vault has averages near 10, so its recruits will also be near 10 - that's the
 * scaling working, not a lack of randomness. The recruit gets a random name + the strongest
 * outfit for the room's stat + the best weapon so it spawns named, clothed and armed.
 */
function generateAndAssign(
  save: SaveData,
  gameData: GameData,
  room: OpenRoom,
  base: Baselines,
  rng: () => number,
): SaveData {
  const jitter = (spread: number): number => (rng() * 2 - 1) * spread;

  const levelBand = Math.max(1, base.avgLevel * 0.25);
  const targetLevel = clampRound(base.avgLevel + jitter(levelBand), 1, 50);
  const happiness = clampRound(base.avgHappiness, 0, 100);
  const gender = rng() < 0.5 ? 1 : 2;
  const { name, lastName } = randomDwellerName(gender, rng);

  let next = createDwellerAtDoor(save, { gender, name, lastName });
  const id = next.dwellers?.id;
  if (typeof id !== 'number') return save; // createDwellerAtDoor always sets id; guard for types

  next = setLevel(next, id, targetLevel);
  next = setHappiness(next, id, happiness);
  STAT_KEYS.forEach((k, i) => {
    // Primary stat is centered +2 above its vault average; the rest center on their average.
    const center = k === room.statKey ? base.avgStat[k] + 2 : base.avgStat[k];
    next = setStat(next, id, i + 1, clampRound(center + jitter(1.5), 1, 10));
  });

  const outfit = suggestOutfitForStat(gameData, room.statKey);
  const weapon = suggestWeapon(gameData);
  next = applyLoadout(next, [id], {
    ...(outfit ? { outfitId: outfit.id } : {}),
    ...(weapon ? { weaponId: weapon.id } : {}),
  });

  return assignDweller(next, room.deserializeID, id);
}

/** Sort idle candidates strongest-first for a room's stat (tie: total SPECIAL, then id). */
function byStat(statKey: StatKey): (a: Dweller, b: Dweller) => number {
  return (a, b) => {
    const sa = readSpecial(a);
    const sb = readSpecial(b);
    if (sb[statKey] !== sa[statKey]) return sb[statKey] - sa[statKey];
    const ta = STAT_KEYS.reduce((n, k) => n + sa[k], 0);
    const tb = STAT_KEYS.reduce((n, k) => n + sb[k], 0);
    if (tb !== ta) return tb - ta;
    return (a.serializeId ?? 0) - (b.serializeId ?? 0);
  };
}

export interface AutoStaffOpts {
  /** Which rooms to target (every stat room, or only producers). */
  mode: StaffMode;
  /** Generate new dwellers for slots the idle pool can't cover. */
  generate: boolean;
  /**
   * Assign existing idle dwellers first (default true). Set false for a "generate only" run
   * that staffs every empty slot with fresh recruits and leaves idle dwellers untouched.
   */
  assignExisting?: boolean;
  /** Injectable RNG for deterministic tests (defaults to Math.random). */
  rng?: () => number;
  /**
   * Target only this room (by deserializeID) - the per-room "Auto-staff this room" action.
   * Omit to target every room matching `mode`.
   */
  onlyRoomId?: number;
}

/**
 * Fill the targeted rooms' empty slots. Phase A (unless `assignExisting` is false) assigns
 * idle dwellers highest-stat-first per room (existing gear untouched). Phase B, when
 * `generate` is set, creates one tailored, equipped recruit per remaining slot. Returns a new
 * save (one undoable edit); pure aside from the supplied/`Math.random` RNG used for generation.
 */
export function autoStaff(save: SaveData, gameData: GameData, opts: AutoStaffOpts): SaveData {
  const rng = opts.rng ?? Math.random;
  const rooms = openRooms(save, gameData, opts.mode, opts.onlyRoomId);
  const idle = idleDwellers(save);
  const pool = new Set(idle.map((d) => d.serializeId));
  const byId = new Map(idle.map((d) => [d.serializeId, d]));

  let next = save;
  // Phase A - assign existing idle dwellers, best-fit per room (skipped for generate-only).
  if (opts.assignExisting !== false) {
    for (const room of rooms) {
      if (room.free <= 0) continue;
      const sorted = [...pool]
        .map((id) => byId.get(id))
        .filter((d): d is Dweller => d !== undefined)
        .sort(byStat(room.statKey));
      for (const d of sorted) {
        if (room.free <= 0) break;
        next = assignDweller(next, room.deserializeID, d.serializeId);
        pool.delete(d.serializeId);
        room.free -= 1;
      }
    }
  }

  // Phase B - generate recruits for whatever slots remain (baselines from the original save).
  if (opts.generate) {
    const base = computeBaselines(save);
    for (const room of rooms) {
      while (room.free > 0) {
        next = generateAndAssign(next, gameData, room, base, rng);
        room.free -= 1;
      }
    }
  }

  return next;
}
