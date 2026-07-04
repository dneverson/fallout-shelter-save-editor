// room-production.json - the per-room production/consumption catalog + global
// economy constants the Advisor needs to
// compute per-resource production vs consumption rates. This is what the room-capacity
// catalog does NOT cover: capacity gives the storage CAPS, this gives the resource FLOW.
//
// Formulas reverse-engineered from the decompiled Assembly-CSharp (the same approach as
// the layout validator):
//   ProductionRoom.GetProducedResources():
//     produced = RoomLevel.m_resourcesProduced × workingEfficiency / 60   (added every
//     TaskCycle seconds; the working state's recurrent task fires every TaskCycle)
//   Room.GetWorkingEfficiency(stat):
//     (Σ workingDweller effectiveStat(stat) + decoration) / (maxDwellerCount × 10)
//       × (1 + HappinessProductionParameters.GetHappinessBonusFactor(vaultHappiness))
//   DwellersFood/WaterConsumption: aliveDwellers × consumptionPerDweller per period.
//   RoomConsumption.ConsumeResource: Σ poweredRooms.Consumption per energyPeriod.
// → producedPerMin(R) = produced[R] × eff / 60 / taskCycle × 60. The app layer applies
//   efficiency + happiness from the live save; this catalog ships the raw level values
//   and the global constants.
//
// Sources (our own v2.4.1 export - version-correct, not hardcoded):
//  - one GameObject/<Room>.prefab per ERoomType: RoomInfo.m_LevelControllers[] →
//    LevelController.m_roomLevels[] → RoomLevel docs carrying m_resourcesProduced,
//    m_resourcesReserve (ProductionLevel), and m_consumption (base RoomLevel).
//  - GameObject/VaultLogic.prefab → m_dwellerFoodConsumption / m_dwellerWaterConsumption
//    (m_consumptionPerDweller + m_consumptionPeriod), m_roomConsumption.m_energyConsumptionPeriod.
//  - GameObject/GameParameters.prefab → m_roomParameters.m_class.m_production.m_taskCycle,
//    m_noRushResourcesMultiplier, m_happinessProductionParameters.m_factorList (×production),
//    m_resources.m_waterFoodRequirementScaleFactor.
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PATHS, readJson, readSource, writeOutput } from './lib/io.mjs';
import { numField, parseDocuments, refList, splitLines, subBlockNumbers } from './lib/prefab.mjs';

// GameResources YAML field → save resource key. Power is "Energy" in the save.
const RESOURCE_FIELDS = {
  m_food: 'Food',
  m_water: 'Water',
  m_power: 'Energy',
  m_nuka: 'Nuka',
  m_stimPack: 'StimPack',
  m_radAway: 'RadAway',
  m_nukaQuantum: 'NukaColaQuantum',
  m_dummyUltracite: 'DummyUltracite',
  m_pokerChip: 'PokerChip',
};

/** A GameResources sub-block → { saveKey: number } keeping only nonzero entries. */
function resourceBlock(docText, fieldName) {
  const raw = subBlockNumbers(docText, fieldName);
  const out = {};
  for (const [field, value] of Object.entries(raw)) {
    const key = RESOURCE_FIELDS[field];
    if (key && value) out[key] = value;
  }
  return out;
}

/** The RoomInfo document in a prefab = the one declaring m_LevelControllers, or null. */
function findRoomInfo(docs) {
  for (const doc of docs.values()) {
    if (/^\s*m_LevelControllers:\s*$/m.test(doc)) return doc;
  }
  return null;
}

/** Parse one room prefab → { [mergeLevel]: { [level]: {produced,reserve,consumption} } }. */
function parseRoomProduction(docs, roomInfo) {
  const levels = {};
  refList(roomInfo, 'm_LevelControllers').forEach((cId, ci) => {
    const controller = docs.get(cId);
    if (!controller) return;
    const mergeLevel = ci + 1; // m_LevelControllers[i] ↔ merge level i+1 (RoomInfo.GetLevelController)
    const perLevel = {};
    refList(controller, 'm_roomLevels').forEach((rId, ri) => {
      const roomLevel = docs.get(rId);
      if (!roomLevel) return;
      perLevel[ri + 1] = {
        produced: resourceBlock(roomLevel, 'm_resourcesProduced'),
        reserve: resourceBlock(roomLevel, 'm_resourcesReserve'),
        consumption: resourceBlock(roomLevel, 'm_consumption'),
      };
    });
    if (Object.keys(perLevel).length) levels[mergeLevel] = perLevel;
  });
  return levels;
}

/** The float[] m_factorList from HappinessProductionParameters (10 happiness-bonus tiers). */
function floatArray(docText, fieldName) {
  const lines = splitLines(docText);
  const out = [];
  let inList = false;
  for (const line of lines) {
    if (new RegExp(`^\\s*${fieldName}:\\s*$`).test(line)) {
      inList = true;
      continue;
    }
    if (inList) {
      const m = line.match(/^\s*-\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (m) {
        out.push(Number(m[1]));
        continue;
      }
      if (/^\s*\S/.test(line)) break;
    }
  }
  return out;
}

export function buildRoomProduction() {
  const enums = readJson(PATHS.enums);
  const roomTypeName = invert(enums.ERoomType); // int → name (== save room.type)

  const rooms = {};
  for (const file of readdirSync(PATHS.gameObjectDir)) {
    if (!file.endsWith('.prefab')) continue;
    const text = readSource(`${PATHS.gameObjectDir}/${file}`);
    const docs = parseDocuments(text);
    const roomInfo = findRoomInfo(docs);
    if (!roomInfo) continue;
    const typeInt = numField(roomInfo, 'm_eRoomType');
    if (typeInt === null) continue;
    const name = roomTypeName[typeInt];
    if (!name || name === 'None') continue;
    if (rooms[name]) continue; // first prefab per type wins (mirrors build-room-capacity)
    const levels = parseRoomProduction(docs, roomInfo);
    if (Object.keys(levels).length) rooms[name] = levels;
  }

  // Global economy constants. Dweller food/water consumption + period live in VaultLogic;
  // the production task cycle + happiness factors + multipliers live in GameParameters.
  const vaultLogic = readSource(PATHS.vaultLogic);
  const gameParams = readSource(PATHS.gameParams);
  const vaultDocs = parseDocuments(vaultLogic);
  const gpDocs = parseDocuments(gameParams);
  const vaultLogicDoc = bigDoc(vaultDocs, 'm_dwellerFoodConsumption');
  const gpDoc = bigDoc(gpDocs, 'm_roomParameters');

  const foodPerDweller = resourceBlock(
    blockText(vaultLogicDoc, 'm_dwellerFoodConsumption'),
    'm_consumptionPerDweller',
  );
  const waterPerDweller = resourceBlock(
    blockText(vaultLogicDoc, 'm_dwellerWaterConsumption'),
    'm_consumptionPerDweller',
  );

  return {
    globals: {
      // Production: GetProducedResources divides the per-cycle amount by 60, the working
      // task fires every taskCycle seconds → perSecond = produced × eff / 60 / taskCycle.
      taskCycle: numFieldIn(gpDoc, 'm_taskCycle') ?? 0.1,
      noRushResourcesMultiplier: numField(gpDoc, 'm_noRushResourcesMultiplier') ?? 1,
      // Dweller food/water: consumptionPerDweller per consumptionPeriod seconds, per alive dweller.
      foodConsumptionPerDweller: foodPerDweller.Food ?? 0,
      waterConsumptionPerDweller: waterPerDweller.Water ?? 0,
      dwellerConsumptionPeriod:
        numFieldIn(blockText(vaultLogicDoc, 'm_dwellerFoodConsumption'), 'm_consumptionPeriod') ??
        10,
      // Energy: Σ poweredRooms.Consumption[Energy] per energyConsumptionPeriod seconds.
      energyConsumptionPeriod:
        numFieldIn(blockText(vaultLogicDoc, 'm_roomConsumption'), 'm_energyConsumptionPeriod') ?? 8,
      // Happiness production bonus: factor indexed by average vault happiness (×production).
      happinessFactorList: floatArray(
        blockText(gpDoc, 'm_happinessProductionParameters'),
        'm_factorList',
      ),
    },
    rooms,
  };
}

/** Find the document whose text contains a marker field (for the big config prefabs). */
function bigDoc(docs, marker) {
  for (const doc of docs.values()) {
    if (doc.includes(`${marker}:`)) return doc;
  }
  return '';
}

/**
 * Slice the YAML mapping that starts at `fieldName:` through to the next line dedented
 * to or past its indent - so nested resourceBlock/numField reads stay scoped to it.
 */
function blockText(docText, fieldName) {
  const lines = splitLines(docText);
  const out = [];
  let started = false;
  let indent = -1;
  for (const line of lines) {
    if (!started) {
      const m = line.match(new RegExp(`^(\\s*)${fieldName}:\\s*$`));
      if (m) {
        started = true;
        indent = m[1].length;
        out.push(line);
      }
      continue;
    }
    if (line.trim() && line.match(/^(\s*)/)[1].length <= indent) break;
    out.push(line);
  }
  return out.join('\n');
}

/** numField but for an already-sliced block (first match anywhere in the text). */
function numFieldIn(blockTextValue, fieldName) {
  return numField(blockTextValue, fieldName);
}

/** enums value-map { name: n } → { n: name }. */
function invert(map) {
  const out = {};
  for (const [name, n] of Object.entries(map ?? {})) out[n] = name;
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('room-production.json', buildRoomProduction());
}
