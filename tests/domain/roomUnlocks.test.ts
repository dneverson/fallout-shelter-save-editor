// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';
import {
  claimRoomUnlock,
  isRoomTypeUnlocked,
  unlockIdForRoomType,
} from '../../src/domain/rooms/roomUnlocks.ts';

function makeSave(claimed: string[]): SaveData {
  return { unlockableMgr: { claimed } } as SaveData;
}

describe('unlockIdForRoomType', () => {
  it('maps gated room types to their objective id', () => {
    expect(unlockIdForRoomType('Armory')).toBe('ArmoryUnlock');
    expect(unlockIdForRoomType('Casino')).toBe('GameRoomUnlock');
    expect(unlockIdForRoomType('Energy2')).toBe('PowerPlantUnlock');
    expect(unlockIdForRoomType('Water2')).toBe('WaterroomUnlock');
    expect(unlockIdForRoomType('SuperRoom2')).toBe('CardioUnlock');
  });

  it('returns null for free starter rooms (no objective)', () => {
    for (const type of ['Cafeteria', 'Geothermal', 'WaterPlant', 'LivingQuarters', 'Elevator']) {
      expect(unlockIdForRoomType(type)).toBeNull();
    }
  });
});

describe('isRoomTypeUnlocked', () => {
  it('treats starter rooms as always unlocked', () => {
    const save = makeSave([]);
    expect(isRoomTypeUnlocked(save, 'Geothermal')).toBe(true);
    expect(isRoomTypeUnlocked(save, 'Cafeteria')).toBe(true);
  });

  it('reflects whether a gated room’s id is in claimed', () => {
    expect(isRoomTypeUnlocked(makeSave([]), 'Armory')).toBe(false);
    expect(isRoomTypeUnlocked(makeSave(['ArmoryUnlock']), 'Armory')).toBe(true);
  });
});

describe('claimRoomUnlock', () => {
  it('appends a gated room’s unlock id to claimed', () => {
    const save = makeSave(['StorageUnlock']);
    const next = claimRoomUnlock(save, 'Armory');
    expect(next.unlockableMgr?.claimed).toEqual(['StorageUnlock', 'ArmoryUnlock']);
  });

  it('is a no-op (same reference) for a starter room', () => {
    const save = makeSave(['StorageUnlock']);
    expect(claimRoomUnlock(save, 'Geothermal')).toBe(save);
  });

  it('is a no-op (same reference) when already claimed', () => {
    const save = makeSave(['ArmoryUnlock']);
    expect(claimRoomUnlock(save, 'Armory')).toBe(save);
  });

  it('seeds claimed when the save has none', () => {
    const next = claimRoomUnlock({} as SaveData, 'Water2');
    expect(next.unlockableMgr?.claimed).toEqual(['WaterroomUnlock']);
  });
});
