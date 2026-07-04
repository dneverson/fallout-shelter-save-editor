import { useMemo } from 'react';
import { useGameData } from '../hooks/useGameData.ts';
import { weaponSchema } from '../components/table/schemas/itemSchemas.tsx';
import { ItemCatalogSection } from '../components/items/ItemCatalogSection.tsx';

// Standalone Weapons catalog section: a browsable,
// searchable, sortable, type/rarity-filterable reference over every weapon in game data,
// with add-to-storage + equip-on-dwellers actions. Reuses the shared item columns + the
// generic <ItemCatalogSection> wiring.
export function WeaponsView({ virtualized = true }: { virtualized?: boolean } = {}) {
  const { data: gameData } = useGameData();
  const schema = useMemo(() => weaponSchema(gameData?.enums), [gameData]);
  return (
    <ItemCatalogSection
      title="Weapons"
      unitNoun="weapons"
      storageType="Weapon"
      slot="Weapon"
      data={gameData?.weapons ?? []}
      schema={schema}
      persistKey="catalog.weapons"
      searchLabel="Search weapons"
      searchPlaceholder="Search weapons…"
      virtualized={virtualized}
    />
  );
}
