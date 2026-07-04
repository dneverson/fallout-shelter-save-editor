import type { Dweller } from '../domain/model/saveSchema.ts';

// Adapts a raw save Dweller into the minimal appearance description the layer
// builder needs. Pure - no Pixi/DOM. The save stores colors as ARGB uint32 and
// references hair/face/outfit pieces by name; the face is NOT stored (derived from
// happiness, per the game's DwellerFace thresholds).

export interface Rgb {
  r: number; // 0..255
  g: number; // 0..255
  b: number; // 0..255
  a?: number; // 0..255
}

export interface RenderableDweller {
  /** 1 = female, 2 = male (save convention). */
  gender: number;
  /** experience.currentLevel === 0 - children are not customizable in-game. */
  isChild: boolean;
  hairName?: string;
  /** faceMask = male beard/mustache piece name. */
  facialHair?: string;
  /** equiped outfit id (e.g. "jumpsuit"). */
  outfitName?: string;
  happinessValue?: number;
  skinColor?: Rgb;
  hairColor?: Rgb;
  outfitColor?: Rgb;
}

/** Decode a save ARGB uint32 (0xAARRGGBB) into 0..255 channels. */
export function argbToRgb(argb: number | undefined): Rgb | undefined {
  if (argb == null) return undefined;
  const v = argb >>> 0;
  return { a: (v >>> 24) & 0xff, r: (v >>> 16) & 0xff, g: (v >>> 8) & 0xff, b: v & 0xff };
}

/** experience.currentLevel === 0 marks an uncustomizable child. */
function isChildDweller(d: Pick<Dweller, 'experience'>): boolean {
  return d.experience?.currentLevel === 0;
}

/**
 * Face piece name for a dweller. Children use the dedicated child face; adults map
 * happiness to sad / neutral / smile (DwellerFace.cs thresholds).
 */
export function faceNameFor(d: RenderableDweller): string {
  if (d.isChild) return 'child';
  const h = d.happinessValue ?? 100;
  if (h < 50) return 'sad';
  if (h <= 75) return 'neutral';
  return 'smile';
}

/** Build the renderable appearance from a raw Dweller (exactOptional-safe). */
export function toRenderableDweller(d: Dweller): RenderableDweller {
  const skin = argbToRgb(d.skinColor);
  const hairC = argbToRgb(d.hairColor);
  const outfitC = argbToRgb(d.outfitColor);
  return {
    gender: d.gender ?? 2,
    isChild: isChildDweller(d),
    ...(d.hair !== undefined ? { hairName: d.hair } : {}),
    ...(d.faceMask !== undefined ? { facialHair: d.faceMask } : {}),
    ...(d.equipedOutfit?.id !== undefined ? { outfitName: d.equipedOutfit.id } : {}),
    ...(d.happiness?.happinessValue !== undefined
      ? { happinessValue: d.happiness.happinessValue }
      : {}),
    ...(skin ? { skinColor: skin } : {}),
    ...(hairC ? { hairColor: hairC } : {}),
    ...(outfitC ? { outfitColor: outfitC } : {}),
  };
}
