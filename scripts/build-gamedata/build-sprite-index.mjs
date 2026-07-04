// sprite-index.json - the runtime index of dweller customization pieces (body,
// outfit, face, hair, helmet, etc.) with their atlas + pixel rect, gender, flags,
// colors, and cross-references; plus the equippable DwellerOutfitItem list (the
// authoritative outfit ids stored in saves) and decoded largeHeadgear hat meshes.
// Also copies the referenced dweller atlas PNGs into public/gamedata/atlas/.
//
// Sources (our v2.4.1 export): MonoBehaviour/*.asset (DwellerOutfit/Body/Face/…),
// Resources/dwelleratlases/hd/*.png, GameParameters.prefab (DwellerOutfitItem),
// I2Languages.prefab (names), Mesh/*.asset (largeHeadgear). Reimplemented in our
// conventions - field names re-confirmed against AbrahamSpecial.asset et al.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, readSource, copyAtlasPng } from './lib/io.mjs';
import { parseLocalization } from './lib/prefab.mjs';
import { buildGuidToPath, readGuid, refGuid, walk } from './lib/unityYaml.mjs';
import { decodeMeshAsset } from './lib/unityMesh.mjs';

// DwellerPiece script class → our piece type. Resolved to script GUIDs dynamically
// from Scripts/Assembly-CSharp/<Class>.cs.meta (robust across game versions).
const SCRIPT_TO_TYPE = {
  DwellerBody: 'body',
  DwellerOutfit: 'outfit',
  DwellerOutfitColoringMask: 'outfitColoringMask',
  DwellerFace: 'face',
  DwellerFaceMask: 'faceMask',
  DwellerHair: 'hair',
  DwellerHelmet: 'helmet',
  DwellerHelmetMask: 'helmetMask',
  DwellerLargeHeadgear: 'largeHeadgear',
  DwellerHandPose: 'handPose',
  DwellerGlovePose: 'glovePose',
};

const PIECE_TYPES = [...new Set(Object.values(SCRIPT_TO_TYPE))];

function grab(text, re) {
  return text.match(re)?.[1] ?? null;
}

function buildScriptGuidToType() {
  const map = new Map();
  for (const [cls, type] of Object.entries(SCRIPT_TO_TYPE)) {
    try {
      const guid = readGuid(readFileSync(join(PATHS.scriptsDir, `${cls}.cs.meta`), 'utf8'));
      if (guid) map.set(guid, type);
    } catch {
      // A few script .meta files may be absent in the export; those types are skipped.
    }
  }
  return map;
}

/** Parse one MonoBehaviour piece asset into a ref, or null if it isn't a piece. */
function parsePiece(text, scriptGuidToType) {
  const scriptGuid = grab(text, /m_Script:\s*\{[^}]*guid:\s*([0-9a-f]+)/);
  const type = scriptGuid ? scriptGuidToType.get(scriptGuid) : null;
  if (!type) return null;

  const name = grab(text, /^\s*m_Name:\s*(.+?)\s*$/m);
  const mGuid = grab(text, /^\s*m_guid:\s*([0-9a-f]+)/m);
  const atlasGuid = refGuid(text, 'm_atlas');
  if (!mGuid || !atlasGuid) return null;

  const xy = text.match(/m_atlasBounds:[\s\S]*?x:\s*(-?\d+)\s*\n\s*y:\s*(-?\d+)/);
  const wh = text.match(/m_atlasBounds:[\s\S]*?width:\s*(-?\d+)\s*\n\s*height:\s*(-?\d+)/);
  if (!xy || !wh) return null;
  const bounds = { x: +xy[1], y: +xy[2], w: +wh[1], h: +wh[2] };

  // Gender from the source texture path (…/Male/… or …/Female/…).
  const origPath = grab(text, /^\s*m_originalFilePath:\s*(.+?)\s*$/m) ?? '';
  const gender = /\/Female\//i.test(origPath)
    ? 'female'
    : /\/Male\//i.test(origPath)
      ? 'male'
      : 'any';

  const boolFlag = (re) => {
    const m = grab(text, re);
    return m == null ? undefined : !!+m;
  };
  const intFlag = (re) => {
    const m = grab(text, re);
    return m == null ? undefined : +m;
  };
  const flags = {
    isBald: boolFlag(/^\s*m_isBald:\s*(\d)/m),
    type: intFlag(/^\s*m_type:\s*(\d)/m),
    hasSkirt: boolFlag(/^\s*m_hasSkirt:\s*(\d)/m),
  };

  // m_colors (rgba 0..1) - outfit allowed-color palette.
  const colorsBlock = text.match(/m_colors:\s*([\s\S]*?)(?=^\s*m_\w+:|\Z)/m)?.[1] ?? '';
  const colorMatches = [
    ...colorsBlock.matchAll(
      /-\s*\{r:\s*([0-9.eE+-]+),\s*g:\s*([0-9.eE+-]+),\s*b:\s*([0-9.eE+-]+),\s*a:\s*([0-9.eE+-]+)\}/g,
    ),
  ];
  const colors = colorMatches.length
    ? colorMatches.map((m) => [+m[1], +m[2], +m[3], +m[4]])
    : undefined;

  // Cross-reference .meta GUIDs (resolved to m_guids after the full parse pass).
  const refs = {};
  if (type === 'outfit') {
    refs.helmetMeta = refGuid(text, 'm_helmet');
    refs.largeHeadgearMeta = refGuid(text, 'm_largeHeadgear');
    refs.coloringMaskMeta = refGuid(text, 'm_coloringMask');
    const glovePoseBlock = text.match(/m_glovePoses:([\s\S]*?)(?=\n\s*m_[a-zA-Z])/m)?.[1] ?? '';
    refs.glovePoseMetas = [...glovePoseBlock.matchAll(/guid:\s*([0-9a-f]+)/g)].map((m) => m[1]);
  }
  if (type === 'helmet' || type === 'largeHeadgear') {
    refs.maskMeta = refGuid(text, 'm_mask');
    const excl = boolFlag(/^\s*m_isExclusive:\s*(\d)/m);
    if (excl !== undefined) flags.isExclusive = excl;
  }
  let maleMeshMeta, femaleMeshMeta;
  if (type === 'largeHeadgear') {
    maleMeshMeta = refGuid(text, 'm_maleMesh');
    femaleMeshMeta = refGuid(text, 'm_femaleMesh');
  }

  for (const k of Object.keys(flags)) if (flags[k] === undefined) delete flags[k];
  return {
    type,
    name,
    mGuid,
    atlasGuid,
    bounds,
    gender,
    flags,
    colors,
    refs,
    maleMeshMeta,
    femaleMeshMeta,
  };
}

/** Join DwellerOutfitItem entries (the equippable outfit ids) from GameParameters. */
function parseOutfitItems(outfitMetaToRef) {
  const items = [];
  let loc = new Map();
  try {
    loc = parseLocalization(readSource(PATHS.i2));
  } catch {
    // names optional
  }
  const gp = readSource(PATHS.gameParams);
  const STAT_LETTERS = [
    ['Strength', 'S'],
    ['Perception', 'P'],
    ['Endurance', 'E'],
    ['Charisma', 'C'],
    ['Intelligence', 'I'],
    ['Agility', 'A'],
    ['Luck', 'L'],
  ];
  const parseSpecial = (block) => {
    const out = {};
    for (const [field, letter] of STAT_LETTERS) {
      const v = block.match(new RegExp(`${field}:\\s*\\n\\s*Value:\\s*(-?\\d+)`))?.[1];
      if (v != null && +v > 0) out[letter] = +v;
    }
    return out;
  };
  const re =
    /m_maleOutfit:\s*\{([^}]*)\}\s*\n\s*m_femaleOutfit:\s*\{([^}]*)\}\s*\n\s*m_outfitId:\s*(\S+)\s*\n\s*m_category:\s*(-?\d+)\s*\n\s*m_specialStats:\s*([\s\S]*?)m_outfitNameLocalizationId:\s*(\S+)\s*\n\s*m_HasHelmet:\s*(\d+)/g;
  const guidOf = (brace) => brace.match(/guid:\s*([0-9a-f]+)/)?.[1];
  let m;
  while ((m = re.exec(gp)) !== null) {
    const maleRef = guidOf(m[1]) ? outfitMetaToRef.get(guidOf(m[1])) : null;
    const femaleRef = guidOf(m[2]) ? outfitMetaToRef.get(guidOf(m[2])) : null;
    const special = parseSpecial(m[5]);
    const category = +m[4];
    items.push({
      id: m[3],
      name: loc.get(m[6]) || m[3],
      category,
      ...(Object.keys(special).length ? { special } : {}),
      pieceMale: maleRef?.name ?? null,
      pieceFemale: femaleRef?.name ?? null,
      ...(+m[7] === 1 ? { hasHelmet: true } : {}),
    });
    // Tag the visual outfit pieces with their item category (Premium=2 are real
    // player items; the renderer can distinguish enemy/scripted outfits).
    for (const ref of [maleRef, femaleRef]) {
      if (!ref) continue;
      if (ref.flags.outfitCategory === 2) continue; // Premium already wins
      ref.flags.outfitCategory = category;
    }
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return items;
}

export function buildSpriteIndex() {
  const scriptGuidToType = buildScriptGuidToType();
  const atlasGuidToPng = buildGuidToPath(PATHS.dwellerAtlasDir, '.png');

  const byType = Object.fromEntries(PIECE_TYPES.map((t) => [t, []]));
  const assetMetaToMGuid = new Map(); // file .meta guid → m_guid
  const outfitMetaToRef = new Map(); // outfit file .meta guid → ref (unique per asset)
  const pending = []; // cross-references to resolve after the full pass
  const referencedAtlases = new Set();
  const largeHeadgearMeta = []; // { ref, maleMeshMeta, femaleMeshMeta }

  for (const file of walk(PATHS.monoBehaviourDir)) {
    if (!file.endsWith('.asset')) continue;
    const text = readFileSync(file, 'utf8');
    if (!/m_atlasBounds/.test(text)) continue;

    const fileMetaGuid = (() => {
      try {
        return readGuid(readFileSync(file + '.meta', 'utf8'));
      } catch {
        return null;
      }
    })();

    const piece = parsePiece(text, scriptGuidToType);
    if (!piece) continue;
    if (fileMetaGuid) assetMetaToMGuid.set(fileMetaGuid, piece.mGuid);

    const png = atlasGuidToPng.get(piece.atlasGuid);
    if (!png) continue; // piece references an atlas we don't have - skip
    const atlasFile = copyAtlasPng(png);
    referencedAtlases.add(atlasFile);

    const ref = {
      guid: piece.mGuid,
      name: piece.name,
      atlas: atlasFile,
      bounds: piece.bounds,
      gender: piece.gender,
      flags: piece.flags,
      ...(piece.colors ? { colors: piece.colors } : {}),
    };
    byType[piece.type].push(ref);
    if (piece.type === 'outfit' && fileMetaGuid) outfitMetaToRef.set(fileMetaGuid, ref);

    if (piece.type === 'outfit') {
      pending.push({
        ref,
        helmet: piece.refs.helmetMeta,
        largeHeadgear: piece.refs.largeHeadgearMeta,
        coloringMask: piece.refs.coloringMaskMeta,
        glovePoses: piece.refs.glovePoseMetas ?? [],
      });
    }
    if ((piece.type === 'helmet' || piece.type === 'largeHeadgear') && piece.refs.maskMeta) {
      pending.push({ ref, mask: piece.refs.maskMeta });
    }
    if (piece.type === 'largeHeadgear') {
      largeHeadgearMeta.push({
        ref,
        maleMeshMeta: piece.maleMeshMeta,
        femaleMeshMeta: piece.femaleMeshMeta,
      });
    }
  }

  // Resolve cross-reference .meta GUIDs → m_guids.
  for (const p of pending) {
    if (p.helmet) {
      const g = assetMetaToMGuid.get(p.helmet);
      if (g) p.ref.helmetGuid = g;
    }
    if (p.largeHeadgear) {
      const g = assetMetaToMGuid.get(p.largeHeadgear);
      if (g) p.ref.largeHeadgearGuid = g;
    }
    if (p.coloringMask) {
      const g = assetMetaToMGuid.get(p.coloringMask);
      if (g) p.ref.coloringMaskGuid = g;
    }
    if (p.glovePoses?.length) {
      const resolved = p.glovePoses.map((g) => assetMetaToMGuid.get(g)).filter(Boolean);
      if (resolved.length) p.ref.glovePoseGuids = resolved;
    }
    if (p.mask) {
      const g = assetMetaToMGuid.get(p.mask);
      if (g) p.ref.maskGuid = g;
    }
  }

  const outfitItems = parseOutfitItems(outfitMetaToRef);

  // Decode largeHeadgear hat meshes (their own per-gender mesh, drawn over the body).
  const meshMetaToPath = buildGuidToPath(PATHS.meshDir, '.asset');
  const largeHeadgearMeshes = {};
  for (const { ref, maleMeshMeta, femaleMeshMeta } of largeHeadgearMeta) {
    const decode = (meta) => {
      const path = meta ? meshMetaToPath.get(meta) : null;
      if (!path) return null;
      try {
        const m = decodeMeshAsset(readFileSync(path, 'utf8'));
        return {
          positions: m.positions,
          uvs: m.uvs,
          indices: m.indices,
          ...(m.indexCounts ? { indexCounts: m.indexCounts } : {}),
        };
      } catch {
        return null;
      }
    };
    const male = decode(maleMeshMeta);
    const female = decode(femaleMeshMeta);
    if (male || female) largeHeadgearMeshes[ref.guid] = { male, female };
  }

  // Deterministic ordering (dwellers reference pieces by NAME; same name may appear
  // once per gender - runtime disambiguates by gender).
  for (const t of PIECE_TYPES) {
    byType[t].sort((a, b) => a.name.localeCompare(b.name) || a.guid.localeCompare(b.guid));
  }

  return {
    index: { version: 1, byType, outfitItems, largeHeadgearMeshes },
    stats: {
      atlases: referencedAtlases.size,
      counts: Object.fromEntries(PIECE_TYPES.map((t) => [t, byType[t].length])),
      outfitItems: outfitItems.length,
      largeHeadgearMeshes: Object.keys(largeHeadgearMeshes).length,
    },
  };
}
