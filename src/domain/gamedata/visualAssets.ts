import {
  dwellerMeshSetSchema,
  itemIconsSchema,
  spriteIndexSchema,
  type DwellerMeshSet,
  type ItemIcon,
  type ItemIcons,
  type ItemIconType,
  type OutfitItem,
  type PieceGender,
  type PieceRef,
  type SpriteIndex,
} from './visualSchemas.ts';
import { assetUrl } from './assetBase.ts';

// Visual-asset access layer: validates the committed
// public/gamedata/atlas/*.json and builds the lookup maps the renderer needs
// (piece-by-name/gender, piece-by-guid, outfit-item-by-id, item-icon-by-id). Pure
// - no DOM/Pixi imports - so it is unit-testable in Node and reusable by both the
// preview renderer and the table thumbnail path.

export interface VisualAssets {
  meshSet: DwellerMeshSet;
  spriteIndex: SpriteIndex;
  itemIcons: ItemIcons;
  /** `${type}|${name}|${gender}` → piece (gender ∈ male/female/any). */
  pieceByNameGender: ReadonlyMap<string, PieceRef>;
  /** `${type}|${guid}` → piece (m_guid can repeat across types, so it's type-scoped). */
  pieceByTypeGuid: ReadonlyMap<string, PieceRef>;
  outfitItemById: ReadonlyMap<string, OutfitItem>;
}

export interface RawVisualAssets {
  meshes: unknown;
  spriteIndex: unknown;
  itemIcons: unknown;
}

/** Validate raw JSON and index it. Pure - no I/O. */
export function parseVisualAssets(raw: RawVisualAssets): VisualAssets {
  const meshSet = dwellerMeshSetSchema.parse(raw.meshes);
  const spriteIndex = spriteIndexSchema.parse(raw.spriteIndex);
  const itemIcons = itemIconsSchema.parse(raw.itemIcons);

  const pieceByNameGender = new Map<string, PieceRef>();
  const pieceByTypeGuid = new Map<string, PieceRef>();
  for (const [type, pieces] of Object.entries(spriteIndex.byType)) {
    for (const piece of pieces) {
      // First entry wins for a (type,name,gender) key - deterministic since the
      // generator sorts by name then guid.
      const nk = `${type}|${piece.name}|${piece.gender}`;
      if (!pieceByNameGender.has(nk)) pieceByNameGender.set(nk, piece);
      pieceByTypeGuid.set(`${type}|${piece.guid}`, piece);
    }
  }

  const outfitItemById = new Map(spriteIndex.outfitItems.map((o) => [o.id, o]));

  return { meshSet, spriteIndex, itemIcons, pieceByNameGender, pieceByTypeGuid, outfitItemById };
}

/** Fetch + validate the visual assets from the served gamedata/atlas directory. */
export async function loadVisualAssets(
  baseUrl = assetUrl('gamedata/atlas'),
): Promise<VisualAssets> {
  const files = {
    meshes: 'meshes.json',
    spriteIndex: 'sprite-index.json',
    itemIcons: 'item-icons.json',
  };
  const [meshes, spriteIndex, itemIcons] = await Promise.all(
    Object.values(files).map(async (name) => {
      const res = await fetch(`${baseUrl}/${name}`);
      if (!res.ok) throw new Error(`Failed to load ${name} (HTTP ${res.status})`);
      return res.json() as Promise<unknown>;
    }),
  );
  return parseVisualAssets({ meshes, spriteIndex, itemIcons });
}

// --- Piece lookups --------------------------------------------------------------

/**
 * A piece by type + name for a dweller gender. Tries the exact gender first, then
 * the gender-neutral ('any') entry - dwellers reference pieces by NAME and the same
 * name often exists once per gender.
 */
export function pieceByName(
  assets: VisualAssets,
  type: string,
  name: string,
  gender: PieceGender,
): PieceRef | null {
  return (
    assets.pieceByNameGender.get(`${type}|${name}|${gender}`) ??
    assets.pieceByNameGender.get(`${type}|${name}|any`) ??
    null
  );
}

/** A piece by type + m_guid (used for outfit→helmet/coloringMask/glovePose refs). */
export function pieceByGuid(assets: VisualAssets, type: string, guid: string): PieceRef | null {
  return assets.pieceByTypeGuid.get(`${type}|${guid}`) ?? null;
}

/** The visual outfit piece for an equippable outfit id + gender, or null. */
export function outfitPieceFor(
  assets: VisualAssets,
  outfitId: string,
  gender: 'male' | 'female',
): PieceRef | null {
  const item = assets.outfitItemById.get(outfitId);
  if (!item) return null;
  const pieceName = gender === 'male' ? item.pieceMale : item.pieceFemale;
  return pieceName ? pieceByName(assets, 'outfit', pieceName, gender) : null;
}

/** Whether an equippable outfit id exists in the index. */
export const isKnownOutfitItem = (assets: VisualAssets, id: string): boolean =>
  assets.outfitItemById.has(id);

// --- Item icons -----------------------------------------------------------------

/** The icon rect for an item id of the given type, or null when none was matched. */
export function iconFor(assets: VisualAssets, type: ItemIconType, id: string): ItemIcon | null {
  return assets.itemIcons.icons[type][id] ?? null;
}

/** Atlas pixel dimensions for an icon's atlas (for CSS background-size). */
export function iconAtlasSize(
  assets: VisualAssets,
  icon: ItemIcon,
): { w: number; h: number } | null {
  return assets.itemIcons.atlases[icon.atlas] ?? null;
}
