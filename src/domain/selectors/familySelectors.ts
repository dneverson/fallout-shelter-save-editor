import type { Dweller, SaveData } from '../model/saveSchema.ts';
import type { UniqueDwellers } from '../gamedata/schemas.ts';

// Family / relationship viewer. PURE,
// read-only resolution of a dweller's partner, parents, grandparents, and children.
//
// Relationships are stored as AscendancyIDs, not serializeIds:
//   - a NORMAL dweller's AscendancyID == its serializeId,
//   - a UNIQUE dweller's AscendancyID == a per-character negative id (DwellerRelations.
//     AscendancyID → UniqueData.UniqueAscendancyId), which the save keeps only as the
//     `uniqueData` string ("L_Max") → resolved via the extracted unique-dwellers catalog.
// `relations.ascendants` = [parent0, parent1, grandparent0..3]; `relations.partner` is a
// serializeId. Children are the reverse: dwellers listing this dweller as a parent.

/** A resolved relative. `id` is the vault serializeId when present; else null. */
export interface FamilyMember {
  /** serializeId if this relative is a dweller currently in the vault, else null. */
  id: number | null;
  name: string;
  /** True when the relative is a dweller present in the vault (clickable). */
  inVault: boolean;
  /** True when the relative is a known unique/special character (may be absent). */
  special: boolean;
}

export interface Family {
  partner: FamilyMember | null;
  parents: FamilyMember[];
  grandparents: FamilyMember[];
  children: FamilyMember[];
}

const dwellersOf = (save: SaveData): Dweller[] => save.dwellers?.dwellers ?? [];

const displayName = (d: Dweller): string =>
  `${d.name ?? ''} ${d.lastName ?? ''}`.trim() || `#${d.serializeId}`;

/** A dweller's AscendancyID: its unique character id (if special) else its serializeId. */
export function ascendancyId(dweller: Dweller, unique: UniqueDwellers): number {
  const uid = dweller.uniqueData;
  if (uid) {
    const entry = unique[uid];
    if (entry && entry.ascendancyId !== -1) return entry.ascendancyId;
  }
  return dweller.serializeId;
}

/** Reverse catalog: AscendancyID → unique-character display name (for absent ascendants). */
function uniqueNameById(unique: UniqueDwellers): Map<number, string> {
  const map = new Map<number, string>();
  for (const entry of Object.values(unique)) {
    if (entry.ascendancyId === -1) continue;
    const name = `${entry.name} ${entry.lastName}`.trim();
    if (name && !map.has(entry.ascendancyId)) map.set(entry.ascendancyId, name);
  }
  return map;
}

/** Resolve one ascendant value (an AscendancyID) into a FamilyMember, or null for -1. */
function resolveAscendant(
  value: number,
  byAscendancy: Map<number, Dweller>,
  uniqueNames: Map<number, string>,
): FamilyMember | null {
  if (value === -1) return null;
  const dweller = byAscendancy.get(value);
  if (dweller) {
    return {
      id: dweller.serializeId,
      name: displayName(dweller),
      inVault: true,
      special: !!dweller.uniqueData,
    };
  }
  // Not in the vault: a special character (negative id) we can still name, or an unknown.
  const uniqueName = uniqueNames.get(value);
  if (uniqueName) return { id: null, name: uniqueName, inVault: false, special: true };
  return { id: null, name: 'Unknown', inVault: false, special: value < 0 };
}

/**
 * Resolve the family of the dweller with `serializeId`: partner, parents (ascendants
 * 0-1), grandparents (ascendants 2-5), and children (dwellers whose parents include this
 * dweller's AscendancyID). Returns null if the dweller isn't found.
 */
export function selectFamily(
  save: SaveData,
  serializeId: number,
  unique: UniqueDwellers,
): Family | null {
  const dwellers = dwellersOf(save);
  const self = dwellers.find((d) => d.serializeId === serializeId);
  if (!self) return null;

  const byAscendancy = new Map<number, Dweller>();
  for (const d of dwellers) byAscendancy.set(ascendancyId(d, unique), d);
  const uniqueNames = uniqueNameById(unique);

  const ascendants = self.relations?.ascendants ?? [];
  const parents = [ascendants[0], ascendants[1]]
    .map((v) => (typeof v === 'number' ? resolveAscendant(v, byAscendancy, uniqueNames) : null))
    .filter((m): m is FamilyMember => m !== null);
  const grandparents = [ascendants[2], ascendants[3], ascendants[4], ascendants[5]]
    .map((v) => (typeof v === 'number' ? resolveAscendant(v, byAscendancy, uniqueNames) : null))
    .filter((m): m is FamilyMember => m !== null);

  // Partner is a serializeId (not an AscendancyID).
  const partnerId = self.relations?.partner ?? -1;
  const partnerDweller =
    partnerId >= 0 ? dwellers.find((d) => d.serializeId === partnerId) : undefined;
  const partner: FamilyMember | null = partnerDweller
    ? {
        id: partnerDweller.serializeId,
        name: displayName(partnerDweller),
        inVault: true,
        special: !!partnerDweller.uniqueData,
      }
    : null;

  // Children: any vault dweller whose parent ascendants include this dweller's AscendancyID.
  const selfAscendancy = ascendancyId(self, unique);
  const children: FamilyMember[] = dwellers
    .filter((d) => {
      const a = d.relations?.ascendants ?? [];
      return a[0] === selfAscendancy || a[1] === selfAscendancy;
    })
    .map((d) => ({
      id: d.serializeId,
      name: displayName(d),
      inVault: true,
      special: !!d.uniqueData,
    }));

  return { partner, parents, grandparents, children };
}
