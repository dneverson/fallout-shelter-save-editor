import { useVisualAssets } from '../hooks/useVisualAssets.ts';
import { iconAtlasSize, iconFor } from '../../domain/gamedata/visualAssets.ts';
import type { ItemIconType } from '../../domain/gamedata/visualSchemas.ts';
import { spriteStyle } from './itemIconSprite.ts';

// Shared item-icon chip: a fixed-size CSS background
// sprite cropped from the served atlas PNGs. Decorative - it always sits beside a text
// label, so it's aria-hidden. Read-only display; it never touches the save. Reads the
// visual assets itself (module-cached, mirrors DwellerThumbnailCell) so the column
// definitions that use it stay pure data. When the icon is unknown (the handful of
// enemy-costume outfit misses, a missing pet/weapon, or assets still loading) it degrades
// to a neutral placeholder box rather than breaking the row.

const DEFAULT_SIZE = 22;

export interface ItemIconProps {
  type: ItemIconType;
  id: string;
  /** Tried when the primary (type, id) sprite is missing from the index. */
  fallback?: { type: ItemIconType; id: string };
  /** Box edge length in px (the sprite is scaled to fill it). */
  size?: number;
  className?: string;
}

export function ItemIcon({ type, id, fallback, size = DEFAULT_SIZE, className }: ItemIconProps) {
  const { assets } = useVisualAssets();
  const icon = assets
    ? (iconFor(assets, type, id) ?? (fallback ? iconFor(assets, fallback.type, fallback.id) : null))
    : null;
  const atlas = assets && icon ? iconAtlasSize(assets, icon) : null;

  const base = `inline-block shrink-0 rounded-sm${className ? ` ${className}` : ''}`;

  if (!icon || !atlas) {
    // Neutral placeholder: keeps the cell's layout stable while loading or on a miss.
    return (
      <span
        aria-hidden="true"
        className={`${base} bg-neutral-800`}
        style={{ width: `${size}px`, height: `${size}px` }}
      />
    );
  }

  return <span aria-hidden="true" className={base} style={spriteStyle(icon, atlas, size)} />;
}
