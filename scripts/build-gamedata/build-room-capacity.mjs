// room-capacity.json - the per-room storage/production capacity catalog that the
// "Max resources" button + the storage-capacity meter need. A resource/item cap
// is derived, not stored:
//
//   ResourceMax(R) = base[R] + Σ room.storage[R] at each room's (mergeLevel, level)
//   ItemMax        = baseItems + Σ storage-room.storageItems at its (mergeLevel, level)
//   StimPack/RadAway max = base + perDweller × dwellerCount
//
// Sources (our own v2.4.1 export - version-correct, not hardcoded):
//  - one GameObject/<Room>.prefab per ERoomType holds a RoomInfo MonoBehaviour with
//    m_eRoomType + m_LevelControllers[] (one LevelController per merge level), each
//    with m_roomLevels[] (one RoomLevel per level) carrying m_storageModifier
//    (resource caps), m_storageWeaponModifier (item cap), m_maxDwellerCount. The
//    links are Unity fileIDs, resolved here against the prefab's documents.
//  - GameObject/VaultLogic.prefab → m_BaseMaxResources, m_baseMaxItems, m_maximumPetCount.
//  - GameParameters.prefab → m_maxStimpackPerDweller, m_maxRadawayPerDweller.
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PATHS, readJson, readSource, writeOutput } from './lib/io.mjs';
import { field, splitLines } from './lib/prefab.mjs';

// GameResources YAML field → save `vault.storage.resources` key. Power is "Energy"
// in the save; only these are real, editable resources (lunchbox/mrhandy/petcarrier
// are consumables handled separately).
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

/** Split a Unity prefab into a Map of fileID → document text (`--- !u!T &<id>` blocks). */
function parseDocuments(text) {
  const docs = new Map();
  let id = null;
  let buf = [];
  const flush = () => {
    if (id !== null) docs.set(id, buf.join('\n'));
    buf = [];
  };
  for (const line of splitLines(text)) {
    const m = line.match(/^--- !u!\d+ &(\d+)/);
    if (m) {
      flush();
      id = m[1];
      continue;
    }
    if (id !== null) buf.push(line);
  }
  flush();
  return docs;
}

/** Ordered fileID list from a `field:` whose value is a YAML list of `- {fileID: N}`. */
function refList(docText, fieldName) {
  const lines = splitLines(docText);
  const out = [];
  let inList = false;
  for (const line of lines) {
    if (new RegExp(`^\\s*${fieldName}:\\s*$`).test(line)) {
      inList = true;
      continue;
    }
    if (inList) {
      const m = line.match(/^\s*-\s*\{fileID:\s*(\d+)\}/);
      if (m) {
        out.push(m[1]);
        continue;
      }
      if (/^\s*\S/.test(line)) break; // next field at this indent ends the list
    }
  }
  return out;
}

/** Read the GameResources sub-block that begins at `fieldName:` → { saveKey: number }. */
function resourceBlock(docText, fieldName) {
  const lines = splitLines(docText);
  const out = {};
  let started = false;
  let indent = -1;
  for (const line of lines) {
    if (!started) {
      if (new RegExp(`^(\\s*)${fieldName}:\\s*$`).test(line)) {
        started = true;
        indent = line.match(/^(\s*)/)[1].length;
      }
      continue;
    }
    const lineIndent = line.match(/^(\s*)/)[1].length;
    if (line.trim() && lineIndent <= indent) break; // dedented → block done
    const m = line.match(/^\s*(m_[A-Za-z]+):\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m && RESOURCE_FIELDS[m[1]]) out[RESOURCE_FIELDS[m[1]]] = Number(m[2]);
  }
  return out;
}

/** Numeric field anywhere in a document (first match). */
function numField(docText, fieldName) {
  for (const line of splitLines(docText)) {
    const v = field(line, fieldName);
    if (v !== null) return Number(v);
  }
  return null;
}

/** Parse one room prefab → { type, levels: { [mergeLevel]: { [level]: {...} } } } or null. */
function parseRoomPrefab(text, roomTypeName) {
  const docs = parseDocuments(text);
  // RoomInfo = the document declaring m_LevelControllers.
  let roomInfo = null;
  for (const doc of docs.values()) {
    if (/^\s*m_LevelControllers:\s*$/m.test(doc)) {
      roomInfo = doc;
      break;
    }
  }
  if (!roomInfo) return null;

  const levels = {};
  const controllerIds = refList(roomInfo, 'm_LevelControllers');
  controllerIds.forEach((cId, ci) => {
    const controller = docs.get(cId);
    if (!controller) return;
    const mergeLevel = ci + 1; // m_LevelControllers[i] ↔ merge level i+1 (RoomInfo.GetLevelController)
    const perLevel = {};
    refList(controller, 'm_roomLevels').forEach((rId, ri) => {
      const roomLevel = docs.get(rId);
      if (!roomLevel) return;
      perLevel[ri + 1] = {
        maxDwellers: numField(roomLevel, 'm_maxDwellerCount') ?? 0,
        storage: resourceBlock(roomLevel, 'm_storageModifier'),
        storageItems: numField(roomLevel, 'm_storageWeaponModifier') ?? 0,
      };
    });
    if (Object.keys(perLevel).length) levels[mergeLevel] = perLevel;
  });
  return Object.keys(levels).length ? { type: roomTypeName, levels } : null;
}

export function buildRoomCapacity() {
  const enums = readJson(PATHS.enums);
  const roomTypeName = invert(enums.ERoomType); // int → name (== save room.type)

  const rooms = {};
  for (const file of readdirSync(PATHS.gameObjectDir)) {
    if (!file.endsWith('.prefab')) continue;
    const text = readSource(`${PATHS.gameObjectDir}/${file}`);
    const typeInt = numField(text, 'm_eRoomType');
    if (typeInt === null) continue;
    const name = roomTypeName[typeInt];
    if (!name || name === 'None') continue;
    if (rooms[name]) continue; // first prefab per type wins (dupes like MedBay/Medbay are identical)
    const parsed = parseRoomPrefab(text, name);
    if (parsed) rooms[name] = parsed.levels;
  }

  // Base maxima + per-dweller consumable caps.
  const vaultLogic = readSource(PATHS.vaultLogic);
  const gameParams = readSource(PATHS.gameParams);
  const baseResources = resourceBlock(vaultLogic, 'm_BaseMaxResources');

  return {
    base: {
      resources: baseResources,
      items: numField(vaultLogic, 'm_baseMaxItems') ?? 0,
      maxPetCount: numField(vaultLogic, 'm_maximumPetCount') ?? 0,
      // Mr. Handy full health (GameParameters m_mrHandyHealth) - the "Max Everything"
      // target for repairing Mr. Handies (stored as actors with characterType 2).
      mrHandyHealth: numField(gameParams, 'm_mrHandyHealth') ?? 0,
    },
    perDweller: {
      StimPack: numField(gameParams, 'm_maxStimpackPerDweller') ?? 0,
      RadAway: numField(gameParams, 'm_maxRadawayPerDweller') ?? 0,
    },
    rooms,
  };
}

/** enums value-map { name: n } → { n: name }. */
function invert(map) {
  const out = {};
  for (const [name, n] of Object.entries(map)) out[n] = name;
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('room-capacity.json', buildRoomCapacity());
}
