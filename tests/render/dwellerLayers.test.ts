// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseVisualAssets } from '../../src/domain/gamedata/visualAssets.ts';
import {
  buildLayers,
  buildLayersWithMeta,
  nearestOutfitColor,
} from '../../src/render/dwellerLayers.ts';
import { argbToRgb, faceNameFor, toRenderableDweller } from '../../src/render/dwellerAppearance.ts';
import type { RenderableDweller } from '../../src/render/dwellerAppearance.ts';

function load(name: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'public/gamedata/atlas', name), 'utf8'));
}
const assets = parseVisualAssets({
  meshes: load('meshes.json'),
  spriteIndex: load('sprite-index.json'),
  itemIcons: load('item-icons.json'),
});

const maleJumpsuit: RenderableDweller = {
  gender: 2,
  isChild: false,
  outfitName: 'jumpsuit',
  happinessValue: 100,
  skinColor: { r: 240, g: 200, b: 170 },
  hairColor: { r: 80, g: 50, b: 20 },
};

describe('appearance adapter', () => {
  it('decodes ARGB uint32 into channels', () => {
    expect(argbToRgb(0xff8040c0)).toEqual({ a: 255, r: 0x80, g: 0x40, b: 0xc0 });
    expect(argbToRgb(undefined)).toBeUndefined();
  });

  it('derives the face from happiness (and child)', () => {
    expect(faceNameFor({ ...maleJumpsuit, happinessValue: 30 })).toBe('sad');
    expect(faceNameFor({ ...maleJumpsuit, happinessValue: 60 })).toBe('neutral');
    expect(faceNameFor({ ...maleJumpsuit, happinessValue: 90 })).toBe('smile');
    expect(faceNameFor({ ...maleJumpsuit, isChild: true })).toBe('child');
  });

  it('adapts a raw dweller (exactOptional-safe, omits absent fields)', () => {
    const r = toRenderableDweller({
      serializeId: 1,
      gender: 1,
      equipedOutfit: { id: 'jumpsuit', type: 'Outfit' },
      experience: { currentLevel: 5, experienceValue: 0, needLvUp: false },
      skinColor: 0xfff0c8aa,
    });
    expect(r.gender).toBe(1);
    expect(r.isChild).toBe(false);
    expect(r.outfitName).toBe('jumpsuit');
    expect(r.skinColor).toEqual({ a: 255, r: 0xf0, g: 0xc8, b: 0xaa });
    expect('hairName' in r).toBe(false); // absent key, not undefined
  });
});

describe('nearestOutfitColor (ValidateColor port)', () => {
  it('returns desired unchanged with no palette', () => {
    expect(nearestOutfitColor({ r: 10, g: 20, b: 30 })).toEqual({ r: 10, g: 20, b: 30 });
  });
  it('snaps to the nearest palette entry', () => {
    const palette: [number, number, number, number][] = [
      [0, 0, 0, 1],
      [1, 1, 1, 1],
    ];
    expect(nearestOutfitColor({ r: 250, g: 250, b: 250 }, palette)).toEqual({
      r: 255,
      g: 255,
      b: 255,
    });
    expect(nearestOutfitColor({ r: 5, g: 5, b: 5 }, palette)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('buildLayers - Dressup composition', () => {
  const layers = buildLayers(maleJumpsuit, assets);
  const slots = layers.map((l) => l.slot);

  it('emits the core back-to-front layers for a clothed dweller', () => {
    expect(slots).toContain('hand');
    expect(slots).toContain('body');
    expect(slots).toContain('outfit');
    expect(slots).toContain('face');
  });

  it('orders body before outfit before face (painter order)', () => {
    expect(slots.indexOf('body')).toBeLessThan(slots.indexOf('outfit'));
    expect(slots.indexOf('outfit')).toBeLessThan(slots.indexOf('face'));
  });

  it('re-renders head skin over the collar (a body layer carrying a triMask)', () => {
    expect(layers.some((l) => l.slot === 'body' && l.triMask)).toBe(true);
  });

  it('every layer references a real atlas PNG with normalized UV transforms', () => {
    for (const l of layers) {
      expect(l.atlas).toMatch(/\.png$/);
      expect(l.uvScale[0]).toBeGreaterThan(0);
      expect(l.uvScale[0]).toBeLessThanOrEqual(1);
    }
  });

  it('tints the body with skin color', () => {
    const body = layers.find((l) => l.slot === 'body' && !l.triMask);
    expect(body?.tint).toMatchObject({ r: 240, g: 200, b: 170 });
  });

  it('emits one plain bare-fist hand (skin-owned) for a non-gloved outfit', () => {
    const hands = layers.filter((l) => l.slot === 'hand');
    expect(hands.length).toBe(1);
    expect(hands[0].gloved).toBeFalsy();
    expect(hands[0].underGlove).toBeFalsy(); // not a fallback - it's the real, shown hand
    expect(hands[0].tint).toMatchObject({ r: 240, g: 200, b: 170 });
  });

  it('overrides bare fists with the glove but keeps them as an under-glove fallback', () => {
    // EnclavePowerArmor carries a male glove pose → bare fists (fallback) + glove (shown).
    const gloved = buildLayers({ ...maleJumpsuit, outfitName: 'EnclavePowerArmor' }, assets);
    const hands = gloved.filter((l) => l.slot === 'hand');
    expect(hands.length).toBe(2);
    const bare = hands.find((l) => l.underGlove);
    const glove = hands.find((l) => l.gloved);
    // The fallback fists are skin-tinted + tagged underGlove (full render drops them).
    expect(bare?.tint).toMatchObject({ r: 240, g: 200, b: 170 });
    expect(bare?.gloved).toBeFalsy();
    // The glove is outfit-tinted and draws AFTER the fists.
    expect(glove?.tint).not.toMatchObject({ r: 240, g: 200, b: 170 });
    expect(gloved.indexOf(glove!)).toBeGreaterThan(gloved.indexOf(bare!));
  });
});

describe('buildLayersWithMeta - unknown outfit fallback', () => {
  it('falls back to the jumpsuit and reports the unknown id', () => {
    const res = buildLayersWithMeta({ ...maleJumpsuit, outfitName: 'NotARealOutfit' }, assets);
    expect(res.unknownOutfit).toBe('NotARealOutfit');
    expect(res.layers.some((l) => l.slot === 'outfit')).toBe(true);
  });

  it('reports nothing for a known outfit', () => {
    expect(buildLayersWithMeta(maleJumpsuit, assets).unknownOutfit).toBeUndefined();
  });
});
