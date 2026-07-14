import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useGameData } from '../hooks/useGameData.ts';
import { useCraftableColumn } from '../hooks/useCraftableColumn.ts';
import { weaponSchema } from '../components/table/schemas/itemSchemas.tsx';
import { ItemCatalogSection } from '../components/items/ItemCatalogSection.tsx';

// Standalone Weapons catalog section: a browsable,
// searchable, sortable, type/rarity-filterable reference over every weapon in game data,
// with add-to-storage + equip-on-dwellers actions. Reuses the shared item columns + the
// generic <ItemCatalogSection> wiring. The Craftable column links to the Recipes tab;
// arriving from a recipe's "View in Weapons tab" jump highlights the item via the URL
// `:detail` param.
export function WeaponsView({ virtualized = true }: { virtualized?: boolean } = {}) {
  const { data: gameData } = useGameData();
  const { detail } = useParams();
  const craft = useCraftableColumn();
  const schema = useMemo(() => weaponSchema(gameData?.enums, craft), [gameData, craft]);
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
      focusRowId={detail ?? null}
      virtualized={virtualized}
    />
  );
}
