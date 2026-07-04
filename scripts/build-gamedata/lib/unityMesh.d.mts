// Typed contract for the JS mesh-decode build lib (unityMesh.mjs), so the strict
// TS test project can import it with real types.
export type Vec2 = [number, number];

export interface VertexChannel {
  stream: number;
  offset: number;
  format: number;
  dimension: number;
}

export interface DecodedVertices {
  positions: Vec2[];
  uvs: Vec2[];
  uvs1: Vec2[];
  boneIndices: number[];
}

export interface DecodedMesh extends DecodedVertices {
  indices: number[];
  bindPose: Float64Array[];
  indexCounts?: number[];
}

export function decodeIndexBuffer(hex: string, count: number): number[];
export function parseVertexChannels(text: string): VertexChannel[];
export function decodeVertexBuffer(
  hex: string,
  vertexCount: number,
  channels: VertexChannel[],
): DecodedVertices;
export function parseBindPose(text: string): Float64Array[];
export function decodeMeshAsset(text: string): DecodedMesh;
