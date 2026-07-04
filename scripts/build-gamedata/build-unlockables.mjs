// unlockables.json - the catalogs the "unlock all" quick actions write
//:
//   recipes:     every craftable item id  → survivalW.recipes = [...]
//   roomUnlocks: every room-unlock id     → unlockableMgr.claimed = [...]
//
// Both are EXTRACTED from our own v2.4.1 export, not a hardcoded list - a stale
// id makes the game silently drop/swap it. The recipe set is validated as a
// complete superset of a fully-progressed vault's survivalW.recipes (178 distinct).
//
// A recipe is any weapon/outfit the game flags craftable - `m_canBeRecipe: 1` OR
// `m_recipeData.m_isInitiallyAvailable: 1` (the latter catches special-factory
// recipes like the Ultracite weapons, which carry `m_canBeRecipe: 0`) - plus every
// `m_themeId` (room theme/decoration recipes such as CafeteriaAnniversary). The
// untrimmed id sets are also dumped to scripts/extract/ for future reuse.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PATHS, readSource, writeOutput } from './lib/io.mjs';

/** Craftable weapon/outfit recipe ids from GameParameters item definitions. */
function parseRecipeIds(gameParams) {
  const recipes = new Set();
  // Each weapon/outfit (and card) definition is a `- name:` list element. Splitting
  // on it keeps an item's id and its recipe flags together regardless of field order
  // (weapons list id-before-flags, outfits list flags-before-id).
  for (const block of gameParams.split(/\n(?=\s*- name:)/)) {
    const idMatch = block.match(/^\s*(?:m_WeaponId|m_outfitId):\s*(.+?)\s*$/m);
    if (!idMatch) continue;
    const craftable =
      /^\s*m_canBeRecipe:\s*1\s*$/m.test(block) ||
      /^\s*m_isInitiallyAvailable:\s*1\s*$/m.test(block);
    if (craftable) recipes.add(idMatch[1]);
  }
  // Room theme/decoration recipes (id = m_themeId, e.g. CafeteriaAnniversary).
  // Rooms with no theme carry `m_themeId: None` (ESpecialTheme.None) - that's the
  // "no theme" placeholder, not a craftable recipe, so it's excluded.
  const themes = new Set();
  for (const m of gameParams.matchAll(/^\s*m_themeId:\s*(.+?)\s*$/gm)) {
    if (m[1] !== 'None') themes.add(m[1]);
  }
  return { recipes, themes };
}

/** Room-unlock objective ids (e.g. StorageUnlock) from the Unlockable MGR prefab. */
function parseRoomUnlocks(unlockableMgr) {
  const ids = new Set();
  for (const m of unlockableMgr.matchAll(/\b([A-Za-z0-9]+Unlock)\b/g)) ids.add(m[1]);
  return ids;
}

export function buildUnlockables() {
  const gameParams = readSource(PATHS.gameParams);
  const { recipes, themes } = parseRecipeIds(gameParams);
  const roomUnlocks = parseRoomUnlocks(readSource(PATHS.unlockableMgr));

  const recipeList = [...new Set([...recipes, ...themes])].sort((a, b) => a.localeCompare(b));
  const roomUnlockList = [...roomUnlocks].sort((a, b) => a.localeCompare(b));

  // Untrimmed capture for future phases (written to scripts/extract/, gitignored).
  writeFileSync(
    join(PATHS.rawDir, 'raw_unlockables.json'),
    JSON.stringify(
      {
        recipesFromFlags: [...recipes].sort(),
        themeRecipes: [...themes].sort(),
        roomUnlocks: roomUnlockList,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  return { recipes: recipeList, roomUnlocks: roomUnlockList };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOutput('unlockables.json', buildUnlockables());
}
