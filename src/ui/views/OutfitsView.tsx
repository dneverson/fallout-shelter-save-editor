import { useMemo } from 'react';
import { useGameData } from '../hooks/useGameData.ts';
import { outfitSchema } from '../components/table/schemas/itemSchemas.tsx';
import { ItemCatalogSection } from '../components/items/ItemCatalogSection.tsx';

// Standalone Outfits catalog section: a browsable
// reference over every outfit in game data (icon · name · SPECIAL · type · rarity), with
// add-to-storage + equip-on-dwellers actions. Mirrors WeaponsView.
export function OutfitsView({ virtualized = true }: { virtualized?: boolean } = {}) {
  const { data: gameData } = useGameData();
  const schema = useMemo(() => outfitSchema(gameData?.enums), [gameData]);
  return (
    <ItemCatalogSection
      title="Outfits"
      unitNoun="outfits"
      storageType="Outfit"
      slot="Outfit"
      data={gameData?.outfits ?? []}
      schema={schema}
      persistKey="catalog.outfits"
      searchLabel="Search outfits"
      searchPlaceholder="Search outfits…"
      virtualized={virtualized}
    />
  );
}
