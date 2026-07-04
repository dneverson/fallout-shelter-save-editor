// item-icons.json - per-item icon rects for the Weapons / Outfits / Junk / Pets
// tables, equip pickers, and dweller cells. Each item's `sprite` name is resolved
// to its pixel rect in the matching NGUI UI atlas; only referenced atlas PNGs are
// copied into public/gamedata/atlas/. Icons are CSS-cropped at runtime (no PixiJS
// needed for flat 2D item icons - that's only for the layered dweller body).
//
// Sources (our v2.4.1 export): Resources/atlas/*_HD.prefab (NGUI UIAtlas sprite
// rects) + the companion *_HD.png textures. Pet portraits are split across the
// five per-type pet atlases, so pets resolve against all of them.
import { join } from 'node:path';
import { PATHS, readSource, readSourceBuffer, copyAtlasPng } from './lib/io.mjs';
import { parseNguiAtlas, pngSize } from './lib/unityYaml.mjs';

// item type → candidate NGUI atlases (resolved in order) + which item fields name
// the sprite (first present wins; e.g. pets prefer the tight head portrait).
const TYPES = {
  weapons: { atlases: ['Weapons_HD'], spriteKeys: ['sprite'] },
  outfits: { atlases: ['Outfits_HD'], spriteKeys: ['sprite'] },
  junk: { atlases: ['Junks_HD'], spriteKeys: ['sprite'] },
  pets: {
    atlases: [
      'Pet_Cats_HD',
      'Pet_Dogs_HD',
      'Pet_Macaws_HD',
      'Pet_FloatingDrone_HD',
      'Pet_Rollerbrain_HD',
    ],
    spriteKeys: ['headSprite', 'sprite'],
  },
  // Full-body pet sprites for the dweller preview overlay (tables use the tight head
  // portrait above); same atlases, but the FullBody sprite wins. Sourced from `pets`.
  petBodies: {
    atlases: [
      'Pet_Cats_HD',
      'Pet_Dogs_HD',
      'Pet_Macaws_HD',
      'Pet_FloatingDrone_HD',
      'Pet_Rollerbrain_HD',
    ],
    spriteKeys: ['sprite', 'headSprite'],
    source: 'pets',
  },
  // Vault-helper robots (handies.json). Their UI art lives in the general-purpose
  // NGUI atlases: VaultTec_HD has Mr. Handy / Snip Snip / Curie, Menu_HD has the
  // Victor card (SeasonsModal_HD also has one but is a 13 MB sheet - skipped).
  handies: { atlases: ['VaultTec_HD', 'Menu_HD'], spriteKeys: ['sprite'] },
  // Season Pass reward art (the `BP_*` cards the game shows on the pass board): caps,
  // stimpaks, lunchbox variants, the unique-dweller cards, per-theme art. Keyed by the
  // sprite name each reward carries in its `icon` field (season-pass.json / spd.dat).
  // SeasonsModal_HD is a 13 MB sheet, but icon atlases are fetched lazily - the browser
  // only downloads it when the Season tab first renders a reward icon.
  season: { atlases: ['SeasonsModal_HD'], spriteKeys: ['sprite'] },
};

/**
 * Theme rewards all carry the generic `BP_Theme` icon in the game data, but the modal
 * sheet ships dedicated art per theme. Map each theme reward's `dataValString` to its
 * sprite so the board/detail can show the real room/exterior art (emitted under a
 * `theme:<dataValString>` key, with BP_Theme kept as the runtime fallback).
 */
const THEME_SPRITES = {
  NewVegasExterior: 'BP_NewVegasA_VaultExterior',
  SunsetSarsaparilla: 'BP_SarsaparillaTheme',
  NewVegasNightExterior: 'BP_NewVegasNight',
  LivingQuartersLucky38Penthouse: 'BP_Lucky38PenthouseLivingQuarters',
  ExteriorUltracite: 'BP_UltraciteVaultExterior',
  WeaponFactory_Ultracite: 'BP_UltraciteWeaponsWorkshop',
  EnclaveExterior: 'BP_EnclaveExterior',
  CafeteriaEnclave: 'BP_EnclaveCafeteria',
  LivingQuartersEnclave: 'BP_EnclaveLivingQuarters',
  CafeteriaInstitute: 'BP_InstituteCafeteria',
  LivingQuartersInstitute: 'BP_InstituteLivingQuarters',
  ConcordExterior: 'BP_ConcordExterior',
};

/**
 * Flatten the season-pass catalog into icon "items" for the generic resolver loop:
 * one entry per distinct reward `icon` sprite (keyed by the sprite name itself) plus
 * one `theme:<id>` entry per theme reward (specific art via THEME_SPRITES).
 */
function seasonIconItems(seasonPass) {
  const items = new Map();
  for (const season of seasonPass?.seasons ?? []) {
    for (const reward of [...season.freeRewards, ...season.premiumRewards]) {
      if (reward.icon && !reward.icon.startsWith('[')) {
        items.set(reward.icon, { id: reward.icon, sprite: reward.icon });
      }
      if (reward.rewardType === 'theme' && reward.dataValString) {
        const key = `theme:${reward.dataValString}`;
        const sprite = THEME_SPRITES[reward.dataValString] ?? reward.icon;
        if (sprite) items.set(key, { id: key, sprite });
      }
    }
  }
  return [...items.values()];
}

/** Normalize a sprite name for tolerant matching against atlas sprite names. */
function normalize(name) {
  return name.toLowerCase().replace(/[\s._-]/g, '');
}

export function buildItemIcons({ weapons, outfits, junk, pets, handies, seasonPass }) {
  const itemsByType = {
    weapons,
    outfits,
    junk,
    pets,
    handies,
    season: seasonIconItems(seasonPass),
  };
  const out = { version: 1, atlases: {}, icons: {} };
  const stats = {};

  for (const [type, { atlases, spriteKeys, source }] of Object.entries(TYPES)) {
    const items = itemsByType[source ?? type];
    // Build a combined sprite-name → { png, rect } index across this type's atlases,
    // loading each atlas's rects + size lazily (PNG copied only when referenced).
    const exact = new Map(); // name → { atlas, rect }
    const norm = new Map(); // normalize(name) → { atlas, rect }
    const atlasMeta = {}; // atlas basename → { png, size }
    for (const atlas of atlases) {
      const rects = parseNguiAtlas(readSource(join(PATHS.uiAtlasDir, `${atlas}.prefab`)));
      const size = pngSize(readSourceBuffer(join(PATHS.uiAtlasDir, `${atlas}.png`)));
      atlasMeta[atlas] = { size, png: null };
      for (const [name, rect] of rects) {
        if (!exact.has(name)) exact.set(name, { atlas, rect });
        const n = normalize(name);
        if (!norm.has(n)) norm.set(n, { atlas, rect });
      }
    }

    const resolve = (name) => {
      if (!name) return null;
      return exact.get(name) ?? norm.get(normalize(name)) ?? null;
    };

    const icons = {};
    let matched = 0;
    for (const item of items) {
      let hit = null;
      for (const key of spriteKeys) {
        hit = resolve(item[key]);
        if (hit) break;
      }
      if (!hit) continue;
      // Copy the atlas PNG on first reference and record its size.
      const meta = atlasMeta[hit.atlas];
      if (!meta.png) {
        meta.png = copyAtlasPng(join(PATHS.uiAtlasDir, `${hit.atlas}.png`));
        out.atlases[meta.png] = meta.size;
      }
      icons[item.id] = {
        atlas: meta.png,
        x: hit.rect.x,
        y: hit.rect.y,
        w: hit.rect.w,
        h: hit.rect.h,
      };
      matched++;
    }
    out.icons[type] = icons;
    stats[type] = `${matched}/${items.length}`;
  }

  return { iconData: out, stats };
}
