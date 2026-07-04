import type { Dweller, Item, SaveData } from '../model/saveSchema.ts';
import type { GameData } from '../gamedata/gameData.ts';

// Pet-instance projection selectors. A pet is a save INSTANCE
// (breed + locked bonus + rolled value + unique name) that lives in one of two
// places - equipped on a dweller (`dweller.equippedPet`) or loose in storage
// (`vault.inventory.items[i]` with type "Pet"). Unlike dwellers, pets have NO
// intrinsic stable id, so each instance is addressed by a discriminated LOCATION:
// equipped → its owner's serializeId, stored → its inventory array index. The Pets
// section (master-detail, like Dwellers) lists every instance from both places and
// edits them through that locator (see petOps). Pure derivations - memoization
// happens at the component layer, mirroring dwellerSelectors.

/** Addresses a single pet instance wherever it lives. */
export type PetLocation =
  | { kind: 'equipped'; dwellerId: number }
  | { kind: 'stored'; index: number };

/** A pet instance flattened for the roster table. */
export interface PetRow {
  /** Stable-within-a-render row id: `e:<dwellerId>` (equipped) or `s:<index>` (stored). */
  rowId: string;
  location: PetLocation;
  /** Pet catalog id (`<breed>_<rarity>`). */
  id: string;
  uniqueName: string;
  /** Catalog breed display name, or the raw id when game data is absent. */
  breed: string;
  /** Pet type (Dog/Cat/Macaw/FloatingDrone/…), or '–' when unknown. */
  type: string;
  rarity: string;
  /** Locked EBonusEffect name. */
  bonus: string;
  bonusValue: number;
  /** Legal maximum rolled value for this breed/rarity, or null without game data. */
  bonusMax: number | null;
  /** Owner's display name, or "Storage" for an unequipped instance. */
  assignedTo: string;
}

/** localStorage / display label for an unequipped instance. */
const STORAGE_LABEL = 'Storage';

function dwellerList(save: SaveData): Dweller[] {
  const list = save.dwellers?.dwellers;
  return Array.isArray(list) ? list : [];
}

function inventoryItems(save: SaveData): Item[] {
  const items = save.vault?.inventory?.items;
  return Array.isArray(items) ? items : [];
}

/** A dweller's display name (trimmed "name lastName"), falling back to its id. */
function dwellerName(dweller: Dweller): string {
  const name = `${dweller.name ?? ''} ${dweller.lastName ?? ''}`.trim();
  return name || `Dweller ${dweller.serializeId}`;
}

/** Enrich a pet item into a row's catalog fields, degrading to raw id without game data. */
function projectPet(
  item: Item,
  location: PetLocation,
  rowId: string,
  assignedTo: string,
  gameData: GameData | undefined,
): PetRow {
  const catalog = gameData?.petById.get(item.id);
  const extra = item.extraData ?? {};
  return {
    rowId,
    location,
    id: item.id,
    uniqueName: extra.uniqueName ?? '',
    breed: catalog?.name ?? item.id,
    type: catalog?.type ?? '–',
    rarity: catalog?.rarity ?? '–',
    bonus: extra.bonus ?? catalog?.bonus ?? '–',
    bonusValue: extra.bonusValue ?? 0,
    bonusMax: catalog?.bonusMax ?? null,
    assignedTo,
  };
}

/**
 * Project every owned pet instance - equipped (each dweller's `equippedPet`) then
 * stored (`vault.inventory.items` of type "Pet") - into table rows, name-sorted by
 * unique name (falling back to breed). Enriches from game data when supplied.
 */
export function selectPetRows(save: SaveData, gameData?: GameData): PetRow[] {
  const rows: PetRow[] = [];

  for (const dweller of dwellerList(save)) {
    const pet = dweller.equippedPet;
    if (!pet || pet.type !== 'Pet') continue;
    rows.push(
      projectPet(
        pet,
        { kind: 'equipped', dwellerId: dweller.serializeId },
        `e:${dweller.serializeId}`,
        dwellerName(dweller),
        gameData,
      ),
    );
  }

  inventoryItems(save).forEach((item, index) => {
    if (item.type !== 'Pet') return;
    rows.push(projectPet(item, { kind: 'stored', index }, `s:${index}`, STORAGE_LABEL, gameData));
  });

  return rows.sort((a, b) => (a.uniqueName || a.breed).localeCompare(b.uniqueName || b.breed));
}

/** The live pet instance at a location, with its owner's name when equipped, or null. */
export function selectPetByLocation(
  save: SaveData,
  location: PetLocation,
): { item: Item; ownerName?: string } | null {
  if (location.kind === 'equipped') {
    const dweller = dwellerList(save).find((d) => d.serializeId === location.dwellerId);
    const pet = dweller?.equippedPet;
    if (!dweller || !pet || pet.type !== 'Pet') return null;
    return { item: pet, ownerName: dwellerName(dweller) };
  }
  const item = inventoryItems(save)[location.index];
  if (!item || item.type !== 'Pet') return null;
  return { item };
}
