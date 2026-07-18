// Orchestrator: regenerate all committed public/gamedata/*.json from the local game
// export. Run offline with `pnpm gamedata:build`. Only the JSON outputs are
// committed; the game files (tools/export, scripts/extract) stay on the curation
// machine.
import { writeOutput, writeAtlasOutput } from './lib/io.mjs';
import { buildWeapons } from './build-weapons.mjs';
import { buildOutfits } from './build-outfits.mjs';
import { buildJunk } from './build-junk.mjs';
import { buildHair } from './build-hair.mjs';
import { buildPets } from './build-pets.mjs';
import { buildHandies } from './build-handies.mjs';
import { buildEnums } from './build-enums.mjs';
import { buildUnlockables } from './build-unlockables.mjs';
import { buildRoomCapacity } from './build-room-capacity.mjs';
import { buildRoomMetadata } from './build-room-metadata.mjs';
import { buildRoomProduction } from './build-room-production.mjs';
import { buildUniqueDwellers } from './build-unique-dwellers.mjs';
import { buildSeasonPass } from './build-season-pass.mjs';
import { buildQuests } from './build-quests.mjs';
import { buildObjectives } from './build-objectives.mjs';
import { buildDwellerMesh } from './build-dweller-mesh.mjs';
import { buildSpriteIndex } from './build-sprite-index.mjs';
import { buildItemIcons } from './build-item-icons.mjs';

console.log('Building game data → public/gamedata/');

const weapons = buildWeapons();
const outfits = buildOutfits();
const junk = buildJunk();
const hair = buildHair();
const pets = buildPets();
const handies = buildHandies();
const enums = buildEnums();
const unlockables = buildUnlockables();
const roomCapacity = buildRoomCapacity();
const roomMetadata = buildRoomMetadata();
const roomProduction = buildRoomProduction();
const uniqueDwellers = buildUniqueDwellers();
const seasonPass = buildSeasonPass();
const quests = buildQuests();
const objectives = buildObjectives();

writeOutput('weapons.json', weapons);
writeOutput('outfits.json', outfits);
writeOutput('junk.json', junk);
writeOutput('hair.json', hair);
writeOutput('pets.json', pets);
writeOutput('handies.json', handies);
writeOutput('enums.json', enums);
writeOutput('unlockables.json', unlockables);
writeOutput('room-capacity.json', roomCapacity);
writeOutput('room-metadata.json', roomMetadata);
writeOutput('room-production.json', roomProduction);
writeOutput('unique-dwellers.json', uniqueDwellers);
writeOutput('season-pass.json', seasonPass);
// Minified: the full quest catalog is multi-MB; 2-space indent would nearly double it.
writeOutput('quests.json', quests, { pretty: false });
writeOutput('objectives.json', objectives);

// Visual assets → public/gamedata/atlas/ (meshes, sprite index, item icons + PNGs).
console.log('Building visual assets → public/gamedata/atlas/');
const meshes = buildDwellerMesh();
const { index: spriteIndex, stats: spriteStats } = buildSpriteIndex();
const { iconData, stats: iconStats } = buildItemIcons({
  weapons,
  outfits,
  junk,
  pets,
  handies,
  seasonPass,
});
writeAtlasOutput('meshes.json', meshes);
writeAtlasOutput('sprite-index.json', spriteIndex);
writeAtlasOutput('item-icons.json', iconData);
console.log(
  `  sprite index: ${JSON.stringify(spriteStats.counts)} · ${spriteStats.atlases} atlases`,
);
console.log(`  item icons: ${JSON.stringify(iconStats)}`);

writeOutput('meta.json', {
  gameVersion: '2.5.0',
  unityVersion: '6000.0.58f2',
  generatedAt: new Date().toISOString(),
  counts: {
    weapons: weapons.length,
    outfits: outfits.length,
    junk: junk.length,
    hair: hair.length,
    pets: pets.length,
    handies: handies.length,
    enums: Object.keys(enums).length,
    recipes: unlockables.recipes.length,
    roomUnlocks: unlockables.roomUnlocks.length,
    roomCapacityTypes: Object.keys(roomCapacity.rooms).length,
    roomMetadataTypes: Object.keys(roomMetadata.rooms).length,
    roomProductionTypes: Object.keys(roomProduction.rooms).length,
    uniqueDwellers: Object.keys(uniqueDwellers).length,
    seasons: seasonPass.seasons.length,
    quests: quests.quests.length,
    questlines: quests.questlines.length,
    objectives: objectives.objectives.length,
    spriteAtlases: spriteStats.atlases,
  },
});

console.log('Done.');
