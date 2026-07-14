// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  addCollectionEntries,
  collectionCodes,
  collectionStatus,
  removeCollectionEntries,
  setCollectionEntriesNew,
} from '../../src/domain/ops/collectionOps.ts';

// Survival Guide collection ops over the `survivalW` string lists. Entries are
// "N"/"O" + code exactly as SurvivalWindow.Serialize writes them - the dweller list
// stores "N"/"O" + the "L_"-prefixed asset name (e.g. "NL_NickValentine").

function makeSave(): SaveData {
  return {
    survivalW: {
      weapons: ['N24', 'O19'],
      dwellers: ['NL_NickValentine'],
    },
    dwellers: { dwellers: [] },
  } as SaveData;
}

describe('collectionOps - status', () => {
  it('reads per-code status from the N/O prefix', () => {
    const save = makeSave();
    expect(collectionStatus(save, 'weapons', '24')).toBe('new');
    expect(collectionStatus(save, 'weapons', '19')).toBe('seen');
    expect(collectionStatus(save, 'weapons', '99')).toBe('missing');
    // Dweller codes keep their own "L_" prefix after the state letter.
    expect(collectionStatus(save, 'dwellers', 'L_NickValentine')).toBe('new');
    // A list that is absent from the save reads as all-missing.
    expect(collectionStatus(save, 'junk', 'AlarmClock')).toBe('missing');
  });

  it('collectionCodes maps code → is-new for one list', () => {
    const map = collectionCodes(makeSave(), 'weapons');
    expect(map.get('24')).toBe(true);
    expect(map.get('19')).toBe(false);
    expect(map.has('99')).toBe(false);
  });
});

describe('collectionOps - add', () => {
  it('appends "N" entries by default (union, structural sharing)', () => {
    const save = makeSave();
    const next = addCollectionEntries(save, 'weapons', ['99', '4']);
    expect(next.survivalW?.weapons).toEqual(['N24', 'O19', 'N99', 'N4']);
    expect(next.dwellers).toBe(save.dwellers); // untouched subtree shared by reference
    expect(next.survivalW?.dwellers).toBe(save.survivalW?.dwellers); // sibling list shared
  });

  it('writes pre-seen "O" entries when asNew is false', () => {
    const next = addCollectionEntries(makeSave(), 'junk', ['AlarmClock'], false);
    expect(next.survivalW?.junk).toEqual(['OAlarmClock']);
  });

  it('never duplicates a collected code and no-ops (same ref) when nothing is new', () => {
    const save = makeSave();
    expect(addCollectionEntries(save, 'weapons', ['24', '19'])).toBe(save);
    expect(addCollectionEntries(save, 'weapons', [])).toBe(save);
  });

  it('creates the list (and survivalW) when absent', () => {
    const bare = { dwellers: { dwellers: [] } } as SaveData;
    const next = addCollectionEntries(bare, 'breeds', ['7']);
    expect(next.survivalW?.breeds).toEqual(['N7']);
  });
});

describe('collectionOps - remove', () => {
  it('drops entries under either prefix, no-op when none present', () => {
    const save = makeSave();
    expect(removeCollectionEntries(save, 'weapons', ['24', '19']).survivalW?.weapons).toEqual([]);
    expect(removeCollectionEntries(save, 'weapons', ['99'])).toBe(save);
    expect(removeCollectionEntries(save, 'junk', ['AlarmClock'])).toBe(save);
  });
});

describe('collectionOps - new/seen state', () => {
  it('flips N → O (mark seen) and O → N (mark new)', () => {
    const save = makeSave();
    const seen = setCollectionEntriesNew(save, 'weapons', ['24'], false);
    expect(seen.survivalW?.weapons).toEqual(['O24', 'O19']);
    const renewed = setCollectionEntriesNew(seen, 'weapons', ['19'], true);
    expect(renewed.survivalW?.weapons).toEqual(['O24', 'N19']);
  });

  it('ignores codes that are not collected and no-ops when nothing flips', () => {
    const save = makeSave();
    expect(setCollectionEntriesNew(save, 'weapons', ['99'], false)).toBe(save);
    expect(setCollectionEntriesNew(save, 'weapons', ['24'], true)).toBe(save); // already N
  });
});
