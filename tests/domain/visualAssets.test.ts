// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  iconAtlasSize,
  iconFor,
  isKnownOutfitItem,
  outfitPieceFor,
  parseVisualAssets,
  pieceByName,
} from '../../src/domain/gamedata/visualAssets.ts';

// Validates the committed public/gamedata/atlas/*.json (generated offline by
// scripts/build-gamedata) against the visual-asset schemas. These ship in the repo,
// so this runs in CI without the game export.
function load(name: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'public/gamedata/atlas', name), 'utf8'));
}

const assets = parseVisualAssets({
  meshes: load('meshes.json'),
  spriteIndex: load('sprite-index.json'),
  itemIcons: load('item-icons.json'),
});

describe('visual assets - dweller meshes', () => {
  it('ships posed per-gender body geometry with the catalog offsets', () => {
    expect(assets.meshSet.atlasSize).toBe(1024);
    expect(assets.meshSet.male.adult.positions.length).toBe(68);
    expect(assets.meshSet.female.adult.positions.length).toBe(64);
    // Idle pose was baked (renderer falls back to bind pose otherwise).
    expect(assets.meshSet.male.adult.posedPositions?.length).toBe(68);
    // Offsets confirmed against DwellerCatalog.prefab (version-stable).
    expect(assets.meshSet.male.offsets.hand).toEqual([0, -0.126]);
    expect(assets.meshSet.female.offsets.face).toEqual([-0.0025, -0.005]);
  });

  it('baked idle pose narrows the spread T-pose (arms brought in)', () => {
    const bindW = bbox(assets.meshSet.male.adult.positions).w;
    const posedW = bbox(assets.meshSet.male.adult.posedPositions!).w;
    expect(posedW).toBeLessThan(bindW);
  });
});

describe('visual assets - sprite index', () => {
  it('indexes the expected piece counts', () => {
    expect(assets.spriteIndex.byType.body.length).toBeGreaterThanOrEqual(4);
    expect(assets.spriteIndex.byType.outfit.length).toBeGreaterThan(200);
    expect(assets.spriteIndex.outfitItems.length).toBeGreaterThan(200);
  });

  it('resolves the base body piece per gender', () => {
    expect(pieceByName(assets, 'body', 'base_body', 'male')?.atlas).toMatch(/\.png$/);
    expect(pieceByName(assets, 'body', 'base_body', 'female')).not.toBeNull();
  });

  it('resolves an equippable outfit id to its visual piece (the jumpsuit)', () => {
    expect(isKnownOutfitItem(assets, 'jumpsuit')).toBe(true);
    expect(isKnownOutfitItem(assets, 'NotARealOutfit')).toBe(false);
    const piece = outfitPieceFor(assets, 'jumpsuit', 'male');
    expect(piece?.name).toBe('jumpsuit');
    expect(piece?.bounds.w).toBeGreaterThan(0);
  });

  it('carries outfit cross-references (helmet / coloring mask) as resolved guids', () => {
    const withMask = assets.spriteIndex.byType.outfit.find((o) => o.coloringMaskGuid);
    expect(withMask?.coloringMaskGuid).toMatch(/^[0-9a-f]+$/);
  });
});

describe('visual assets - item icons', () => {
  it('matches a known weapon icon with a real atlas rect', () => {
    const icon = iconFor(assets, 'weapons', '032Pistol');
    expect(icon).not.toBeNull();
    expect(icon!.atlas).toBe('Weapons_HD.png');
    expect(icon!.w).toBeGreaterThan(0);
    expect(iconAtlasSize(assets, icon!)).toEqual({ w: 2048, h: 2048 });
  });

  it('matches outfit, junk, and pet icons', () => {
    expect(iconFor(assets, 'junk', 'AlarmClock')).not.toBeNull();
    expect(iconFor(assets, 'outfits', 'jumpsuit')).not.toBeNull();
    expect(iconFor(assets, 'pets', 'abyssinian_c')).not.toBeNull();
  });
});

function bbox(pts: [number, number][]): { w: number; h: number } {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { w: maxX - minX, h: maxY - minY };
}
