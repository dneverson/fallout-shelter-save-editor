import type { GameData } from '../gamedata/gameData.ts';
import type { RoomProduction } from '../gamedata/schemas.ts';
import type { Dweller, Room, SaveData } from '../model/saveSchema.ts';
import { readSpecial, type SpecialValues } from './dwellerSelectors.ts';

// Advisor / analytics domain. PURE functions
// that compute, from the live save + the extracted production catalog, a per-resource
// economy (production vs consumption rate), per-room staffing analysis, and an advisory
// recommendation list. No auto-fix - every recommendation carries a deep-link the UI
// resolves to the relevant section/room/dweller.
//
// Formulas are reverse-engineered from the decompiled game:
//   producedPerMin(R) = produced[R] × efficiency / taskCycle            (÷60 ×60 cancels)
//   efficiency        = (Σ assigned effectiveStat(roomStat) + deco0) / (maxDwellers×10)
//                       × (1 + happinessFactor(avgVaultHappiness))
//   foodUse/min       = aliveDwellers × foodPerDweller / period × 60
//   energyUse/min     = Σ poweredRooms.consumption[Energy] / energyPeriod × 60

/** ESpecialStat name (room primaryStat) → SPECIAL key. "None" rooms have no stat. */
const STAT_KEY: Record<string, keyof SpecialValues> = {
  Strength: 'S',
  Perception: 'P',
  Endurance: 'E',
  Charisma: 'C',
  Intelligence: 'I',
  Agility: 'A',
  Luck: 'L',
};

/** Resources whose production drives sustainability (Nuka is a universal byproduct). */
const PRIMARY_PRODUCED = ['Food', 'Water', 'Energy', 'StimPack', 'RadAway'] as const;

/** Status of one resource's economy: 🟢 surplus · 🟡 thin · 🔴 deficit. */
export type EconomyStatus = 'ok' | 'warn' | 'deficit';

export interface ResourceLine {
  /** Save resource key (Food/Water/Energy/…). */
  resource: string;
  /** Current stored amount. */
  stock: number;
  /** Production per minute at current staffing (only working, powered rooms). */
  production: number;
  /** Consumption per minute (dwellers for food/water, powered rooms for energy). */
  consumption: number;
  /** production − consumption. */
  net: number;
  status: EconomyStatus;
}

export interface RoomAnalysis {
  deserializeID: number;
  type: string;
  /** Localized room name. */
  name: string;
  row: number | null;
  col: number | null;
  level: number | null;
  mergeLevel: number | null;
  /** SPECIAL key the room runs on, or null for non-stat rooms. */
  statKey: keyof SpecialValues | null;
  /** Alive dwellers assigned (by savedRoom). */
  assigned: number;
  /** Max dweller slots at the room's (mergeLevel, level). */
  maxDwellers: number;
  /** Working efficiency [0..>1]; 1.0 = fully staffed with stat-maxed dwellers. */
  efficiency: number;
  /** Does the room produce a primary resource? */
  isProducer: boolean;
  powered: boolean;
  broken: boolean;
}

export type RecommendationSeverity = 'high' | 'medium' | 'low';

/** Where a recommendation deep-links. Section is a string the UI maps to its nav. */
export interface DeepLink {
  section: 'rooms' | 'dwellers' | 'vault';
  roomId?: number;
  dwellerId?: number;
}

export interface Recommendation {
  id: string;
  severity: RecommendationSeverity;
  title: string;
  detail: string;
  link: DeepLink;
}

export interface AdvisorReport {
  resources: ResourceLine[];
  rooms: RoomAnalysis[];
  recommendations: Recommendation[];
  /** Average happiness of alive, non-child dwellers (VaultStats.UpdateHappiness). */
  averageHappiness: number;
  /** Production bonus from happiness, e.g. 0.1 = +10%. */
  happinessBonus: number;
  aliveDwellers: number;
  /** Count surfaced on the top-bar alert badge (= recommendations.length). */
  issueCount: number;
}

const roomsOf = (save: SaveData): Room[] => save.vault?.rooms ?? [];
const dwellersOf = (save: SaveData): Dweller[] => save.dwellers?.dwellers ?? [];

const isAlive = (d: Dweller): boolean => (d.health?.healthValue ?? 1) > 0;

/** Effective SPECIAL for a stat = base value + the dweller's outfit SPECIAL bonus. */
function effectiveStat(dweller: Dweller, key: keyof SpecialValues, gameData: GameData): number {
  const base = readSpecial(dweller)[key];
  const outfitId = dweller.equipedOutfit?.id;
  const bonus = outfitId ? (gameData.outfitById.get(outfitId)?.special[key] ?? 0) : 0;
  return base + bonus;
}

/**
 * Happiness → production bonus factor, replicating HappinessProductionParameters.GetIndex
 * (C# integer division, so `Math.trunc`). `list` is the extracted m_factorList.
 */
export function happinessFactor(avgHappiness: number, list: number[]): number {
  if (list.length === 0) return 0;
  const num = Math.floor(avgHappiness) - 1;
  const idx = num === 0 ? 0 : Math.min(list.length - 1, Math.trunc(num / (list.length - 1)) + 1);
  return list[Math.max(0, idx)] ?? 0;
}

/** Average happiness of alive, non-child dwellers (children excluded as in VaultStats). */
export function averageHappiness(save: SaveData): number {
  const values: number[] = [];
  for (const d of dwellersOf(save)) {
    if (!isAlive(d)) continue;
    const h = d.happiness?.happinessValue;
    if (typeof h === 'number') values.push(h);
  }
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Per-(mergeLevel, level) production entry for a room, or null if unknown. */
function levelProduction(catalog: RoomProduction, room: Room) {
  if (room.mergeLevel === undefined || room.level === undefined) return null;
  return catalog.rooms[room.type]?.[String(room.mergeLevel)]?.[String(room.level)] ?? null;
}

/**
 * Alive dwellers assigned to a room, joined by the room's `dwellers` ROSTER - the true
 * assignment the game uses. `savedRoom` is only the dweller's physical position and
 * legitimately diverges (exploring/idle dwellers keep their roster slot with savedRoom
 * -1), so joining by it under-counted staff: the advisory said "3/4" while the occupants
 * list correctly showed 4/4.
 */
function assignedAlive(save: SaveData, room: Room): Dweller[] {
  const roster = new Set(room.dwellers ?? []);
  return dwellersOf(save).filter(
    (d) => typeof d.serializeId === 'number' && roster.has(d.serializeId) && isAlive(d),
  );
}

/**
 * Working efficiency for a room (Room.GetWorkingEfficiency): summed effective stat of
 * assigned dwellers over the room's capacity, scaled by the happiness production bonus.
 */
function roomEfficiency(
  assigned: Dweller[],
  statKey: keyof SpecialValues | null,
  maxDwellers: number,
  gameData: GameData,
  happyBonus: number,
): number {
  if (statKey === null || maxDwellers <= 0) return 0;
  let statSum = 0;
  for (const d of assigned) statSum += effectiveStat(d, statKey, gameData);
  return (statSum / (maxDwellers * 10)) * (1 + happyBonus);
}

/** Analyze every room: staffing, efficiency, producer/powered/broken flags. */
function analyzeRooms(save: SaveData, gameData: GameData, happyBonus: number): RoomAnalysis[] {
  const { roomProduction, roomCapacity, roomMetadataByType } = gameData;
  return roomsOf(save).map((room) => {
    const meta = roomMetadataByType.get(room.type);
    const statKey = meta ? (STAT_KEY[meta.primaryStat] ?? null) : null;
    const cap =
      room.mergeLevel !== undefined && room.level !== undefined
        ? (roomCapacity.rooms[room.type]?.[String(room.mergeLevel)]?.[String(room.level)] ?? null)
        : null;
    const maxDwellers = cap?.maxDwellers ?? 0;
    const alive = assignedAlive(save, room);
    // Slot occupancy counts every roster entry that matches a REAL dweller - a dead dweller
    // still holds its slot in-game (it can be revived in place), it just produces nothing.
    const existingIds = new Set(dwellersOf(save).map((d) => d.serializeId));
    const occupied = (room.dwellers ?? []).filter((id) => existingIds.has(id)).length;
    const prod = levelProduction(roomProduction, room);
    const isProducer = prod ? PRIMARY_PRODUCED.some((r) => (prod.produced[r] ?? 0) > 0) : false;
    return {
      deserializeID: room.deserializeID,
      type: room.type,
      name: meta?.name ?? room.type,
      row: room.row ?? null,
      col: room.col ?? null,
      level: room.level ?? null,
      mergeLevel: room.mergeLevel ?? null,
      statKey,
      assigned: occupied,
      maxDwellers,
      efficiency: roomEfficiency(alive, statKey, maxDwellers, gameData, happyBonus),
      isProducer,
      powered: room.power !== false,
      broken: room.broken === true,
    };
  });
}

/** Per-minute production of each resource across all working, powered rooms. */
function computeProduction(save: SaveData, gameData: GameData, happyBonus: number) {
  const { roomProduction } = gameData;
  const { taskCycle } = roomProduction.globals;
  const totals: Record<string, number> = {};
  for (const room of roomsOf(save)) {
    if (room.power === false || room.broken === true) continue;
    const prod = levelProduction(roomProduction, room);
    if (!prod) continue;
    const meta = gameData.roomMetadataByType.get(room.type);
    const statKey = meta ? (STAT_KEY[meta.primaryStat] ?? null) : null;
    const cap =
      room.mergeLevel !== undefined && room.level !== undefined
        ? (gameData.roomCapacity.rooms[room.type]?.[String(room.mergeLevel)]?.[
            String(room.level)
          ] ?? null)
        : null;
    const maxDwellers = cap?.maxDwellers ?? 0;
    const eff = roomEfficiency(
      assignedAlive(save, room),
      statKey,
      maxDwellers,
      gameData,
      happyBonus,
    );
    if (eff <= 0) continue;
    for (const [resource, amount] of Object.entries(prod.produced)) {
      // perMin = produced × eff / taskCycle (the ÷60 ×60 cancel - see source notes).
      totals[resource] = (totals[resource] ?? 0) + (amount * eff) / taskCycle;
    }
  }
  return totals;
}

/** Per-minute consumption: food/water from alive dwellers, energy from powered rooms. */
function computeConsumption(save: SaveData, gameData: GameData) {
  const g = gameData.roomProduction.globals;
  const alive = dwellersOf(save).filter(isAlive).length;
  const totals: Record<string, number> = {
    Food: (alive * g.foodConsumptionPerDweller * 60) / g.dwellerConsumptionPeriod,
    Water: (alive * g.waterConsumptionPerDweller * 60) / g.dwellerConsumptionPeriod,
    Energy: 0,
  };
  for (const room of roomsOf(save)) {
    if (room.power === false) continue;
    const prod = levelProduction(gameData.roomProduction, room);
    const energy = prod?.consumption.Energy ?? 0;
    if (energy) totals.Energy += (energy * 60) / g.energyConsumptionPeriod;
  }
  return totals;
}

function statusFor(production: number, consumption: number): EconomyStatus {
  if (consumption <= 0) return 'ok';
  const net = production - consumption;
  if (net < 0) return 'deficit';
  if (net < consumption * 0.2) return 'warn';
  return 'ok';
}

/** Tracked resources, in display order. */
const TRACKED = ['Food', 'Water', 'Energy', 'StimPack', 'RadAway', 'Nuka'] as const;

function computeResourceLines(
  save: SaveData,
  gameData: GameData,
  happyBonus: number,
): ResourceLine[] {
  const production = computeProduction(save, gameData, happyBonus);
  const consumption = computeConsumption(save, gameData);
  const stock = save.vault?.storage?.resources ?? {};
  return TRACKED.map((resource) => {
    const prod = production[resource] ?? 0;
    const use = consumption[resource] ?? 0;
    return {
      resource,
      stock: stock[resource] ?? 0,
      production: prod,
      consumption: use,
      net: prod - use,
      status: statusFor(prod, use),
    };
  });
}

const RESOURCE_ROOM_HINT: Record<string, string> = {
  Food: 'food rooms (Diner/Garden)',
  Water: 'water rooms (Water Treatment)',
  Energy: 'power rooms (Power Generator/Reactor)',
};

/** Build the advisory recommendation list (advisory + deep-link, never auto-fix). */
function buildRecommendations(
  save: SaveData,
  resources: ResourceLine[],
  rooms: RoomAnalysis[],
  avgHappiness: number,
  happyBonus: number,
): Recommendation[] {
  const recs: Recommendation[] = [];

  // 1. Resources running a deficit (highest priority).
  for (const line of resources) {
    if (line.status === 'deficit') {
      recs.push({
        id: `deficit-${line.resource}`,
        severity: 'high',
        title: `${line.resource} deficit (${line.net.toFixed(1)}/min)`,
        detail: `Consumption (${line.consumption.toFixed(1)}/min) outpaces production (${line.production.toFixed(1)}/min). Build or staff more ${RESOURCE_ROOM_HINT[line.resource] ?? `${line.resource} rooms`}.`,
        link: { section: 'rooms' },
      });
    } else if (line.status === 'warn') {
      recs.push({
        id: `thin-${line.resource}`,
        severity: 'low',
        title: `${line.resource} margin is thin`,
        detail: `Production barely exceeds consumption (net ${line.net.toFixed(1)}/min). Consider more capacity before adding dwellers.`,
        link: { section: 'rooms' },
      });
    }
  }

  // 2. Broken producer rooms (produce nothing until repaired).
  for (const r of rooms) {
    if (r.broken && r.isProducer) {
      recs.push({
        id: `broken-${r.deserializeID}`,
        severity: 'medium',
        title: `${r.name} is broken`,
        detail: `${r.name}${r.row !== null ? ` (floor ${r.row})` : ''} is damaged and produces nothing until repaired.`,
        link: { section: 'rooms', roomId: r.deserializeID },
      });
    }
  }

  // 3. Understaffed producer rooms (empty slots).
  for (const r of rooms) {
    if (!r.broken && r.isProducer && r.maxDwellers > 0 && r.assigned < r.maxDwellers) {
      recs.push({
        id: `understaffed-${r.deserializeID}`,
        severity: 'medium',
        title: `${r.name} is understaffed (${r.assigned}/${r.maxDwellers})`,
        detail: `Assign ${r.maxDwellers - r.assigned} more dweller${r.maxDwellers - r.assigned > 1 ? 's' : ''}${r.statKey ? ` with high ${r.statKey}` : ''} to raise output.`,
        link: { section: 'rooms', roomId: r.deserializeID },
      });
    }
  }

  // 4. Idle dwellers: alive and on NO room's roster (savedRoom alone is unreliable -
  // explorers and rostered-but-wandering dwellers also carry savedRoom -1).
  const rosteredIds = new Set<number>();
  for (const room of roomsOf(save)) for (const id of room.dwellers ?? []) rosteredIds.add(id);
  const idle = dwellersOf(save).filter(
    (d) => isAlive(d) && typeof d.serializeId === 'number' && !rosteredIds.has(d.serializeId),
  ).length;
  if (idle > 0) {
    recs.push({
      id: 'idle-dwellers',
      severity: 'medium',
      title: `${idle} dweller${idle > 1 ? 's' : ''} unassigned`,
      detail: `${idle} alive dweller${idle > 1 ? 's are' : ' is'} standing at the vault door doing no work. Assign them to rooms.`,
      link: { section: 'dwellers' },
    });
  }

  // 5. Low average happiness (production-bonus driver).
  if (avgHappiness > 0 && avgHappiness < 80) {
    recs.push({
      id: 'low-happiness',
      severity: 'low',
      title: `Average happiness is ${avgHappiness.toFixed(0)}%`,
      detail: `The vault-wide production bonus is only +${(happyBonus * 100).toFixed(0)}%. Raise happiness (radio room, partners, fed/hydrated) for up to +${10}% output.`,
      link: { section: 'dwellers' },
    });
  }

  return recs;
}

/** Top-level Advisor report: resource economy + room staffing + recommendations. */
export function computeAdvisor(save: SaveData, gameData: GameData): AdvisorReport {
  const avgHappiness = averageHappiness(save);
  const happyBonus = happinessFactor(
    avgHappiness,
    gameData.roomProduction.globals.happinessFactorList,
  );
  const rooms = analyzeRooms(save, gameData, happyBonus);
  const resources = computeResourceLines(save, gameData, happyBonus);
  const recommendations = buildRecommendations(save, resources, rooms, avgHappiness, happyBonus);
  return {
    resources,
    rooms,
    recommendations,
    averageHappiness: avgHappiness,
    happinessBonus: happyBonus,
    aliveDwellers: dwellersOf(save).filter(isAlive).length,
    issueCount: recommendations.length,
  };
}
