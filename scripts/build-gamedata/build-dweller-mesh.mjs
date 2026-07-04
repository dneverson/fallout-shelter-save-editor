// meshes.json - per-gender dweller body geometry (adult + child) with baked
// idle-pose positions and the gender hand/face UV offsets.
//
// Source of truth: GameObject/DwellerCatalog.prefab declares the mesh GUIDs and
// m_maleOffsets/m_femaleOffsets. We resolve those GUIDs to Mesh/*.asset files,
// decode the geometry, and bake the idle pose from ANI_Dweller_{Man,Woman}_Idle.
// (Mesh GUIDs are read dynamically - they differ between game versions, so we never
// hardcode them; only the offsets are version-stable and cross-checked.)
import { join } from 'node:path';
import { PATHS, readSource } from './lib/io.mjs';
import { buildGuidToPath, readVec2, refGuid } from './lib/unityYaml.mjs';
import { decodeMeshAsset } from './lib/unityMesh.mjs';
import { applySkinning, parseIdleRotations } from './lib/skinning.mjs';

const ATLAS_SIZE = 1024;

// Idle animation clips per gender (adult standing pose the game shows).
const IDLE_ANIM = { male: 'ANI_Dweller_Man_Idle.anim', female: 'ANI_Dweller_Woman_Idle.anim' };

/** Pull a gender mesh block { adultMesh, childMesh } GUIDs from the catalog YAML. */
function genderMeshGuids(catalog, genderField) {
  const block =
    catalog.match(new RegExp(`${genderField}:([\\s\\S]*?)(?=\\n  m_\\w+:|$)`))?.[1] ?? '';
  return {
    adult: refGuid(block, 'm_adultMesh'),
    child: refGuid(block, 'm_childMesh'),
  };
}

/** Read m_maleOffsets / m_femaleOffsets → { hand:[x,y], face:[x,y] }. */
function genderOffsets(catalog, genderField) {
  const block =
    catalog.match(new RegExp(`${genderField}:([\\s\\S]*?)(?=\\n  m_\\w+:|$)`))?.[1] ?? '';
  return { hand: readVec2(block, 'handOffset'), face: readVec2(block, 'faceOffset') };
}

export function buildDwellerMesh() {
  const catalog = readSource(PATHS.dwellerCatalog);
  const meshGuidToPath = buildGuidToPath(PATHS.meshDir, '.asset');

  const config = {
    male: {
      meshes: genderMeshGuids(catalog, 'm_maleMeshes'),
      offsets: genderOffsets(catalog, 'm_maleOffsets'),
    },
    female: {
      meshes: genderMeshGuids(catalog, 'm_femaleMeshes'),
      offsets: genderOffsets(catalog, 'm_femaleOffsets'),
    },
  };

  const out = { version: 1, atlasSize: ATLAS_SIZE };

  for (const gender of ['male', 'female']) {
    const { meshes, offsets } = config[gender];
    if (!offsets.hand || !offsets.face)
      throw new Error(`DwellerCatalog: missing ${gender} offsets`);

    const idleText = readSource(join(PATHS.animDir, IDLE_ANIM[gender]));
    const rotations = parseIdleRotations(idleText);

    out[gender] = { offsets };
    for (const age of ['adult', 'child']) {
      const guid = meshes[age];
      const path = guid ? meshGuidToPath.get(guid) : null;
      if (!path)
        throw new Error(`DwellerCatalog: ${gender}/${age} mesh GUID ${guid} not found in Mesh/`);
      const { positions, uvs, uvs1, indices, boneIndices, bindPose } = decodeMeshAsset(
        readSource(path),
      );

      let posedPositions;
      try {
        posedPositions = applySkinning(positions, boneIndices, bindPose, rotations);
      } catch (e) {
        // Children may not share the adult idle clip's bones; fall back to bind pose.
        console.warn(`  [mesh] ${gender}/${age}: idle skinning skipped (${e.message})`);
      }
      out[gender][age] = {
        positions,
        uvs,
        uvs1,
        indices,
        boneIndices,
        ...(posedPositions ? { posedPositions } : {}),
      };
    }
  }

  return out;
}
