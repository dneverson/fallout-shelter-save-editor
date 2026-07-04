// handies.json - the vault-helper robot catalog (Mr. Handy and its variants).
//
// Source of truth: the UniqueMrHandyData ScriptableObjects (l_mrhandy, L_SnipSnip,
// Victor, Curie) hold the display name, lunchbox card odds, Mr. Handy box odds and
// starter-pack flag. The save-file encoding per variant is fixed by game code:
// VaultHelper.Serialize writes MrHandyVariantID = VaultHelperVariant (enum NAME),
// Actor.Serialize writes characterType = (short)ActorData.Type and actorDataId =
// ActorData.ID, and MrHandyData.MrHandyDataDictionary pins the ActorData per id
// (SnipSnip → MrHandy(2)/"SnipSnip", Victor → Victor(5)/"Victor", Curie →
// Curie(6)/"Curie"; the plain Mr. Handy has no ActorData entry: type 2, id null).
// Sprites come from the NGUI UI atlases (resolved by build-item-icons, type
// 'handies'); the CreatureImpostor piece art is deliberately NOT used.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, readSource } from './lib/io.mjs';
import { readGuid } from './lib/unityYaml.mjs';

// VaultHelperVariant enum value → everything the extractor cannot read from the
// UniqueMrHandyData asset itself (save encoding, UI sprite, provenance text).
const VARIANTS = {
  1: {
    id: 'mrhandy',
    variantId: 'MrHandy',
    characterType: 2,
    actorDataId: null,
    sprite: 'MrHandy',
    source: 'Lunchboxes, Mr. Handy boxes and the starter pack',
  },
  2: {
    id: 'snipsnip',
    variantId: 'SnipSnip',
    characterType: 2,
    actorDataId: 'SnipSnip',
    sprite: 'MrHandyQuestReward_SnipSnip',
    source: 'Rare lunchbox / Mr. Handy box drop and quest rewards',
  },
  3: {
    id: 'victor',
    variantId: 'Victor',
    characterType: 5,
    actorDataId: 'Victor',
    sprite: 'Icon_VictorCard',
    source: 'Season pass reward (securitron)',
  },
  4: {
    id: 'curie',
    variantId: 'Curie',
    characterType: 6,
    actorDataId: 'Curie',
    sprite: 'Curie',
    source: 'Season pass reward (Miss Nanny)',
  },
};

const num = (text, re) => {
  const m = text.match(re);
  return m ? Number(m[1]) : null;
};

export function buildHandies() {
  const scriptGuid = readGuid(
    readFileSync(join(PATHS.scriptsDir, 'UniqueMrHandyData.cs.meta'), 'utf8'),
  );

  // The four data assets are stable, but resolve them by script guid rather than
  // filename so a renamed/added asset in a future game version is caught loudly.
  const files = ['l_mrhandy.asset', 'L_SnipSnip.asset', 'Victor.asset', 'Curie.asset'];
  const handies = [];
  for (const file of files) {
    const text = readSource(join(PATHS.monoBehaviourDir, file));
    if (!text.includes(`guid: ${scriptGuid}`)) {
      throw new Error(`${file} is not a UniqueMrHandyData asset (script guid mismatch)`);
    }
    const variantCode = num(text, /^\s*m_vaultHelperVariant:\s*(\d+)/m);
    const variant = VARIANTS[variantCode];
    if (!variant) throw new Error(`${file}: unknown VaultHelperVariant ${variantCode}`);
    handies.push({
      ...variant,
      name: text.match(/^\s*m_name:\s*(.+?)\s*$/m)?.[1] ?? variant.variantId,
      starterPack: num(text, /^\s*m_isStarterPackMrHandy:\s*(\d)/m) === 1,
      mrHandyBoxOdds: num(text, /^\s*m_mrHandyBoxOdds:\s*([0-9.eE+-]+)/m) ?? 0,
      lotteryOdds: {
        normal: num(text, /m_normalLottery:\s*([0-9.eE+-]+)/) ?? 0,
        rare: num(text, /m_rareLottery:\s*([0-9.eE+-]+)/) ?? 0,
        legendary: num(text, /m_legendaryLottery:\s*([0-9.eE+-]+)/) ?? 0,
      },
    });
  }
  handies.sort((a, b) => a.characterType - b.characterType || a.id.localeCompare(b.id));
  return handies;
}
