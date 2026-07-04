// Rigid skeletal skinning for Fallout Shelter dweller meshes - reimplemented for
// our v2.4.1 export (17-bone skeleton confirmed: 17 m_BindPose matrices in
// MSH_Dweller.asset). AssetRipper exports the dweller mesh in its authoring
// (T-pose) layout; the game poses it at runtime with the idle animation. We bake
// that idle pose offline so the renderer draws the familiar standing dweller.
//
// Each vertex is bound to exactly ONE bone (stream2 blendIndices, implicit weight
// 1). Posed position:  posedXY = (worldPosed[bone] × bindPose[bone] × [x,y,z,1]).xy
//   bindPose[b]   = world→bone (inverse bind) matrix from the mesh asset
//   worldPosed[b] = bone→world for the idle pose, composed down the hierarchy from
//                   local (idle rotation) × (bind-pose-derived local translation)

// ── 4×4 row-major matrix helpers (Unity stores eNN row-major) ──

function mat4mul(A, B) {
  const C = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[r * 4 + k] * B[k * 4 + c];
      C[r * 4 + c] = s;
    }
  }
  return C;
}

/** Transform point [x,y,z,1] by a row-major 4×4; return [x,y] (2D render). */
function mat4mulPointXY(M, x, y, z) {
  return [M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7]];
}

/** Row-major rotation matrix from a unit quaternion (x,y,z,w). */
function quatToMat4(x, y, z, w) {
  const M = new Float64Array(16);
  M[0] = 1 - 2 * (y * y + z * z);
  M[1] = 2 * (x * y - z * w);
  M[2] = 2 * (x * z + y * w);
  M[3] = 0;
  M[4] = 2 * (x * y + z * w);
  M[5] = 1 - 2 * (x * x + z * z);
  M[6] = 2 * (y * z - x * w);
  M[7] = 0;
  M[8] = 2 * (x * z - y * w);
  M[9] = 2 * (y * z + x * w);
  M[10] = 1 - 2 * (x * x + y * y);
  M[11] = 0;
  M[12] = 0;
  M[13] = 0;
  M[14] = 0;
  M[15] = 1;
  return M;
}

function translateMat4(tx, ty, tz) {
  return new Float64Array([1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, tz, 0, 0, 0, 1]);
}

/**
 * Parse time=0 rotation quaternions per bone path from a Unity .anim clip.
 * @returns {Map<string,{x:number,y:number,z:number,w:number}>}
 */
export function parseIdleRotations(animText) {
  const result = new Map();
  for (const block of animText.split(/(?=  - curve:)/)) {
    const pathM = block.match(/\s+path:\s*(\S+)/);
    if (!pathM) continue;
    const kf = block.match(
      /time:\s*0[\s\S]*?value:\s*\{x:\s*([\d.eE+-]+),\s*y:\s*([\d.eE+-]+),\s*z:\s*([\d.eE+-]+),\s*w:\s*([\d.eE+-]+)\}/,
    );
    if (!kf) continue;
    result.set(pathM[1], { x: +kf[1], y: +kf[2], z: +kf[3], w: +kf[4] });
  }
  return result;
}

// Dweller skeleton bone paths, in m_BindPose array order. Confirmed: 17 bones,
// matching the 17 bind-pose matrices in the dweller mesh assets.
export const BONE_PATHS = [
  'Root',
  'Root/Chest',
  'Root/Chest/Head',
  'Root/Chest/L_Arm',
  'Root/Chest/L_Arm/L_Elbow',
  'Root/Chest/L_Arm/L_Elbow/L_Hand',
  'Root/Chest/R_Arm',
  'Root/Chest/R_Arm/R_Elbow',
  'Root/Chest/R_Arm/R_Elbow/R_Hand',
  'Root/R_Leg',
  'Root/R_Leg/R_Knee',
  'Root/R_Leg/R_Knee/R_Ankle',
  'Root/L_Leg',
  'Root/L_Leg/L_Knee',
  'Root/L_Leg/L_Knee/L_Ankle',
  'Root/L_Skirt',
  'Root/R_Skirt',
];

/** Parent bone index for each bone (-1 = root), derived from the path hierarchy. */
function buildParentIndices() {
  return BONE_PATHS.map((path, i) => {
    if (i === 0) return -1;
    return BONE_PATHS.indexOf(path.slice(0, path.lastIndexOf('/')));
  });
}

/**
 * Bake idle-pose vertex positions (rigid skinning).
 *
 * @param {[number,number][]} positions  bind-pose XY per vertex
 * @param {number[]} boneIndices         per-vertex bone index
 * @param {Float64Array[]} bindPose      17 inverse-bind 4×4 matrices
 * @param {Map<string,{x,y,z,w}>} rotations  time=0 rotation per bone path
 * @returns {[number,number][]} posed XY positions
 */
export function applySkinning(positions, boneIndices, bindPose, rotations) {
  const parent = buildParentIndices();
  const n = BONE_PATHS.length;
  if (bindPose.length < n) {
    throw new Error(`applySkinning: expected ${n} bind-pose matrices, got ${bindPose.length}`);
  }

  // Bone origin in world space = inv(bindPose) × [0,0,0,1]. For a rigid matrix
  // M = [R|t; 0|1], inv(M) translation = -Rᵀt; the rows of R are bindPose[0..2,4..6,8..10].
  const worldPos = bindPose.map((bp) => {
    const t0 = bp[3],
      t1 = bp[7],
      t2 = bp[11];
    return [
      -(bp[0] * t0 + bp[4] * t1 + bp[8] * t2),
      -(bp[1] * t0 + bp[5] * t1 + bp[9] * t2),
      -(bp[2] * t0 + bp[6] * t1 + bp[10] * t2),
    ];
  });

  // Compose posed bone→world matrices top-down: local = T(localTranslation) × R(idle).
  const worldPosed = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const rot = rotations.get(BONE_PATHS[i]);
    if (!rot) throw new Error(`applySkinning: missing idle rotation for bone ${BONE_PATHS[i]}`);
    const R = quatToMat4(rot.x, rot.y, rot.z, rot.w);

    const wp = worldPos[i];
    const p = parent[i];
    let tx, ty, tz;
    if (p === -1) {
      [tx, ty, tz] = wp;
    } else {
      // Express (wp - parentWp) in the parent's bind-pose local frame.
      const pp = worldPos[p];
      const pbp = bindPose[p];
      const dx = wp[0] - pp[0],
        dy = wp[1] - pp[1],
        dz = wp[2] - pp[2];
      tx = pbp[0] * dx + pbp[1] * dy + pbp[2] * dz;
      ty = pbp[4] * dx + pbp[5] * dy + pbp[6] * dz;
      tz = pbp[8] * dx + pbp[9] * dy + pbp[10] * dz;
    }
    const local = mat4mul(translateMat4(tx, ty, tz), R);
    worldPosed[i] = p === -1 ? local : mat4mul(worldPosed[p], local);
  }

  return positions.map(([x, y], vi) => {
    const b = boneIndices[vi];
    return mat4mulPointXY(mat4mul(worldPosed[b], bindPose[b]), x, y, 0);
  });
}
