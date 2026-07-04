// room-metadata.json - per-room-type metadata the Rooms Map needs: build cost,
// footprint width, merge/level maxima, primary
// SPECIAL stat (drives location loadouts), class, and a display name. This is the
// catalog the Build palette + the layout validator + the room edit ops read.
//
// Source (our own v2.4.1 export - version-correct, not hardcoded): one
// GameObject/<Room>.prefab per ERoomType carries a RoomInfo MonoBehaviour (the document
// declaring m_LevelControllers) with:
//   m_eRoomType (int → ERoomType name == save room.type)  m_roomClass (→ ERoomClass)
//   m_eSpecialStat (→ ESpecialStat)  m_maxMergeLevel  m_baseSize{m_row,m_col}
//   m_Price / m_InstantBuildPrice (GameResources price blocks)  m_additionalPriceFactor
//   m_LevelControllers[] (count of m_roomLevels in the first = the max level)
// Display name = localized `Room_<type>` term (I2Languages), falling back to prettify.
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PATHS, readJson, readSource, writeOutput } from './lib/io.mjs';
import {
  field,
  numField,
  parseDocuments,
  parseLocalization,
  prettify,
  refList,
  splitLines,
  subBlockNumbers,
} from './lib/prefab.mjs';

// GameResources price/storage YAML field → save resource key. Covers every key a room
// can cost (build prices are Nuka-only in v2.4.1, but the map keeps any others honest).
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
  m_lunchbox: 'Lunchbox',
  m_mrhandy: 'MrHandy',
  m_petcarrier: 'PetCarrier',
};

/** A GameResources price block → { saveKey: amount } keeping only nonzero entries. */
function priceBlock(docText, fieldName) {
  const raw = subBlockNumbers(docText, fieldName);
  const out = {};
  for (const [field_, value] of Object.entries(raw)) {
    const key = RESOURCE_FIELDS[field_];
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

/** A string field's value (e.g. m_buildLocId), trimmed, or '' if absent/empty. */
function strField(docText, fieldName) {
  for (const line of splitLines(docText)) {
    const v = field(line, fieldName);
    if (v !== null) return v;
  }
  return '';
}

export function buildRoomMetadata() {
  const enums = readJson(PATHS.enums);
  const roomTypeName = invert(enums.ERoomType); // int → name (== save room.type)
  const roomClassName = invert(enums.ERoomClass);
  const specialName = invert(enums.ESpecialStat);
  const loc = parseLocalization(readSource(PATHS.i2));

  const rooms = {};
  for (const file of readdirSync(PATHS.gameObjectDir)) {
    if (!file.endsWith('.prefab')) continue;
    const text = readSource(`${PATHS.gameObjectDir}/${file}`);
    const docs = parseDocuments(text);
    const roomInfo = findRoomInfo(docs);
    if (!roomInfo) continue;

    const typeInt = numField(roomInfo, 'm_eRoomType');
    if (typeInt === null) continue;
    const type = roomTypeName[typeInt];
    if (!type || type === 'None') continue;
    if (rooms[type]) continue; // first prefab per type wins (mirrors build-room-capacity)

    const controllers = refList(roomInfo, 'm_LevelControllers');
    const firstController = docs.get(controllers[0]);
    const maxLevel = firstController ? refList(firstController, 'm_roomLevels').length : 0;

    const size = subBlockNumbers(roomInfo, 'm_baseSize');
    const statInt = numField(roomInfo, 'm_eSpecialStat') ?? 0;

    rooms[type] = {
      name: loc.get(`Room_${type}`) ?? prettify(type),
      class: roomClassName[numField(roomInfo, 'm_roomClass') ?? 0] ?? 'None',
      primaryStat: specialName[statInt] ?? 'None',
      width: size.m_col ?? 0,
      height: size.m_row ?? 1,
      maxMergeLevel: numField(roomInfo, 'm_maxMergeLevel') ?? 1,
      maxLevel,
      buildCost: priceBlock(roomInfo, 'm_Price'),
      instantBuildCost: priceBlock(roomInfo, 'm_InstantBuildPrice'),
      priceFactor: numField(roomInfo, 'm_additionalPriceFactor') ?? 0,
      buildLocId: strField(roomInfo, 'm_buildLocId'),
    };
  }

  return { rooms };
}

/** enums value-map { name: n } → { n: name }. */
function invert(map) {
  const out = {};
  for (const [name, n] of Object.entries(map ?? {})) out[n] = name;
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('room-metadata.json', buildRoomMetadata());
}
