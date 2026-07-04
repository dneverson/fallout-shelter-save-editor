import { useEffect, useRef, useState } from 'react';
import type { Texture } from 'pixi.js';
import type { Dweller } from '../../../domain/model/saveSchema.ts';
import { toRenderableDweller } from '../../../render/dwellerAppearance.ts';
import { buildLayersWithMeta, type LayerSlot } from '../../../render/dwellerLayers.ts';
import {
  createDwellerRenderer,
  type DwellerRenderer,
  type OverlaySprite,
  type RendererLayerInput,
} from '../../../render/dwellerRenderer.ts';
import { loadAtlasTexture } from '../../../render/atlasTextures.ts';
import { iconFor, type VisualAssets } from '../../../domain/gamedata/visualAssets.ts';

// Live, recolorable dweller preview. Renders the selected dweller through the
// PixiJS renderer and exposes the always-visible layer-toggle chip row + a zoom control.
// The toggles are VIEW-ONLY (they hide/show a composite layer; they never unequip). Weapon
// and Pet are flat portrait-sprite overlays from the item-icon atlases. Children render but
// are not customizable, matching the rest of the sheet.

const CANVAS_SIZE = 384;

// Chip → which composited layer slots it controls (weapon/pet are sprite overlays).
type Chip = 'skin' | 'face' | 'hair' | 'beard' | 'outfit' | 'helmet' | 'weapon' | 'pet';

const CHIP_ORDER: ReadonlyArray<{ key: Chip; label: string }> = [
  { key: 'skin', label: 'Skin' },
  { key: 'face', label: 'Face' },
  { key: 'hair', label: 'Hair' },
  // faceMask pieces are beards on men but also glasses/face paint/ghoul faces etc.,
  // so the universal name is Accessory, not Beard.
  { key: 'beard', label: 'Accessory' },
  { key: 'outfit', label: 'Outfit' },
  { key: 'helmet', label: 'Helmet' },
  { key: 'weapon', label: 'Weapon' },
  { key: 'pet', label: 'Pet' },
];

type Visible = Record<Chip, boolean>;
const ALL_VISIBLE: Visible = {
  skin: true,
  face: true,
  hair: true,
  beard: true,
  outfit: true,
  helmet: true,
  weapon: true,
  pet: true,
};

function layerVisible(
  layer: { slot: LayerSlot; gloved?: boolean; underGlove?: boolean; underHelmet?: boolean },
  v: Visible,
): boolean {
  switch (layer.slot) {
    case 'hand':
      // Glove poses belong to the outfit and override the bare fists; the under-glove
      // fists are a Skin-owned fallback shown only when the glove (outfit) is hidden.
      if (layer.gloved) return v.outfit;
      if (layer.underGlove) return v.skin && !v.outfit;
      return v.skin;
    case 'body':
      return v.skin;
    case 'face':
      return v.face;
    case 'hair':
      // Hair hidden by an exclusive helmet shows only once the helmet is toggled off,
      // so "remove helmet" reveals the dweller's real hair.
      if (layer.underHelmet) return v.hair && !v.helmet;
      return v.hair;
    case 'faceMask':
      return v.beard;
    case 'outfit':
      return v.outfit;
    case 'helmet':
    case 'headgear':
      return v.helmet;
  }
}

interface DwellerPreviewProps {
  dweller: Dweller;
  assets: VisualAssets;
}

export function DwellerPreview({ dweller, assets }: DwellerPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<DwellerRenderer | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Visible>(ALL_VISIBLE);
  const [zoom, setZoom] = useState(1);

  // Reset the view-only layer toggles when a different dweller is selected (the sheet
  // stays mounted across selections). Adjust-during-render, not an effect - the project
  // bans setState-in-useEffect (React Compiler lint).
  const [lastId, setLastId] = useState(dweller.serializeId);
  if (dweller.serializeId !== lastId) {
    setLastId(dweller.serializeId);
    setVisible(ALL_VISIBLE);
  }

  // Create the WebGL renderer once and mount its canvas; tear it down on unmount.
  useEffect(() => {
    let disposed = false;
    let renderer: DwellerRenderer | null = null;
    createDwellerRenderer({ width: CANVAS_SIZE, height: CANVAS_SIZE })
      .then((r) => {
        if (disposed) {
          r.destroy();
          return;
        }
        renderer = r;
        rendererRef.current = r;
        const host = hostRef.current;
        if (host) {
          r.canvas.style.width = '100%';
          r.canvas.style.height = 'auto';
          host.appendChild(r.canvas);
        }
        setReady(true);
      })
      .catch((e: unknown) => {
        if (!disposed) setError(e instanceof Error ? e.message : 'Renderer init failed.');
      });
    return () => {
      disposed = true;
      rendererRef.current = null;
      renderer?.destroy();
    };
  }, []);

  // Re-render whenever the dweller, visibility, or zoom changes (live recolor flows through
  // the new dweller object after each edit). Async because atlas textures load on demand.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!ready || !renderer) return;
    let cancelled = false;

    (async () => {
      try {
        const renderable = toRenderableDweller(dweller);
        const gender: 'male' | 'female' = renderable.gender === 2 ? 'male' : 'female';
        const meshData = assets.meshSet[gender];
        const mesh = renderable.isChild ? meshData.child : meshData.adult;
        const { layers } = buildLayersWithMeta(renderable, assets);
        const meshLayers = layers.filter((l) => layerVisible(l, visible));

        // Gather every atlas the visible layers (and overlays) need, load once, then map.
        const overlaySpecs = collectOverlays(dweller, assets, visible);
        const filenames = new Set<string>();
        for (const l of meshLayers) {
          filenames.add(l.atlas);
          if (l.coloringMask) filenames.add(l.coloringMask.atlas);
        }
        for (const o of overlaySpecs) filenames.add(o.atlas);

        const entries = await Promise.all(
          [...filenames].map(async (f) => [f, await loadAtlasTexture(f)] as const),
        );
        if (cancelled) return;
        const textures = new Map<string, Texture>(entries);

        const inputs: RendererLayerInput[] = meshLayers.map((l) => ({
          ...l,
          texture: textures.get(l.atlas)!,
          ...(l.coloringMask ? { maskTexture: textures.get(l.coloringMask.atlas)! } : {}),
        }));

        const overlays: OverlaySprite[] = overlaySpecs.map((o) => ({
          texture: textures.get(o.atlas)!,
          frame: { x: o.x, y: o.y, w: o.w, h: o.h },
          placement: o.placement,
        }));

        renderer.render(mesh, inputs, {
          zoom,
          atlasSize: assets.meshSet.atlasSize,
          overlays,
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Render failed.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, dweller, assets, visible, zoom]);

  const toggle = (key: Chip): void => setVisible((v) => ({ ...v, [key]: !v[key] }));

  return (
    <div className="mt-3">
      <div
        ref={hostRef}
        className="mx-auto w-full max-w-[288px] rounded border border-neutral-800 bg-neutral-950"
        style={{ aspectRatio: '1 / 1' }}
      />
      {error && <p className="mt-1 text-center text-[11px] text-red-400">Preview: {error}</p>}

      {/* Layer-toggle chip row (view-only) */}
      <div className="mt-2 flex flex-wrap justify-center gap-1">
        {CHIP_ORDER.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={visible[key]}
            onClick={() => toggle(key)}
            className={`rounded border px-2 py-0.5 text-[11px] ${
              visible[key]
                ? 'border-amber-600/60 bg-amber-500/15 text-amber-200'
                : 'border-neutral-700 bg-neutral-900 text-neutral-400 line-through'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Zoom */}
      <label className="mt-2 flex items-center gap-2 text-[11px] text-neutral-400">
        Zoom
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="flex-1 accent-amber-500"
          aria-label="Zoom"
        />
        <span className="w-8 tabular-nums">{zoom.toFixed(1)}×</span>
      </label>
    </div>
  );
}

interface OverlaySpec {
  atlas: string;
  x: number;
  y: number;
  w: number;
  h: number;
  placement: 'weapon' | 'pet';
}

/** Weapon + pet portrait overlays from the item-icon atlases, gated by their chips. */
function collectOverlays(dweller: Dweller, assets: VisualAssets, visible: Visible): OverlaySpec[] {
  const out: OverlaySpec[] = [];
  const weaponId = dweller.equipedWeapon?.id;
  if (visible.weapon && weaponId && weaponId !== 'Fist') {
    const icon = iconFor(assets, 'weapons', weaponId);
    if (icon) out.push({ ...icon, placement: 'weapon' });
  }
  const petId = dweller.equippedPet?.id;
  if (visible.pet && petId) {
    // Full-body pet sprite for the preview (falls back to the head portrait).
    const icon = iconFor(assets, 'petBodies', petId) ?? iconFor(assets, 'pets', petId);
    if (icon) out.push({ ...icon, placement: 'pet' });
  }
  return out;
}
