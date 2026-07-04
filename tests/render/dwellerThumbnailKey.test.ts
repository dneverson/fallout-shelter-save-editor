// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { RenderableDweller } from '../../src/render/dwellerAppearance.ts';
import { dwellerThumbnailKey } from '../../src/render/dwellerThumbnailKey.ts';

const base: RenderableDweller = {
  gender: 2,
  isChild: false,
  outfitName: 'jumpsuit',
  hairName: 'mohawk',
  facialHair: 'beard',
  happinessValue: 100,
  skinColor: { r: 240, g: 200, b: 170 },
  hairColor: { r: 80, g: 50, b: 20 },
  outfitColor: { r: 10, g: 20, b: 30 },
};

describe('dwellerThumbnailKey', () => {
  it('produces identical keys for identical-looking dwellers', () => {
    expect(dwellerThumbnailKey(base)).toBe(dwellerThumbnailKey({ ...base }));
  });

  it('collapses happiness values that render the same face', () => {
    // 80 and 90 both map to the "smile" face piece → one cache key.
    const a = dwellerThumbnailKey({ ...base, happinessValue: 80 });
    const b = dwellerThumbnailKey({ ...base, happinessValue: 90 });
    expect(a).toBe(b);
  });

  it('distinguishes faces across happiness thresholds', () => {
    const sad = dwellerThumbnailKey({ ...base, happinessValue: 30 });
    const neutral = dwellerThumbnailKey({ ...base, happinessValue: 60 });
    const smile = dwellerThumbnailKey({ ...base, happinessValue: 90 });
    expect(new Set([sad, neutral, smile]).size).toBe(3);
  });

  it('changes when any appearance dimension changes', () => {
    const keys = [
      dwellerThumbnailKey(base),
      dwellerThumbnailKey({ ...base, gender: 1 }),
      dwellerThumbnailKey({ ...base, isChild: true }),
      dwellerThumbnailKey({ ...base, outfitName: 'lab_coat' }),
      dwellerThumbnailKey({ ...base, hairName: 'bob' }),
      dwellerThumbnailKey({ ...base, facialHair: 'mustache' }),
      dwellerThumbnailKey({ ...base, skinColor: { r: 0, g: 255, b: 0 } }),
      dwellerThumbnailKey({ ...base, hairColor: { r: 0, g: 0, b: 255 } }),
      dwellerThumbnailKey({ ...base, outfitColor: { r: 255, g: 0, b: 0 } }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is exactOptional-safe - absent optional fields collapse to a placeholder token', () => {
    const minimal: RenderableDweller = { gender: 1, isChild: false };
    // child face is forced for children; minimal adult uses happiness default (smile).
    expect(dwellerThumbnailKey(minimal)).toBe('1|adult|-|-|-|smile|-|-|-');
  });
});
