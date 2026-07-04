import { faceNameFor, type RenderableDweller, type Rgb } from './dwellerAppearance.ts';

// Stable cache key for a dweller's *rendered* appearance. Two dwellers that look
// identical (same gender/age, outfit, hair, facial hair, face, and colors) share a
// single thumbnail render - so the roster's offscreen renderer runs at most once per
// distinct look, not once per row. Pure (no Pixi/DOM) so it is node-unit-testable and
// safe to import from both the renderer module and the hook.
//
// The face is keyed by its rendered piece name (faceNameFor), not the raw happiness
// value: happiness 80 and 90 both render the "smile" face, so they collapse to one key.

const colorKey = (c?: Rgb): string => (c ? `${c.r},${c.g},${c.b}` : '-');

/** Build the appearance key from everything that affects the rendered figure. */
export function dwellerThumbnailKey(d: RenderableDweller): string {
  return [
    d.gender,
    d.isChild ? 'child' : 'adult',
    d.outfitName ?? '-',
    d.hairName ?? '-',
    d.facialHair ?? '-',
    faceNameFor(d),
    colorKey(d.skinColor),
    colorKey(d.hairColor),
    colorKey(d.outfitColor),
  ].join('|');
}
