import type { ItemIcon } from '../../domain/gamedata/visualSchemas.ts';
import { assetUrl } from '../../domain/gamedata/assetBase.ts';

// Pure CSS-background-sprite math for <ItemIcon>. The item icons are
// flat 2D crops packed into the served atlas PNGs (public/gamedata/atlas/*.png); rather
// than slicing them at build time we render each as a scaled CSS background sprite. Kept
// in its own module (no JSX) so it is Fast-Refresh-clean and unit-testable in Node - the
// browser screenshots are the visual test; this is the numeric one.

/** Where the atlas PNGs are served (mirrors loadVisualAssets' default base). */
export const ATLAS_BASE_URL = assetUrl('gamedata/atlas');

export interface SpriteStyle {
  width: string;
  height: string;
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: 'no-repeat';
}

/**
 * Crop `icon` (native `w`×`h` at `x,y` on an `atlas.w`×`atlas.h` sheet) into a fixed
 * `size`×`size` box. The sprite is scaled independently on each axis (`size/w`, `size/h`)
 * so the icon's bounds exactly fill the square box, then offset to bring the crop to the
 * origin. Pure - returns only CSS values, no DOM.
 */
export function spriteStyle(
  icon: ItemIcon,
  atlas: { w: number; h: number },
  size: number,
): SpriteStyle {
  const sx = size / icon.w;
  const sy = size / icon.h;
  return {
    width: `${size}px`,
    height: `${size}px`,
    backgroundImage: `url(${ATLAS_BASE_URL}/${icon.atlas})`,
    backgroundSize: `${atlas.w * sx}px ${atlas.h * sy}px`,
    backgroundPosition: `${-icon.x * sx}px ${-icon.y * sy}px`,
    backgroundRepeat: 'no-repeat',
  };
}
