import { useMemo } from 'react';
import { useGameData } from '../hooks/useGameData.ts';
import { junkSchema } from '../components/table/schemas/itemSchemas.tsx';
import { ItemCatalogSection } from '../components/items/ItemCatalogSection.tsx';

// Standalone Junk catalog section: a browsable
// reference over every junk item in game data. Junk can't be equipped, so the only
// action is bulk add-to-storage (`slot={null}` → no Equip column).
export function JunkView({ virtualized = true }: { virtualized?: boolean } = {}) {
  const { data: gameData } = useGameData();
  const schema = useMemo(() => junkSchema(), []);
  return (
    <ItemCatalogSection
      title="Junk"
      unitNoun="junk"
      storageType="Junk"
      slot={null}
      data={gameData?.junk ?? []}
      schema={schema}
      persistKey="catalog.junk"
      searchLabel="Search junk"
      searchPlaceholder="Search junk…"
      virtualized={virtualized}
    />
  );
}
