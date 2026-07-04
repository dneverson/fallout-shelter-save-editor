// Decode Unity Mesh assets exported by AssetRipper (YAML + hex-encoded binary
// buffers) into plain geometry. Reimplemented for our v2.4.1 / Unity 6000.0.58f2
// export - NOT copied; field layout re-confirmed against MSH_Dweller.asset:
//   m_VertexCount 68 · m_DataSize 2176 = 68 × 32B per vertex, split across 3 streams
//   stream0: position float3      (12B)  m_Channels[0] stream0 offset0 fmt0 dim3
//   stream1: uv0 float2 @0 + uv1 float2 @8 (16B)  m_Channels[4],[5] stream1
//   stream2: blendIndices uint32  (4B)   m_Channels[13] stream2 offset0 fmt10 dim1
//   m_IndexFormat 0 → uint16 indices · 17 m_BindPose matrices (17-bone skeleton)
//
// We scan the YAML pragmatically (line/regex), matching the approach already used
// by the other generators (lib/prefab.mjs) rather than pulling in a YAML parser.

/** Bytes per Unity VertexAttributeFormat code (the subset dweller meshes use). */
const FORMAT_BYTES = { 0: 4, 1: 2, 2: 1, 3: 1, 4: 2, 5: 2, 6: 1, 7: 1, 8: 2, 9: 2, 10: 4, 11: 4 };

// Unity VertexAttribute channel indices (ordering of the m_Channels array).
const CH_POSITION = 0;
const CH_UV0 = 4;
const CH_UV1 = 5;
const CH_BLEND_INDICES = 13;

/** Decode a uint16 little-endian index buffer (hex string) into a number[]. */
export function decodeIndexBuffer(hex, count) {
  const buf = Buffer.from(hex, 'hex');
  const capacity = buf.length >> 1;
  if (count > capacity) {
    throw new RangeError(`decodeIndexBuffer: count ${count} exceeds buffer capacity ${capacity}`);
  }
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = buf.readUInt16LE(i * 2);
  return out;
}

/**
 * Parse the ordered m_Channels descriptor (stream/offset/format/dimension) from a
 * mesh asset's YAML. Channels with dimension 0 are absent but keep their slot.
 */
export function parseVertexChannels(text) {
  const block = text.match(/m_Channels:([\s\S]*?)m_DataSize:/);
  if (!block) return [];
  const re =
    /-\s*stream:\s*(\d+)\s*\n\s*offset:\s*(\d+)\s*\n\s*format:\s*(\d+)\s*\n\s*dimension:\s*(\d+)/g;
  const channels = [];
  let m;
  while ((m = re.exec(block[1])) !== null) {
    channels.push({ stream: +m[1], offset: +m[2], format: +m[3], dimension: +m[4] });
  }
  return channels;
}

/**
 * Channel-aware decode of the interleaved-by-stream vertex blob (hex). Reads the
 * mesh's own m_Channels so it handles both the body layout (stream1 = uv0+uv1, 16B)
 * and the largeHeadgear layout (stream1 = uv0 only, 8B). Streams are concatenated
 * in ascending order: all of stream0, then all of stream1, etc.
 *
 * @returns {{positions:[number,number][], uvs:[number,number][], uvs1:[number,number][], boneIndices:number[]}}
 */
export function decodeVertexBuffer(hex, vertexCount, channels) {
  const buf = Buffer.from(hex, 'hex');

  // Per-stream stride = max(offset + dimension × formatBytes) over that stream's channels.
  const strides = {};
  for (const c of channels) {
    if (!c.dimension) continue;
    const end = c.offset + c.dimension * (FORMAT_BYTES[c.format] ?? 4);
    strides[c.stream] = Math.max(strides[c.stream] ?? 0, end);
  }
  const streamBase = {};
  let base = 0;
  for (const s of Object.keys(strides)
    .map(Number)
    .sort((a, b) => a - b)) {
    streamBase[s] = base;
    base += strides[s] * vertexCount;
  }

  const readFloats = (chIndex, dim) => {
    const c = channels[chIndex];
    if (!c || !c.dimension) return null;
    const stride = strides[c.stream];
    const sbase = streamBase[c.stream];
    const out = new Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      const p = sbase + i * stride + c.offset;
      const v = new Array(dim);
      for (let d = 0; d < dim; d++) v[d] = buf.readFloatLE(p + d * 4);
      out[i] = v;
    }
    return out;
  };

  const readUint = (chIndex) => {
    const c = channels[chIndex];
    if (!c || !c.dimension) return null;
    const stride = strides[c.stream];
    const sbase = streamBase[c.stream];
    const out = new Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) out[i] = buf.readUInt32LE(sbase + i * stride + c.offset);
    return out;
  };

  // Positions are float3 in the buffer; we keep XY only (dweller render is 2D).
  const pos3 = readFloats(CH_POSITION, 3) ?? [];
  const positions = pos3.map(([x, y]) => [x, y]);
  const uvs = readFloats(CH_UV0, 2) ?? positions.map(() => [0, 0]);
  const uvs1 = readFloats(CH_UV1, 2) ?? uvs;
  const boneIndices = readUint(CH_BLEND_INDICES) ?? [];
  return { positions, uvs, uvs1, boneIndices };
}

/**
 * Parse the m_BindPose YAML block into 4×4 row-major Float64Array matrices (Unity
 * stores each matrix as e00..e33, row-major). These are the world→bone (inverse
 * bind) matrices used by the skinning pass.
 */
export function parseBindPose(text) {
  const start = text.indexOf('m_BindPose:');
  if (start === -1) return [];
  const section = text.slice(start + 'm_BindPose:'.length);
  const blocks = section.split(/(?=\n\s*- e00:)/);
  const matrices = [];
  for (const block of blocks) {
    const nums = [];
    const re = /e\d{2}:\s*([-\d.eE+]+)/g;
    let v;
    while ((v = re.exec(block)) !== null) {
      nums.push(parseFloat(v[1]));
      if (nums.length === 16) break;
    }
    if (nums.length === 16) matrices.push(new Float64Array(nums));
  }
  return matrices;
}

/**
 * Decode a complete mesh asset (one or more submeshes). Sums every submesh
 * indexCount so the full index buffer is read; records per-submesh counts when
 * there is more than one (largeHeadgear bundles a blocker submesh + the hat quad).
 */
export function decodeMeshAsset(text) {
  const vertexCount = +text.match(/m_VertexCount:\s*(\d+)/)[1];
  const indexCounts = [...text.matchAll(/\bindexCount:\s*(\d+)/g)].map((m) => +m[1]);
  const totalIndices = indexCounts.reduce((a, b) => a + b, 0);
  const indexHex = text.match(/m_IndexBuffer:\s*([0-9a-f]+)/)[1];
  const vertHex = text.match(/_typelessdata:\s*([0-9a-f]+)/)[1];
  const channels = parseVertexChannels(text);
  const indices = decodeIndexBuffer(indexHex, totalIndices);
  const { positions, uvs, uvs1, boneIndices } = decodeVertexBuffer(vertHex, vertexCount, channels);
  const bindPose = parseBindPose(text);
  return {
    positions,
    uvs,
    uvs1,
    indices,
    boneIndices,
    bindPose,
    ...(indexCounts.length > 1 ? { indexCounts } : {}),
  };
}
