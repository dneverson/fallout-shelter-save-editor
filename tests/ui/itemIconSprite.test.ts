// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { ItemIcon } from '../../src/domain/gamedata/visualSchemas.ts';
import { ATLAS_BASE_URL, spriteStyle } from '../../src/ui/components/itemIconSprite.ts';

// The CSS-sprite math is pure, so it's the unit-testable half of <ItemIcon> (jsdom
// can't render background sprites - the browser screenshots cover the visual side).

const weapon: ItemIcon = { atlas: 'Weapons_HD.png', x: 1948, y: 1491, w: 90, h: 167 };
const atlas = { w: 2048, h: 2048 };

describe('spriteStyle', () => {
  it('scales each axis so the icon bounds exactly fill the square box', () => {
    const style = spriteStyle(weapon, atlas, 22);
    const sx = 22 / 90;
    const sy = 22 / 167;
    expect(style.width).toBe('22px');
    expect(style.height).toBe('22px');
    expect(style.backgroundSize).toBe(`${2048 * sx}px ${2048 * sy}px`);
    expect(style.backgroundPosition).toBe(`${-1948 * sx}px ${-1491 * sy}px`);
    expect(style.backgroundRepeat).toBe('no-repeat');
  });

  it('points background-image at the served atlas PNG', () => {
    expect(spriteStyle(weapon, atlas, 22).backgroundImage).toBe(
      `url(${ATLAS_BASE_URL}/Weapons_HD.png)`,
    );
  });

  it('brings a top-left (0,0) crop to the box origin', () => {
    const corner: ItemIcon = { atlas: 'Junks_HD.png', x: 0, y: 0, w: 200, h: 200 };
    const style = spriteStyle(corner, { w: 1024, h: 1024 }, 24);
    expect(style.backgroundPosition).toBe('0px 0px');
    // 1024 / 200 * 24 = 122.88 on both axes (square crop → uniform scale).
    expect(style.backgroundSize).toBe('122.88px 122.88px');
  });

  it('scales position and size linearly with the box size', () => {
    const a = spriteStyle(weapon, atlas, 22);
    const b = spriteStyle(weapon, atlas, 44);
    const sizeAxis = (v: string): number[] => v.split(' ').map((p) => parseFloat(p));
    const [aw, ah] = sizeAxis(a.backgroundSize);
    const [bw, bh] = sizeAxis(b.backgroundSize);
    expect(bw).toBeCloseTo(aw * 2);
    expect(bh).toBeCloseTo(ah * 2);
  });
});
