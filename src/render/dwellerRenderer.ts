import {
  autoDetectRenderer,
  Container,
  Geometry,
  Mesh,
  Rectangle,
  Sprite,
  Texture,
  type Renderer,
} from 'pixi.js';
import type { MeshGeometry, OverrideMesh } from '../domain/gamedata/visualSchemas.ts';
import type { RenderLayer } from './dwellerLayers.ts';
import { DwellerShader, type DwellerShaderUniforms } from './dwellerShader.ts';

// PixiJS v8 dweller renderer - the composited, recolorable figure. Rewrite (not a copy)
// of the proven fs-save-editor WebGL approach, expressed through Pixi's mesh pipeline so
// the engine owns context creation, loss/restore, batching and render-to-texture.
//
// Pipeline per render:
//  1. CPU triangle filter - keep a layer's triangles whose sampled-UV centroid lands in
//     its atlas rect, so head overlays (face/hair/beard) stay confined to the head.
//  2. Bone-group z-order - split each layer's triangles into back / body / front groups
//     by arm bone, then draw all layers front→body→back (a 3-pass painter's algorithm)
//     so the near arm composites over the torso and the far arm behind it.
//  3. largeHeadgear (hat) override meshes draw last with their own geometry.
// Each (layer, group) is one Pixi Mesh sharing a DwellerShader per layer; the model→screen
// fit (flip-Y, margin, zoom) lives on a parent container so Pixi's projection handles both
// on-screen and render-texture targets correctly.

export interface ModelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Calibrated standing-figure bounds (ported from the reference renderer). */
const DEFAULT_MODEL_BOUNDS: ModelBounds = { minX: -1, maxX: 1, minY: -0.1, maxY: 2 };

const DEFAULT_ATLAS_SIZE = 1024;
const FIT_MARGIN = 0.9;

export interface RendererLayerInput extends RenderLayer {
  /** Loaded atlas texture for `atlas`. */
  texture: Texture;
  /** Loaded texture for `coloringMask.atlas`, when present. */
  maskTexture?: Texture;
}

/** A flat 2D overlay (weapon / pet portrait sprite) composited over the figure. */
export interface OverlaySprite {
  texture: Texture;
  /** Atlas sub-rect to show, in atlas pixels. Omit to use the whole texture. */
  frame?: { x: number; y: number; w: number; h: number };
  /** Screen placement; sized relative to the canvas. */
  placement: 'weapon' | 'pet';
}

export interface RenderOptions {
  bounds?: ModelBounds;
  zoom?: number;
  atlasSize?: number;
  overlays?: OverlaySprite[];
}

export interface CreateRendererOptions {
  width?: number;
  height?: number;
  /** Flip V when sampling atlases (legacy UNPACK_FLIP_Y behavior). Default true. */
  flipV?: boolean;
  /** Keep the drawing buffer so the canvas can be captured via toDataURL. Default true. */
  preserveDrawingBuffer?: boolean;
}

type Rect = { u0: number; u1: number; v0: number; v1: number };

const L_ARM_BONES = new Set([3, 4, 5]); // screen-right → front (near arm)
const R_ARM_BONES = new Set([6, 7, 8]); // screen-left → back (far arm)

function spriteRect(b: { x: number; y: number; w: number; h: number }, atlas: number): Rect {
  return {
    u0: b.x / atlas,
    u1: (b.x + b.w) / atlas,
    v0: b.y / atlas,
    v1: (b.y + b.h) / atlas,
  };
}

// Indices of triangles whose sampled-UV centroid lies inside `rect`. Body/outfit layers
// pass entirely (their rect spans their whole sprite); head overlays are confined.
function filterTriangles(
  mesh: MeshGeometry,
  sx: number,
  sy: number,
  ox: number,
  oy: number,
  rect: Rect,
): number[] {
  const eps = 1e-3;
  const out: number[] = [];
  const { indices, uvs } = mesh;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]!;
    const b = indices[i + 1]!;
    const c = indices[i + 2]!;
    const cu = ((uvs[a]![0] + uvs[b]![0] + uvs[c]![0]) / 3) * sx + ox;
    const cv = ((uvs[a]![1] + uvs[b]![1] + uvs[c]![1]) / 3) * sy + oy;
    if (cu >= rect.u0 - eps && cu <= rect.u1 + eps && cv >= rect.v0 - eps && cv <= rect.v1 + eps) {
      out.push(a, b, c);
    }
  }
  return out;
}

// Split a filtered index list into back (R_Arm) / body / front (L_Arm). A triangle joins
// an arm group only when all three vertices share it.
function splitByBoneGroup(
  idx: number[],
  boneIndices: number[] | undefined,
): { back: number[]; body: number[]; front: number[] } {
  if (!boneIndices || boneIndices.length === 0) return { back: [], body: idx, front: [] };
  const back: number[] = [];
  const body: number[] = [];
  const front: number[] = [];
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = idx[i]!;
    const b = idx[i + 1]!;
    const c = idx[i + 2]!;
    const ba = boneIndices[a]!;
    const bb = boneIndices[b]!;
    const bc = boneIndices[c]!;
    if (L_ARM_BONES.has(ba) && L_ARM_BONES.has(bb) && L_ARM_BONES.has(bc)) front.push(a, b, c);
    else if (R_ARM_BONES.has(ba) && R_ARM_BONES.has(bb) && R_ARM_BONES.has(bc)) back.push(a, b, c);
    else body.push(a, b, c);
  }
  return { back, body, front };
}

function flatten(pairs: ReadonlyArray<readonly [number, number]>): Float32Array {
  const out = new Float32Array(pairs.length * 2);
  for (let i = 0; i < pairs.length; i++) {
    out[i * 2] = pairs[i]![0];
    out[i * 2 + 1] = pairs[i]![1];
  }
  return out;
}

function tintTuple(layer: RenderLayer): [number, number, number, number] {
  const t = layer.tint;
  if (!t) return [1, 1, 1, 1];
  return [t.r / 255, t.g / 255, t.b / 255, t.a];
}

export interface DwellerRenderer {
  readonly canvas: HTMLCanvasElement;
  resize(width: number, height: number): void;
  /** Draw a dweller. `mesh` is the gender body (or child) geometry. */
  render(mesh: MeshGeometry, layers: RendererLayerInput[], opts?: RenderOptions): void;
  /** Capture the current frame as a PNG data URL (thumbnails / verification). */
  toDataURL(): Promise<string>;
  destroy(): void;
}

class PixiDwellerRenderer implements DwellerRenderer {
  private readonly renderer: Renderer;
  private readonly stage = new Container();
  private readonly modelRoot = new Container();
  private readonly overlayRoot = new Container();
  private readonly flipV: boolean;
  /** Per-render disposables, torn down before the next build to avoid GPU leaks. */
  private disposables: Array<{ destroy(): void }> = [];

  constructor(renderer: Renderer, flipV: boolean) {
    this.renderer = renderer;
    this.flipV = flipV;
    this.stage.addChild(this.modelRoot);
    this.stage.addChild(this.overlayRoot);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.canvas as HTMLCanvasElement;
  }

  resize(width: number, height: number): void {
    this.renderer.resize(width, height);
  }

  render(mesh: MeshGeometry, layers: RendererLayerInput[], opts: RenderOptions = {}): void {
    this.clearScene();

    const bounds = opts.bounds ?? DEFAULT_MODEL_BOUNDS;
    const zoom = opts.zoom ?? 1;
    const atlas = opts.atlasSize ?? DEFAULT_ATLAS_SIZE;
    this.applyFit(bounds, zoom);

    const positions = flatten(mesh.posedPositions ?? mesh.positions);
    const uvs = flatten(mesh.uvs);

    const regular = layers.filter((l) => !l.meshOverride);
    const overrides = layers.filter((l) => l.meshOverride);

    // Per layer: filter + bone-split once, build a shared shader, then emit group meshes
    // in the 3-pass painter order (front for all layers, then body, then back).
    type Built = {
      groups: { back: number[]; body: number[]; front: number[] };
      shader: DwellerShader;
    };
    const built: Built[] = [];
    for (const layer of regular) {
      const [sx, sy] = layer.uvScale;
      const [ox, oy] = layer.uvOffset;
      const tm = layer.triMask;
      const rect = spriteRect(tm ? tm.bounds : layer.bounds, atlas);
      const [fsx, fsy] = tm ? tm.uvScale : [sx, sy];
      const [fox, foy] = tm ? tm.uvOffset : [ox, oy];
      const idx = filterTriangles(mesh, fsx, fsy, fox, foy, rect);
      if (idx.length === 0) continue;
      const groups = splitByBoneGroup(idx, mesh.boneIndices);

      const shader = new DwellerShader();
      const cm = layer.coloringMask;
      const uniforms: DwellerShaderUniforms = {
        uvXform: [sx, sy, ox, oy],
        maskXform: cm
          ? [cm.uvScale[0], cm.uvScale[1], cm.uvOffset[0], cm.uvOffset[1]]
          : [1, 1, 0, 0],
        tint: tintTuple(layer),
        useMask: !!layer.maskTexture,
        flipV: this.flipV,
      };
      shader.update(uniforms, layer.texture, layer.maskTexture ?? null);
      this.disposables.push(shader);
      built.push({ groups, shader });
    }

    // Painter order: far arm (R_Arm/back) first → torso → near arm (L_Arm/front) last,
    // so the near arm composites over the body and the far arm behind it.
    for (const group of ['back', 'body', 'front'] as const) {
      for (const { groups, shader } of built) {
        const idx = groups[group];
        if (idx.length === 0) continue;
        this.modelRoot.addChild(this.buildMesh(positions, uvs, idx, shader));
      }
    }

    // largeHeadgear hats: own geometry, drawn last.
    for (const layer of overrides) {
      const mesh2 = layer.meshOverride!;
      this.modelRoot.addChild(this.buildOverrideMesh(layer, mesh2));
    }

    this.buildOverlays(opts.overlays ?? [], zoom);

    this.renderer.render(this.stage);
  }

  async toDataURL(): Promise<string> {
    return this.renderer.extract.base64({ target: this.stage });
  }

  destroy(): void {
    this.clearScene();
    this.stage.destroy({ children: true });
    this.renderer.destroy();
  }

  // --- internals ---------------------------------------------------------------

  private applyFit(b: ModelBounds, zoom: number): void {
    const w = this.renderer.width;
    const h = this.renderer.height;
    const spanX = b.maxX - b.minX || 1;
    const spanY = b.maxY - b.minY || 1;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const sx = (w / spanX) * FIT_MARGIN * zoom;
    const sy = (h / spanY) * FIT_MARGIN * zoom;
    this.modelRoot.position.set(w / 2 - cx * sx, h / 2 + cy * sy);
    this.modelRoot.scale.set(sx, -sy); // negative Y: model-up → screen-down
  }

  private buildMesh(
    positions: Float32Array,
    uvs: Float32Array,
    idx: number[],
    shader: DwellerShader,
  ): Mesh<Geometry, DwellerShader> {
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: positions.slice(), format: 'float32x2' },
        aUV: { buffer: uvs.slice(), format: 'float32x2' },
      },
      indexBuffer: new Uint32Array(idx),
    });
    this.disposables.push(geometry);
    return new Mesh({ geometry, shader });
  }

  private buildOverrideMesh(
    layer: RendererLayerInput,
    mesh: OverrideMesh,
  ): Mesh<Geometry, DwellerShader> {
    const sub = layer.meshSubmesh;
    const indices = sub ? mesh.indices.slice(sub.start, sub.start + sub.count) : mesh.indices;
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: flatten(mesh.positions), format: 'float32x2' },
        aUV: { buffer: flatten(mesh.uvs), format: 'float32x2' },
      },
      indexBuffer: new Uint32Array(indices),
    });
    const shader = new DwellerShader();
    // Override layers (hats) are flat-tinted with no coloring mask.
    shader.update(
      {
        uvXform: [layer.uvScale[0], layer.uvScale[1], layer.uvOffset[0], layer.uvOffset[1]],
        maskXform: [1, 1, 0, 0],
        tint: tintTuple(layer),
        useMask: false,
        flipV: this.flipV,
      },
      layer.texture,
      null,
    );
    this.disposables.push(geometry, shader);
    return new Mesh({ geometry, shader });
  }

  private buildOverlays(overlays: OverlaySprite[], zoom: number): void {
    const w = this.renderer.width;
    const h = this.renderer.height;
    // Scale the overlay layer about the canvas centre so weapon/pet zoom with the figure.
    this.overlayRoot.pivot.set(w / 2, h / 2);
    this.overlayRoot.position.set(w / 2, h / 2);
    this.overlayRoot.scale.set(zoom);
    if (overlays.length === 0) return;
    for (const ov of overlays) {
      const texture = ov.frame
        ? new Texture({
            source: ov.texture.source,
            frame: new Rectangle(ov.frame.x, ov.frame.y, ov.frame.w, ov.frame.h),
          })
        : ov.texture;
      if (ov.frame) this.disposables.push(texture);
      const sprite = new Sprite(texture);
      const target = h * 0.34; // overlay box height
      const scale = target / sprite.height;
      // Weapon icons are authored muzzle-left; mirror them so they point right, matching
      // the right-facing dweller figure.
      sprite.scale.set(ov.placement === 'weapon' ? -scale : scale, scale);
      sprite.anchor.set(0.5, 1);
      // Weapon lower-right, pet lower-left.
      sprite.position.set(ov.placement === 'weapon' ? w * 0.78 : w * 0.22, h * 0.98);
      this.overlayRoot.addChild(sprite);
    }
  }

  private clearScene(): void {
    this.modelRoot.removeChildren().forEach((c) => c.destroy());
    this.overlayRoot.removeChildren().forEach((c) => c.destroy());
    for (const d of this.disposables) d.destroy();
    this.disposables = [];
  }
}

/** Create a dweller renderer (async - Pixi v8 renderer init is async). */
export async function createDwellerRenderer(
  opts: CreateRendererOptions = {},
): Promise<DwellerRenderer> {
  const renderer = await autoDetectRenderer({
    preference: 'webgl',
    width: opts.width ?? 512,
    height: opts.height ?? 512,
    backgroundAlpha: 0,
    antialias: true,
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? true,
    clearBeforeRender: true,
  });
  return new PixiDwellerRenderer(renderer, opts.flipV ?? true);
}
