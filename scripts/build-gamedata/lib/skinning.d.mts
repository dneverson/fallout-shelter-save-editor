// Typed contract for the JS skinning build lib (skinning.mjs).
export type Vec2 = [number, number];
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const BONE_PATHS: string[];
export function parseIdleRotations(animText: string): Map<string, Quat>;
export function applySkinning(
  positions: Vec2[],
  boneIndices: number[],
  bindPose: Float64Array[],
  rotations: Map<string, Quat>,
): Vec2[];
