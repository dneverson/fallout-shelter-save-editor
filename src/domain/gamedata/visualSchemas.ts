import { z } from 'zod';

// Zod schemas for the committed visual assets in public/gamedata/atlas/ (generated
// offline by scripts/build-gamedata: build-dweller-mesh, build-sprite-index,
// build-item-icons). These validate the shipped artifacts on load and are the
// single source of truth for the renderer's data types.

const vec2 = z.tuple([z.number(), z.number()]);

// --- meshes.json: per-gender posed dweller body geometry ------------------------

// Skinned body mesh: carries per-vertex bone indices + UV1 + the baked idle pose.
const meshGeometrySchema = z.object({
  positions: z.array(vec2),
  uvs: z.array(vec2),
  uvs1: z.array(vec2),
  indices: z.array(z.number()),
  boneIndices: z.array(z.number()),
  /** Baked idle-pose positions; falls back to `positions` when absent. */
  posedPositions: z.array(vec2).optional(),
});

// Unskinned overlay mesh (largeHeadgear hat) drawn via meshOverride - no bones/UV1.
const overrideMeshSchema = z.object({
  positions: z.array(vec2),
  uvs: z.array(vec2),
  indices: z.array(z.number()),
  /** Per-submesh index counts (hat quad is the last submesh). */
  indexCounts: z.array(z.number()).optional(),
});

const genderMeshSchema = z.object({
  offsets: z.object({ hand: vec2, face: vec2 }),
  adult: meshGeometrySchema,
  child: meshGeometrySchema,
});

export const dwellerMeshSetSchema = z.object({
  version: z.literal(1),
  atlasSize: z.number(),
  male: genderMeshSchema,
  female: genderMeshSchema,
});

// --- sprite-index.json: dweller customization pieces ----------------------------

const atlasRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const genderSchema = z.enum(['male', 'female', 'any']);

const pieceFlagsSchema = z.object({
  isBald: z.boolean().optional(),
  type: z.number().optional(),
  hasSkirt: z.boolean().optional(),
  isExclusive: z.boolean().optional(),
  outfitCategory: z.number().optional(),
});

const pieceRefSchema = z.object({
  guid: z.string(),
  name: z.string(),
  atlas: z.string(),
  bounds: atlasRectSchema,
  gender: genderSchema,
  flags: pieceFlagsSchema,
  colors: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).optional(),
  helmetGuid: z.string().optional(),
  largeHeadgearGuid: z.string().optional(),
  coloringMaskGuid: z.string().optional(),
  glovePoseGuids: z.array(z.string()).optional(),
  maskGuid: z.string().optional(),
});

const specialBonusSchema = z.object({
  S: z.number().optional(),
  P: z.number().optional(),
  E: z.number().optional(),
  C: z.number().optional(),
  I: z.number().optional(),
  A: z.number().optional(),
  L: z.number().optional(),
});

const outfitItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.number(),
  special: specialBonusSchema.optional(),
  pieceMale: z.string().nullable(),
  pieceFemale: z.string().nullable(),
  hasHelmet: z.boolean().optional(),
});

const largeHeadgearMeshSchema = z.object({
  male: overrideMeshSchema.nullable(),
  female: overrideMeshSchema.nullable(),
});

export const spriteIndexSchema = z.object({
  version: z.literal(1),
  byType: z.record(z.string(), z.array(pieceRefSchema)),
  outfitItems: z.array(outfitItemSchema),
  largeHeadgearMeshes: z.record(z.string(), largeHeadgearMeshSchema),
});

// --- item-icons.json: flat 2D icon rects for tables/pickers ---------------------

const itemIconSchema = z.object({
  atlas: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const itemIconsSchema = z.object({
  version: z.literal(1),
  atlases: z.record(z.string(), z.object({ w: z.number(), h: z.number() })),
  icons: z.object({
    weapons: z.record(z.string(), itemIconSchema),
    outfits: z.record(z.string(), itemIconSchema),
    junk: z.record(z.string(), itemIconSchema),
    pets: z.record(z.string(), itemIconSchema),
    /** Full-body pet sprites for the preview overlay (tables use `pets` head portraits). */
    petBodies: z.record(z.string(), itemIconSchema),
    /** Vault-helper robot art (handies.json ids), from the NGUI UI atlases. */
    handies: z.record(z.string(), itemIconSchema),
    /** Season Pass reward art (SeasonsModal_HD `BP_*` cards), keyed by the sprite name a
     *  reward carries in its `icon` field, plus `theme:<dataValString>` per-theme art. */
    season: z.record(z.string(), itemIconSchema),
  }),
});

export type MeshGeometry = z.infer<typeof meshGeometrySchema>;
export type OverrideMesh = z.infer<typeof overrideMeshSchema>;
export type DwellerMeshSet = z.infer<typeof dwellerMeshSetSchema>;
export type AtlasRect = z.infer<typeof atlasRectSchema>;
export type PieceGender = z.infer<typeof genderSchema>;
export type PieceRef = z.infer<typeof pieceRefSchema>;
export type OutfitItem = z.infer<typeof outfitItemSchema>;
export type SpriteIndex = z.infer<typeof spriteIndexSchema>;
export type ItemIcon = z.infer<typeof itemIconSchema>;
export type ItemIcons = z.infer<typeof itemIconsSchema>;
export type ItemIconType = keyof ItemIcons['icons'];
