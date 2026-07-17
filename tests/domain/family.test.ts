// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import type { UniqueDwellers } from '../../src/domain/gamedata/schemas.ts';
import { ascendancyId, selectFamily } from '../../src/domain/selectors/familySelectors.ts';

const UNIQUE: UniqueDwellers = {
  L_Max: {
    ascendancyId: -48,
    name: 'Maximus',
    lastName: '',
    gender: 2,
    hair: '03',
    faceMask: null,
    outfitId: 'BOSCasual',
    weaponId: 'T60Pistol',
    skinColor: 4286339388,
    hairColor: 4280623644,
    stats: [7, 6, 6, 5, 4, 7, 5],
    rarity: 'Legendary',
    isHidden: false,
    isInfertile: false,
    randomBody: false,
    randomName: false,
  },
};

function d(id: number, extra: Record<string, unknown> = {}) {
  return { serializeId: id, name: `D${id}`, lastName: 'X', ...extra };
}

function save(dwellers: ReturnType<typeof d>[]): SaveData {
  return { dwellers: { dwellers } } as unknown as SaveData;
}

describe('ascendancyId', () => {
  it('is the serializeId for a normal dweller', () => {
    expect(ascendancyId(d(7), UNIQUE)).toBe(7);
  });
  it('is the unique ascendancy id for a special dweller', () => {
    expect(ascendancyId(d(21, { uniqueData: 'L_Max' }), UNIQUE)).toBe(-48);
  });
  it('falls back to serializeId when the unique id is unknown', () => {
    expect(ascendancyId(d(5, { uniqueData: 'L_Unknown' }), UNIQUE)).toBe(5);
  });
});

describe('selectFamily', () => {
  it('resolves a partner by serializeId', () => {
    const s = save([
      d(1, { relations: { partner: 2, ascendants: [-1, -1, -1, -1, -1, -1] } }),
      d(2, { relations: { partner: 1, ascendants: [-1, -1, -1, -1, -1, -1] } }),
    ]);
    const fam = selectFamily(s, 1, UNIQUE)!;
    expect(fam.partner).toEqual({ id: 2, name: 'D2 X', inVault: true, special: false });
  });

  it('resolves normal parents/grandparents and reverse-looks-up children', () => {
    // child(3) has parents 1 & 2, grandparents 10,11 (10 in vault, 11 absent).
    const s = save([
      d(1),
      d(2),
      d(10),
      d(3, { relations: { partner: -1, ascendants: [1, 2, 10, 11, -1, -1] } }),
    ]);
    const fam = selectFamily(s, 3, UNIQUE)!;
    expect(fam.parents.map((m) => m.id)).toEqual([1, 2]);
    expect(fam.grandparents.map((m) => ({ id: m.id, inVault: m.inVault }))).toEqual([
      { id: 10, inVault: true },
      { id: null, inVault: false }, // 11 not in vault → Unknown
    ]);
    // 1's children = dwellers listing 1 as a parent → dweller 3.
    expect(selectFamily(s, 1, UNIQUE)!.children.map((m) => m.id)).toEqual([3]);
  });

  it('labels a unique parent that is absent from the vault via the catalog', () => {
    // child(3) has a parent with AscendancyID -48 (Maximus), who is NOT in the vault.
    const s = save([d(3, { relations: { partner: -1, ascendants: [-48, -1, -1, -1, -1, -1] } })]);
    const fam = selectFamily(s, 3, UNIQUE)!;
    expect(fam.parents[0]).toEqual({ id: null, name: 'Maximus', inVault: false, special: true });
  });

  it('links a unique parent that IS in the vault by AscendancyID', () => {
    // Maximus is dweller 21 (uniqueData L_Max → AscendancyID -48); child 3 lists -48.
    const s = save([
      d(21, { uniqueData: 'L_Max', name: 'Maximus', lastName: '' }),
      d(3, { relations: { partner: -1, ascendants: [-48, -1, -1, -1, -1, -1] } }),
    ]);
    const fam = selectFamily(s, 3, UNIQUE)!;
    expect(fam.parents[0]).toEqual({ id: 21, name: 'Maximus', inVault: true, special: true });
    // And Maximus's children include dweller 3.
    expect(selectFamily(s, 21, UNIQUE)!.children.map((m) => m.id)).toEqual([3]);
  });

  it('returns null for an unknown dweller', () => {
    expect(selectFamily(save([d(1)]), 99, UNIQUE)).toBeNull();
  });
});
