import {
  compileHighShaderGlProgram,
  compileHighShaderGpuProgram,
  localUniformBit,
  localUniformBitGl,
  roundPixelsBit,
  roundPixelsBitGl,
  Shader,
  Texture,
  UniformGroup,
} from 'pixi.js';

// pixi.js does not re-export HighShaderBit from its public entry, so we mirror the
// minimal structural shape we use (header/main snippets). compileHighShader*Program
// checks our literals structurally against its internal type.
interface ShaderBit {
  name?: string;
  vertex?: { header?: string; start?: string; main?: string; end?: string };
  fragment?: { header?: string; start?: string; main?: string; end?: string };
}

// Custom PixiJS v8 shader for the dweller composite. Built the engine-blessed way:
// composed from the official high-shader bits (local-uniform + round-pixels, with
// global uniforms auto-injected) plus one custom "dweller" bit for the recolor blend.
// This is the same construction Pixi's own TilingSpriteShader uses, so the standard
// mesh pipeline binds the global (projection) and local (transform) uniform groups
// for us - we own only group 2.
//
// The blend is a faithful rewrite (NOT a copy) of the game's Dressup material:
//   factor = mix(white, tint.rgb, mask.a)  when a coloring mask is bound (uUseMask=1)
//   factor = tint.rgb                       otherwise (skin/hair/face tints)
//   outRGB = baseTex.rgb * factor           - keeps the art's shading, never flat fill
//   outA   = baseTex.a   * tint.a
// Output is premultiplied (rgb also scaled by tint.a) to match Pixi's premultiplied
// texture + normal-blend pipeline. `uFlipV` replicates the original renderer's
// UNPACK_FLIP_Y_WEBGL upload flip without touching how Pixi uploads textures.
//
// The base UV is left untransformed in the vertex stage (vUV = raw mesh UV); both the
// base-atlas coordinate and the coloring-mask coordinate are derived in the fragment
// from their own scale/offset uniforms, so no custom varyings are needed.

const dwellerBitGl: ShaderBit = {
  name: 'dweller-bit',
  fragment: {
    header: /* glsl */ `
      uniform vec4 uUvXform;    // (scaleU, scaleV, offsetU, offsetV) base atlas transform
      uniform vec4 uMaskXform;  // coloring-mask atlas transform
      uniform vec4 uTint;       // rgba 0..1
      uniform float uUseMask;   // 1 = gate tint by mask.a, 0 = flat multiply by tint
      uniform float uFlipV;     // 1 = sample atlases with flipped V (legacy upload flip)
      uniform sampler2D uTexture;
      uniform sampler2D uMask;
    `,
    main: /* glsl */ `
      vec2 t = vUV * uUvXform.xy + uUvXform.zw;
      vec2 mt = vUV * uMaskXform.xy + uMaskXform.zw;
      if (uFlipV > 0.5) { t.y = 1.0 - t.y; mt.y = 1.0 - mt.y; }
      vec4 c = texture(uTexture, t);
      float maskA = texture(uMask, mt).a;
      vec3 factor = (uUseMask > 0.5) ? mix(vec3(1.0), uTint.rgb, maskA) : uTint.rgb;
      outColor = vec4(c.rgb * factor * uTint.a, c.a * uTint.a);
    `,
  },
};

const dwellerBitGpu: ShaderBit = {
  name: 'dweller-bit',
  fragment: {
    header: /* wgsl */ `
      struct DwellerUniforms {
        uUvXform: vec4<f32>,
        uMaskXform: vec4<f32>,
        uTint: vec4<f32>,
        uUseMask: f32,
        uFlipV: f32,
      };
      @group(2) @binding(0) var<uniform> dwellerUniforms: DwellerUniforms;
      @group(2) @binding(1) var uTexture: texture_2d<f32>;
      @group(2) @binding(2) var uSampler: sampler;
      @group(2) @binding(3) var uMask: texture_2d<f32>;
      @group(2) @binding(4) var uMaskSampler: sampler;
    `,
    main: /* wgsl */ `
      var t = vUV * dwellerUniforms.uUvXform.xy + dwellerUniforms.uUvXform.zw;
      var mt = vUV * dwellerUniforms.uMaskXform.xy + dwellerUniforms.uMaskXform.zw;
      if (dwellerUniforms.uFlipV > 0.5) { t.y = 1.0 - t.y; mt.y = 1.0 - mt.y; }
      var c = textureSample(uTexture, uSampler, t);
      let maskA = textureSample(uMask, uMaskSampler, mt).a;
      var factor = dwellerUniforms.uTint.rgb;
      if (dwellerUniforms.uUseMask > 0.5) {
        factor = mix(vec3<f32>(1.0), dwellerUniforms.uTint.rgb, maskA);
      }
      outColor = vec4<f32>(c.rgb * factor * dwellerUniforms.uTint.a, c.a * dwellerUniforms.uTint.a);
    `,
  },
};

let glProgram: ReturnType<typeof compileHighShaderGlProgram> | undefined;
let gpuProgram: ReturnType<typeof compileHighShaderGpuProgram> | undefined;

export interface DwellerShaderUniforms {
  /** (scaleU, scaleV, offsetU, offsetV) for the base atlas. */
  uvXform: [number, number, number, number];
  /** (scaleU, scaleV, offsetU, offsetV) for the coloring mask atlas. */
  maskXform: [number, number, number, number];
  /** rgba 0..1. */
  tint: [number, number, number, number];
  /** 1 = gate the tint by mask alpha; 0 = flat multiply. */
  useMask: boolean;
  /** 1 = flip V when sampling (legacy UNPACK_FLIP_Y behavior). */
  flipV: boolean;
}

/**
 * A recolorable dweller-layer shader. One instance per layer (its uniforms/textures
 * are fixed for the draw); reuse it across that layer's painter passes.
 */
export class DwellerShader extends Shader {
  constructor() {
    glProgram ??= compileHighShaderGlProgram({
      name: 'fs-dweller',
      bits: [localUniformBitGl, dwellerBitGl, roundPixelsBitGl],
    });
    gpuProgram ??= compileHighShaderGpuProgram({
      name: 'fs-dweller',
      bits: [localUniformBit, dwellerBitGpu, roundPixelsBit],
    });

    super({
      glProgram,
      gpuProgram,
      resources: {
        dwellerUniforms: new UniformGroup({
          uUvXform: { value: new Float32Array([1, 1, 0, 0]), type: 'vec4<f32>' },
          uMaskXform: { value: new Float32Array([1, 1, 0, 0]), type: 'vec4<f32>' },
          uTint: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
          uUseMask: { value: 0, type: 'f32' },
          uFlipV: { value: 1, type: 'f32' },
        }),
        uTexture: Texture.EMPTY.source,
        uSampler: Texture.EMPTY.source.style,
        uMask: Texture.WHITE.source,
        uMaskSampler: Texture.WHITE.source.style,
      },
    });
  }

  /** Update the per-layer uniforms and bound atlas textures before drawing. */
  update(u: DwellerShaderUniforms, base: Texture, mask: Texture | null): void {
    const uniforms = this.resources.dwellerUniforms.uniforms as {
      uUvXform: Float32Array;
      uMaskXform: Float32Array;
      uTint: Float32Array;
      uUseMask: number;
      uFlipV: number;
    };
    uniforms.uUvXform.set(u.uvXform);
    uniforms.uMaskXform.set(u.maskXform);
    uniforms.uTint.set(u.tint);
    uniforms.uUseMask = u.useMask ? 1 : 0;
    uniforms.uFlipV = u.flipV ? 1 : 0;

    this.resources.uTexture = base.source;
    this.resources.uSampler = base.source.style;
    const m = mask ?? Texture.WHITE;
    this.resources.uMask = m.source;
    this.resources.uMaskSampler = m.source.style;
  }
}
