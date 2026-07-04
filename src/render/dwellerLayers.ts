import type { AtlasRect, OverrideMesh } from '../domain/gamedata/visualSchemas.ts';
import {
  outfitPieceFor,
  pieceByGuid,
  pieceByName,
  type VisualAssets,
} from '../domain/gamedata/visualAssets.ts';
import { faceNameFor, type RenderableDweller, type Rgb } from './dwellerAppearance.ts';

// Build the ordered, recolorable render layers for a dweller - a reimplementation
// of the game's Dressup material composition (studied from Dressup.cs / DwellerPiece,
// not copied). Pure: produces a renderer-agnostic layer list (back-to-front) that the
// PixiJS renderer maps onto the gender body mesh. No Pixi/DOM imports here.

export type LayerSlot =
  | 'hand'
  | 'body'
  | 'outfit'
  | 'face'
  | 'faceMask'
  | 'hair'
  | 'helmet'
  | 'headgear';

export interface Tint extends Rgb {
  /** Alpha as 0..1 (multiplied into the layer). */
  a: number;
}

/** Triangle-mask override: select head triangles by the face layer's UV transform. */
export interface TriMask {
  uvScale: [number, number];
  uvOffset: [number, number];
  bounds: AtlasRect;
}

export interface RenderLayer {
  slot: LayerSlot;
  atlas: string;
  bounds: AtlasRect;
  /** A `hand` layer that is the outfit's glove pose (not bare skin fists) - so the
   * preview's view-only toggles treat it as part of the Outfit, not the Skin. */
  gloved?: boolean;
  /** A bare-skin fist layer sitting under a glove pose that OVERRIDES it: dropped in the
   * full render (the glove wins) and shown by the preview only when the glove is hidden,
   * so hiding a gloved outfit falls back to hands instead of going handless. */
  underGlove?: boolean;
  /** A hair layer normally hidden by an exclusive helmet: dropped in the full render (the
   * helmet wins) and shown by the preview only when the Helmet toggle hides the helmet,
   * so "remove helmet" reveals the dweller's real hair. */
  underHelmet?: boolean;
  tint?: Tint;
  /** sampledUV = meshUV × uvScale + uvOffset (normalized 0..1). */
  uvScale: [number, number];
  uvOffset: [number, number];
  /** When set, triangle masking uses this transform instead of the layer's own. */
  triMask?: TriMask;
  /** Outfit coloring mask (alpha-gated multiply tint), sampled in the same draw. */
  coloringMask?: {
    atlas: string;
    bounds: AtlasRect;
    uvScale: [number, number];
    uvOffset: [number, number];
  };
  /** Draw this mesh instead of the body mesh (largeHeadgear hat). */
  meshOverride?: OverrideMesh;
  /** Only draw this submesh range of meshOverride (the hat quad). */
  meshSubmesh?: { start: number; count: number };
}

/**
 * Snap a desired RGB (0..255) to the nearest entry of the outfit's allowed color
 * palette (rgba 0..1) - port of DwellerOutfit.ValidateColor. Returns the desired
 * color unchanged when the outfit defines no palette.
 */
export function nearestOutfitColor(desired: Rgb, colors?: [number, number, number, number][]): Rgb {
  if (!colors || colors.length === 0) return { r: desired.r, g: desired.g, b: desired.b };
  const dr = desired.r / 255,
    dg = desired.g / 255,
    db = desired.b / 255;
  let best = colors[0];
  let bestD = Infinity;
  for (const c of colors) {
    const d = (c[0] - dr) ** 2 + (c[1] - dg) ** 2 + (c[2] - db) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return {
    r: Math.round(best[0] * 255),
    g: Math.round(best[1] * 255),
    b: Math.round(best[2] * 255),
  };
}

const toTint = (c?: Rgb): Tint | undefined =>
  c ? { r: c.r, g: c.g, b: c.b, a: c.a == null ? 1 : c.a / 255 } : undefined;

/** The last submesh (hat quad) of a multi-submesh largeHeadgear mesh, or undefined. */
function hatQuadSubmesh(mesh: OverrideMesh): { start: number; count: number } | undefined {
  const counts = mesh.indexCounts;
  if (!counts || counts.length < 2) return undefined;
  const start = counts.slice(0, -1).reduce((a, b) => a + b, 0);
  return { start, count: counts[counts.length - 1] };
}

/**
 * Build ordered render layers (back-to-front). Head overlays (face/hair/beard/helmet)
 * reuse the body's reference scale plus the gender face offset so they map onto the
 * (packed) head region; body/outfit use their own atlas scale.
 */
export function buildLayers(dweller: RenderableDweller, assets: VisualAssets): RenderLayer[] {
  const gender: 'male' | 'female' = dweller.gender === 2 ? 'male' : 'female';
  const atlas = assets.meshSet.atlasSize;
  const { hand: handOff, face: faceOff } = assets.meshSet[gender].offsets;
  const layers: RenderLayer[] = [];

  const ownScale = (b: AtlasRect): [number, number] => [b.w / atlas, b.h / atlas];
  const ownOffset = (b: AtlasRect): [number, number] => [b.x / atlas, b.y / atlas];

  const outfit = dweller.outfitName ? outfitPieceFor(assets, dweller.outfitName, gender) : null;
  const wantBody = outfit?.flags.hasSkirt && gender === 'female' ? 'skirt_body' : 'base_body';
  const body =
    pieceByName(assets, 'body', wantBody, gender) ??
    pieceByName(assets, 'body', 'base_body', gender);
  const bodyScale: [number, number] = body ? ownScale(body.bounds) : [1, 1];

  const helmet = outfit?.helmetGuid ? pieceByGuid(assets, 'helmet', outfit.helmetGuid) : null;

  const desiredOutfitRgb: Rgb = dweller.outfitColor ?? { r: 255, g: 255, b: 255 };
  const outfitTintRgb = nearestOutfitColor(desiredOutfitRgb, outfit?.colors);

  // Hands first → arms/outfit render over them. A gloved outfit's glove pose OVERRIDES
  // the bare fists: in the full render (thumbnails + preview all-visible) only the glove
  // shows. But we still emit the bare-skin fists underneath, tagged `underGlove` so the
  // full render drops them and the preview's Outfit toggle can fall back to them when the
  // glove is hidden - without them, hiding a gloved outfit would leave the dweller handless.
  const gloveGuid = outfit?.glovePoseGuids?.find((g) => {
    const p = pieceByGuid(assets, 'glovePose', g);
    return p?.gender === gender || p?.gender === 'any';
  });
  const glovePiece = gloveGuid ? pieceByGuid(assets, 'glovePose', gloveGuid) : null;

  const fistsPiece = pieceByName(assets, 'handPose', 'fists', gender);
  if (fistsPiece) {
    const o = ownOffset(fistsPiece.bounds);
    layers.push({
      slot: 'hand',
      atlas: fistsPiece.atlas,
      bounds: fistsPiece.bounds,
      ...(glovePiece ? { underGlove: true } : {}),
      ...tintProp(toTint(dweller.skinColor)),
      uvScale: bodyScale,
      uvOffset: [o[0] + handOff[0], o[1] + handOff[1]],
    });
  }
  if (glovePiece) {
    const o = ownOffset(glovePiece.bounds);
    layers.push({
      slot: 'hand',
      gloved: true,
      atlas: glovePiece.atlas,
      bounds: glovePiece.bounds,
      ...tintProp(toTint(outfitTintRgb)),
      uvScale: bodyScale,
      uvOffset: [o[0] + handOff[0], o[1] + handOff[1]],
    });
  }

  // Body + outfit.
  if (body) {
    layers.push({
      slot: 'body',
      atlas: body.atlas,
      bounds: body.bounds,
      ...tintProp(toTint(dweller.skinColor)),
      uvScale: ownScale(body.bounds),
      uvOffset: ownOffset(body.bounds),
    });
  }
  if (outfit) {
    const colorMask = outfit.coloringMaskGuid
      ? pieceByGuid(assets, 'outfitColoringMask', outfit.coloringMaskGuid)
      : null;
    layers.push({
      slot: 'outfit',
      atlas: outfit.atlas,
      bounds: outfit.bounds,
      uvScale: ownScale(outfit.bounds),
      uvOffset: ownOffset(outfit.bounds),
      // Tint only when a mask localizes it; otherwise leave the art untouched.
      ...tintProp(colorMask ? toTint(outfitTintRgb) : undefined),
      ...(colorMask
        ? {
            coloringMask: {
              atlas: colorMask.atlas,
              bounds: colorMask.bounds,
              uvScale: ownScale(colorMask.bounds),
              uvOffset: ownOffset(colorMask.bounds),
            },
          }
        : {}),
    });
  }

  // Re-render the head skin over the collar (triMask = face UV → head triangles only).
  const faceName = faceNameFor(dweller);
  const face = pieceByName(assets, 'face', faceName, gender);
  if (body && face) {
    const faceO = ownOffset(face.bounds);
    layers.push({
      slot: 'body',
      atlas: body.atlas,
      bounds: body.bounds,
      ...tintProp(toTint(dweller.skinColor)),
      uvScale: ownScale(body.bounds),
      uvOffset: ownOffset(body.bounds),
      triMask: {
        uvScale: bodyScale,
        uvOffset: [faceO[0] + faceOff[0], faceO[1] + faceOff[1]],
        bounds: face.bounds,
      },
    });
  }
  if (face) {
    const o = ownOffset(face.bounds);
    layers.push({
      slot: 'face',
      atlas: face.atlas,
      bounds: face.bounds,
      ...tintProp(toTint(dweller.skinColor)),
      uvScale: bodyScale,
      uvOffset: [o[0] + faceOff[0], o[1] + faceOff[1]],
    });
  }

  // faceMask overlay - drawn over face, under hair. Only true FACIAL-HAIR pieces (the
  // barbershop's f_hair_* beard/mustache set) follow the dweller's hair color like
  // in-game; every other faceMask piece - glasses, masks, scars, makeup, and special
  // dwellers' pre-colored beards - keeps its original art colors (a multiply tint was
  // turning those accessories black / hair-colored).
  const faceMask = dweller.facialHair
    ? pieceByName(assets, 'faceMask', dweller.facialHair, gender)
    : null;
  if (faceMask) {
    const o = ownOffset(faceMask.bounds);
    const isFacialHair = /^f_hair_/i.test(faceMask.name);
    layers.push({
      slot: 'faceMask',
      atlas: faceMask.atlas,
      bounds: faceMask.bounds,
      ...tintProp(isFacialHair ? toTint(dweller.hairColor) : undefined),
      uvScale: bodyScale,
      uvOffset: [o[0] + faceOff[0], o[1] + faceOff[1]],
    });
  }

  // Hair - hidden when the outfit's helmet is exclusive (m_isExclusive). Still emitted,
  // tagged `underHelmet`, so the preview's Helmet toggle can reveal it; the full render
  // (thumbnails) drops it, matching the game.
  const hairExcluded = helmet?.flags.isExclusive === true;
  const hair = dweller.hairName ? pieceByName(assets, 'hair', dweller.hairName, gender) : null;
  if (hair && !hair.flags.isBald) {
    const o = ownOffset(hair.bounds);
    layers.push({
      slot: 'hair',
      atlas: hair.atlas,
      bounds: hair.bounds,
      ...(hairExcluded ? { underHelmet: true } : {}),
      ...tintProp(toTint(dweller.hairColor)),
      uvScale: bodyScale,
      uvOffset: [o[0] + faceOff[0], o[1] + faceOff[1]],
    });
  }

  // Helmet - head overlay, same transform as hair/face.
  if (helmet) {
    const o = ownOffset(helmet.bounds);
    layers.push({
      slot: 'helmet',
      atlas: helmet.atlas,
      bounds: helmet.bounds,
      uvScale: bodyScale,
      uvOffset: [o[0] + faceOff[0], o[1] + faceOff[1]],
    });
  }

  // largeHeadgear (e.g. Bishop mitre) - own prebaked hat mesh; draw only the hat quad.
  const largeHeadgearPiece = outfit?.largeHeadgearGuid
    ? pieceByGuid(assets, 'largeHeadgear', outfit.largeHeadgearGuid)
    : null;
  const meshes = largeHeadgearPiece
    ? assets.spriteIndex.largeHeadgearMeshes[largeHeadgearPiece.guid]
    : undefined;
  const largeHeadgearMesh = meshes
    ? gender === 'male'
      ? meshes.male
      : (meshes.female ?? meshes.male)
    : null;
  if (largeHeadgearPiece && largeHeadgearMesh) {
    const submesh = hatQuadSubmesh(largeHeadgearMesh);
    layers.push({
      slot: 'headgear',
      atlas: largeHeadgearPiece.atlas,
      bounds: largeHeadgearPiece.bounds,
      uvScale: ownScale(largeHeadgearPiece.bounds),
      uvOffset: ownOffset(largeHeadgearPiece.bounds),
      meshOverride: largeHeadgearMesh,
      ...(submesh ? { meshSubmesh: submesh } : {}),
    });
  }

  return layers;
}

/** exactOptional-safe `{ tint }` spread (omit the key entirely when undefined). */
function tintProp(tint: Tint | undefined): { tint?: Tint } {
  return tint ? { tint } : {};
}

export interface BuildLayersResult {
  layers: RenderLayer[];
  /** Original outfit id when it wasn't found (renderer fell back to the jumpsuit). */
  unknownOutfit?: string;
}

/** buildLayers with unknown-outfit fallback to the jumpsuit (matches in-game behavior). */
export function buildLayersWithMeta(
  dweller: RenderableDweller,
  assets: VisualAssets,
): BuildLayersResult {
  const gender: 'male' | 'female' = dweller.gender === 2 ? 'male' : 'female';
  if (dweller.outfitName && !outfitPieceFor(assets, dweller.outfitName, gender)) {
    return {
      layers: buildLayers({ ...dweller, outfitName: 'jumpsuit' }, assets),
      unknownOutfit: dweller.outfitName,
    };
  }
  return { layers: buildLayers(dweller, assets) };
}

export type { VisualAssets };
