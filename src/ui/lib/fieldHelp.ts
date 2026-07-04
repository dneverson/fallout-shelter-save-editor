// Central "what this does in-game" copy catalog. Plain-language
// explanations of each editable field's gameplay effect, surfaced via <InfoTooltip>
// across the editor. Keep entries short (they render in a small bubble) and accurate
// to Fallout Shelter mechanics.

export const fieldHelp = {
  // --- Dweller: SPECIAL (each letter drives different rooms) ----------------------
  special:
    'SPECIAL drives how well a dweller works each room type: S Power, P Water, A Food (Diner/Garden), I MedBay & Science Lab, E Nuka-Cola & radiation resist, C Radio (attracts dwellers) & faster relationships, L rush success and bonus loot. Higher = more output.',
  level:
    'The dweller level (1–50). Higher levels grant more max health. Setting it here writes the level and resets XP; the game never lowers a level on load.',
  rarity:
    'Cosmetic tier (Normal / Rare / Legendary) shown on the card. It does not change stats - those come from SPECIAL and equipment.',
  happiness:
    "A dweller's mood (0–100%). The vault-wide average gives a production bonus (up to +10%) and feeds your vault rating. Working the right room, partners, and being fed/hydrated raise it.",
  health:
    'Current hit points. Reaches 0 → the dweller is incapacitated (revive in the roster). Radiation lowers the max until cured with RadAway.',
  maxHealth: 'Maximum hit points. The game recomputes this from level + Endurance on load.',
  radiation:
    'Radiation damage (0 = clean). It eats into max health until removed with RadAway. Endurance reduces how fast it builds in the wasteland.',
  colors:
    'Raw ARGB colors the game renders as a tint. The barbershop only offers presets, but the save accepts any color - pick from swatches or enter a custom value.',
  pregnancy:
    'Pregnancy flags for female dwellers. "Pregnant" starts the timer; "Baby ready" means the child is due. Charisma (Radio room) speeds pregnancies.',
  hair: 'Hairstyle / facial-hair piece. Cosmetic only; pieces are filtered to the dweller’s gender like the in-game barbershop.',

  // --- Equipment -------------------------------------------------------------------
  weapon:
    'The equipped weapon. Damage range matters for wasteland survival and fighting incidents. A wrong id makes the game swap to a default weapon, so only real ids are written.',
  outfit:
    'The equipped outfit. Outfits grant SPECIAL bonuses that add to the dweller’s base stats, improving room output and wasteland survival.',
  pet: 'Pets give a bonus locked to their breed (e.g. extra damage, XP, or caps). Only the rolled value and name are editable; the bonus type is fixed.',

  // --- Vault settings --------------------------------------------------------------
  resources:
    'Stored resources. Caps (Nuka) buy and upgrade rooms; Food/Water/Energy keep the vault running; StimPak/RadAway heal. Values can be set up to each resource’s capacity.',
  maxResources:
    'Fills every resource up to its legal capacity (base + each storage room’s contribution). It never lowers a value that is already higher.',
  consumables:
    'Counts of Lunchboxes, Mr. Handies, Pet Carriers, and Starter Packs. Lunchbox contents are rolled when opened, so grant items directly in Storage instead.',
  vaultName: 'The 3-digit vault number shown in-game (000–999).',
  vaultMode:
    'Normal or Survival. Survival raises consumption and incident difficulty; switching does not retroactively change existing rooms.',
  vaultTheme: 'The decorative theme applied to rooms (Normal / holiday themes).',
  mysteriousStranger:
    'The Mysterious Stranger spawns randomly and gives caps when tapped. This toggles whether he can appear and his current state.',
  starterPack:
    'Two separate controls. The offer toggle marks the one-time real-money Starter Pack as already bought, which only hides its store prompt - it adds nothing. “Unopened packs in vault” stocks that many unopened Starter Packs in your consumables; open them in-game to receive the contents (often a pet and multiple special dwellers).',

  // --- Rooms -----------------------------------------------------------------------
  roomLevel:
    'Room upgrade level (1–3). Higher levels increase output, storage, and dweller capacity, but also energy draw.',
  roomPower:
    'Whether the room is powered. Unpowered rooms stop producing. The game powers rooms down automatically when energy runs short.',
  roomRepair:
    'Clears accumulated damage (from incidents) back to full. A broken room produces nothing until repaired.',
  roomMerge:
    'Merging joins two identical adjacent rooms of the same level into a wider one with more capacity and output. Only valid merges are allowed.',
  roomDecoration:
    'An optional decoration object placed in the room (cosmetic / small happiness effect depending on theme).',

  // --- Storage ---------------------------------------------------------------------
  storageCapacity:
    'Stored items vs. storage capacity. Capacity = base 10 + each storage room’s contribution. The game counts every item (including pets); over capacity is allowed but warned.',

  // --- Advisor ---------------------------------------------------------------------
  advisorProduction:
    'Resources produced per real-time minute at the current staffing, assuming you collect the rooms. Higher SPECIAL, levels, and happiness raise it.',
  advisorConsumption:
    'Resources consumed per minute: Food/Water scale with the number of living dwellers; Energy is the combined draw of all powered rooms.',
  advisorNet:
    'Production minus consumption. Negative means the resource drains over time - staff or build more of that room type.',
  advisorStatus:
    'Sustainability at a glance: green = comfortable surplus, amber = thin margin, red = deficit (running out).',
} as const;

export type FieldHelpKey = keyof typeof fieldHelp;
