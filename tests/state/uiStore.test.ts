import { describe, it, expect, beforeEach } from 'vitest';
import { UI_STORAGE_KEY, useUIStore } from '../../src/state/uiStore.ts';

// Runs in jsdom (default env) so localStorage is available for the persistence
// assertions. Reset both the store and storage between tests for isolation.
function resetStore(): void {
  localStorage.clear();
  useUIStore.setState({
    tableLayouts: {},
    dwellerGlobalFilter: '',
    dwellerColumnFilters: [],
    dwellerQuickFilters: {
      fistOnly: false,
      vaultSuitOnly: false,
      emptyPet: false,
      deadOnly: false,
    },
  });
}

describe('uiStore - actions', () => {
  beforeEach(resetStore);

  it('toggles individual quick filters without disturbing the others', () => {
    useUIStore.getState().setDwellerQuickFilter('deadOnly', true);
    expect(useUIStore.getState().dwellerQuickFilters).toEqual({
      fistOnly: false,
      vaultSuitOnly: false,
      emptyPet: false,
      deadOnly: true,
    });
  });

  it('keeps the bulk row-selection in the store (survives tab switches)', () => {
    useUIStore.getState().setDwellerRowSelection({ '3': true, '7': true });
    expect(useUIStore.getState().dwellerRowSelection).toEqual({ '3': true, '7': true });
  });

  it('resetDwellerFilters clears filters but keeps the persisted layout', () => {
    const ui = useUIStore.getState();
    ui.setDwellerGlobalFilter('alice');
    ui.setDwellerColumnFilters([{ id: 'level', value: [10, 50] }]);
    ui.setDwellerQuickFilter('fistOnly', true);
    ui.setTableLayout('dwellers', { sorting: [{ id: 'name', desc: false }] });

    useUIStore.getState().resetDwellerFilters();
    const after = useUIStore.getState();
    expect(after.dwellerGlobalFilter).toBe('');
    expect(after.dwellerColumnFilters).toEqual([]);
    expect(after.dwellerQuickFilters.fistOnly).toBe(false);
    // layout untouched (now owned by the generic tableLayouts slice)
    expect(after.tableLayouts.dwellers?.sorting).toEqual([{ id: 'name', desc: false }]);
  });
});

describe('uiStore - persistence', () => {
  beforeEach(resetStore);

  it('persists layout, but NOT transient filters or the active section', () => {
    const ui = useUIStore.getState();
    ui.setTableLayout('dwellers', {
      sorting: [{ id: 'level', desc: true }],
      columnVisibility: { pet: false },
      columnOrder: ['name', 'level'],
    });
    ui.setDwellerGlobalFilter('should-not-persist');
    ui.setDwellerColumnFilters([{ id: 'rarity', value: ['Legendary'] }]);
    ui.setDwellerRowSelection({ '1': true });

    const persisted = JSON.parse(localStorage.getItem(UI_STORAGE_KEY) ?? '{}').state;
    // The active section is owned by the router (persisted under a separate key), not here.
    expect(persisted.activeSection).toBeUndefined();
    expect(persisted.tableLayouts.dwellers).toEqual({
      sorting: [{ id: 'level', desc: true }],
      columnVisibility: { pet: false },
      columnOrder: ['name', 'level'],
    });
    expect(persisted.dwellerGlobalFilter).toBeUndefined();
    expect(persisted.dwellerColumnFilters).toBeUndefined();
    // Selection is session-only - must not leak into localStorage.
    expect(persisted.dwellerRowSelection).toBeUndefined();
  });
});
