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
    'Pregnancy flags for female dwellers. "Pregnant" starts the timer; "Baby ready" means the child is due. Ticking "Baby ready" also completes the due timer (the pair the game writes together); unticking it restores the timer to what the imported save recorded. Charisma (Radio room) speeds pregnancies.',
  hair: 'Hairstyle / facial-hair piece. Cosmetic only; pieces are filtered to the dweller’s gender like the in-game barbershop.',
  removeDweller:
    'Removes the dweller and cleans up every trace, the way the game itself does: they leave room work rosters, their training slot is emptied (its timer deleted), they exit exploration teams (a team left empty disbands), and pregnancy/family records are patched so nothing breaks at the next birth. Names stay on the family tree. Their equipped weapon, outfit and pet are deleted with them - unequip to storage first to keep the items. Undo restores everything while the editor is open.',

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
    'Clears a room’s accumulated incident damage (the scorch left by fires, radroaches, raiders, and other incidents) back to zero. Rooms only take this damage while an incident is actively burning and normally heal it on their own once the incident is cleared, so leftover damage in a saved game is cosmetic and does not stop production. Useful mainly for a save captured mid-incident, or a room whose scorch got stuck.',
  roomMerge:
    'Merging joins two identical adjacent rooms of the same level into a wider one with more capacity and output. Only valid merges are allowed.',
  roomDecoration:
    'An optional decoration object placed in the room (cosmetic / small happiness effect depending on theme).',

  // --- Timers ------------------------------------------------------------------------
  // Shared semantics: task timers are stored as elapsed-play-time deadlines; the game
  // "catches up" on load, so edits apply the next time the save is loaded in game.
  vaultTime:
    'Fast-forwards every timer in the vault at once by backdating the save timestamp. On the next load the game believes you were away that long and advances production, crafting, training, pregnancies, exploration and cooldowns together. Takes effect the next time the save is loaded in the game. Independent of the Season clock: vault time is stored in this save, season timing in the season file.',
  deathclawToggle:
    'Whether deathclaw attacks can trigger (they roll when the vault door opens or the radio pulls dwellers, once your vault passes 60 dwellers). Off stores a far-future blocker in the save’s timer list - without it the game would re-enable attacks after about 30 minutes. Toggle back on to remove the blocker completely.',
  bottleAndCappy:
    'Bottle & Cappy are the mascot pair that wander in for a dance visit after you complete their unlock quest; tapping them pays caps or Quantum, and while they are inside they block other incidents. Off prevents visits entirely (fully reversible); On only re-allows them, it does not summon the pair.',
  dailyRewards:
    'The daily reward timer (in season vaults: one Spin-to-Win poker chip per day) resets at midnight on a real-world clock. "Make claimable now" marks it elapsed so the reward lands as soon as the save is loaded in the game. When no timer is recorded there is nothing to do - the game creates it already claimable on load.',
  pregnancyTimer:
    'Time until the baby is due. "Deliver now" completes the due timer and ticks "Baby ready" - the same pair the game sets when a pregnancy finishes naturally. The birth still needs free vault space, exactly like in game, and takes effect the next time the save is loaded.',
  childGrowUp:
    'Time until this child grows into an adult dweller. "Grow up now" completes the timer on the next load in game.',
  exploringTimer:
    'Wasteland trips track elapsed travel time in the save. Adding hours to an exploring dweller advances loot finds and quest arrival; a returning dweller can be brought home instantly. Applies the next time the save is loaded in the game.',
  roomTimers:
    'Timers running in this room. Completing one makes it finish during the next load in game. Repeating timers (production, training) complete one cycle and then continue at their normal pace.',
  craftingTimer:
    'The item being crafted. "Finish now" marks the work complete so the item is ready to collect the next time the save is loaded in the game.',
  trainingTimer:
    'Each training slot levels one SPECIAL point per cycle. "Finish now" completes the current cycle for that dweller on the next load; training then continues at its normal pace.',
  rushTimer:
    'Each rush raises the next rush’s incident risk for a while; this timer is that penalty cooling back down. "Reset now" clears the escalated risk on the next load in game.',
  seasonClock:
    'The game’s own season debug clock (stored in the season file). Advancing it shifts ALL season timing forward - weekly challenge unlocks, event windows, and the season end - without touching your vault. Fully reversible with "Reset to real time". Independent of the Vault time card: this never advances vault production, crafting or other .sav timers.',

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
