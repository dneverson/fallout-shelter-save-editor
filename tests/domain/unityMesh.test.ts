// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  decodeIndexBuffer,
  decodeVertexBuffer,
  parseVertexChannels,
  parseBindPose,
} from '../../scripts/build-gamedata/lib/unityMesh.mjs';
import {
  applySkinning,
  BONE_PATHS,
  parseIdleRotations,
} from '../../scripts/build-gamedata/lib/skinning.mjs';
import { parseNguiAtlas, pngSize } from '../../scripts/build-gamedata/lib/unityYaml.mjs';

describe('unityMesh - index buffer', () => {
  it('decodes little-endian uint16 indices', () => {
    // 0x0001, 0x0002, 0x0003
    expect(decodeIndexBuffer('010002000300', 3)).toEqual([1, 2, 3]);
  });
  it('throws when count exceeds the buffer', () => {
    expect(() => decodeIndexBuffer('0100', 5)).toThrow(RangeError);
  });
});

describe('unityMesh - vertex buffer (channel-aware, stream-concatenated)', () => {
  it('decodes the dweller body layout (pos f3 / uv0+uv1 / boneIndex u32)', () => {
    // Channels indexed by Unity VertexAttribute slot: 0=pos, 4=uv0, 5=uv1, 13=blendIndices.
    const channels = Array.from({ length: 14 }, () => ({
      stream: 0,
      offset: 0,
      format: 0,
      dimension: 0,
    }));
    channels[0] = { stream: 0, offset: 0, format: 0, dimension: 3 }; // position float3
    channels[4] = { stream: 1, offset: 0, format: 0, dimension: 2 }; // uv0 float2
    channels[5] = { stream: 1, offset: 8, format: 0, dimension: 2 }; // uv1 float2
    channels[13] = { stream: 2, offset: 0, format: 10, dimension: 1 }; // blendIndices uint32

    // One vertex: streams concatenated → stream0 (12B) + stream1 (16B) + stream2 (4B).
    const buf = Buffer.alloc(32);
    buf.writeFloatLE(1.5, 0);
    buf.writeFloatLE(2.5, 4);
    buf.writeFloatLE(9, 8); // pos (z dropped)
    buf.writeFloatLE(0.25, 12);
    buf.writeFloatLE(0.75, 16); // uv0
    buf.writeFloatLE(0.1, 20);
    buf.writeFloatLE(0.2, 24); // uv1
    buf.writeUInt32LE(3, 28); // boneIndex

    const { positions, uvs, uvs1, boneIndices } = decodeVertexBuffer(
      buf.toString('hex'),
      1,
      channels,
    );
    expect(positions[0][0]).toBeCloseTo(1.5);
    expect(positions[0][1]).toBeCloseTo(2.5);
    expect(uvs[0]).toEqual([expect.closeTo(0.25), expect.closeTo(0.75)]);
    expect(uvs1[0]).toEqual([expect.closeTo(0.1), expect.closeTo(0.2)]);
    expect(boneIndices[0]).toBe(3);
  });

  it('parses the m_Channels descriptor in order', () => {
    const text = `
    m_Channels:
    - stream: 0
      offset: 0
      format: 0
      dimension: 3
    - stream: 1
      offset: 8
      format: 0
      dimension: 2
    m_DataSize: 100`;
    const channels = parseVertexChannels(text);
    expect(channels[0]).toEqual({ stream: 0, offset: 0, format: 0, dimension: 3 });
    expect(channels[1]).toEqual({ stream: 1, offset: 8, format: 0, dimension: 2 });
  });
});

describe('unityMesh - bind pose', () => {
  it('parses 4×4 row-major matrices', () => {
    const text = `
  m_BindPose:
  - e00: 1
    e01: 0
    e02: 0
    e03: 0
    e10: 0
    e11: 1
    e12: 0
    e13: 0
    e20: 0
    e21: 0
    e22: 1
    e23: 0
    e30: 0
    e31: 0
    e32: 0
    e33: 1
  m_BoneNameHashes:`;
    const m = parseBindPose(text);
    expect(m.length).toBe(1);
    expect([...m[0]]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });
});

describe('skinning - identity pose is a no-op', () => {
  it('returns input positions for identity bind pose + identity rotations', () => {
    const identity = () => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const bindPose = BONE_PATHS.map(identity);
    const rotations = new Map(BONE_PATHS.map((p) => [p, { x: 0, y: 0, z: 0, w: 1 }]));
    const positions: [number, number][] = [
      [0.3, 1.2],
      [-0.5, 0.8],
    ];
    const boneIndices = [0, 2];
    const posed = applySkinning(positions, boneIndices, bindPose, rotations);
    expect(posed[0][0]).toBeCloseTo(0.3);
    expect(posed[0][1]).toBeCloseTo(1.2);
    expect(posed[1][0]).toBeCloseTo(-0.5);
    expect(posed[1][1]).toBeCloseTo(0.8);
  });

  it('throws when a bone has no idle rotation', () => {
    const bindPose = BONE_PATHS.map(() => new Float64Array(16).fill(0));
    expect(() => applySkinning([[0, 0]], [0], bindPose, new Map())).toThrow(/idle rotation/);
  });
});

describe('skinning - idle clip parsing', () => {
  it('reads the time=0 quaternion per bone path', () => {
    const anim = `
  m_RotationCurves:
  - curve:
      m_Curve:
      - time: 0
        value: {x: 0.1, y: 0.2, z: 0.3, w: 0.9}
    path: Root/Chest
  - curve:
      m_Curve:
      - time: 0
        value: {x: 0, y: 0, z: 0, w: 1}
    path: Root`;
    const rot = parseIdleRotations(anim);
    expect(rot.get('Root/Chest')).toEqual({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
    expect(rot.get('Root')).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});

describe('unityYaml - NGUI atlas + PNG size', () => {
  it('parses NGUI mSprites rects', () => {
    const prefab = `
  mSprites:
  - name: 0.32Pistol
    x: 1948
    y: 1491
    width: 90
    height: 167`;
    const rects = parseNguiAtlas(prefab);
    expect(rects.get('0.32Pistol')).toEqual({ x: 1948, y: 1491, w: 90, h: 167 });
  });

  it('reads PNG width/height from the IHDR', () => {
    const buf = Buffer.alloc(24);
    buf.writeUInt32BE(2048, 16);
    buf.writeUInt32BE(1024, 20);
    expect(pngSize(buf)).toEqual({ w: 2048, h: 1024 });
  });
});
