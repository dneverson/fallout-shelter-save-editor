import { useMemo } from 'react';
import { useSaveStore } from '../../state/saveStore.ts';
import { useUIStore } from '../../state/uiStore.ts';
import { useToastStore } from '../../state/toastStore.ts';
import { useGameData } from '../hooks/useGameData.ts';
import { computeResourceCaps } from '../../domain/selectors/vaultSelectors.ts';
import {
  CONSUMABLE_CODES,
  consumableCounts,
  isMysteriousStrangerShown,
  isStarterPackPurchased,
  maxResources,
  resources as readResources,
  setConsumableCount,
  setMysteriousStranger,
  setStrangerTimers,
  setResource,
  setStarterPackPurchased,
  setVaultMode,
  setVaultName,
  setVaultTheme,
  type VaultMode,
} from '../../domain/ops/vaultOps.ts';
import { ResourcesCard } from '../components/vault/ResourcesCard.tsx';
import { ConsumablesCard } from '../components/vault/ConsumablesCard.tsx';
import { VaultConfigCard } from '../components/vault/VaultConfigCard.tsx';
import { MiscCard } from '../components/vault/MiscCard.tsx';
import { SaveOverview } from './SaveOverview.tsx';

// Vault settings: a grid of grouped cards over the
// active save's vault. This view orchestrates - it reads the save + game-data caps and
// passes plain values + edit callbacks down to presentational cards. Every edit is one
// applyEdit = one undo step; quick actions also raise a toast. The save metadata +
// health check (the old "Vault overview") fold in below the settings.

export function VaultView() {
  const save = useSaveStore((s) => s.save);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const allowOutOfRange = useUIStore((s) => s.allowOutOfRange);
  const pushToast = useToastStore((s) => s.push);
  const { data: gameData, status: gameDataStatus } = useGameData();

  const caps = useMemo(
    () => (save && gameData ? computeResourceCaps(save, gameData.roomCapacity) : null),
    [save, gameData],
  );

  const view = useMemo(() => {
    if (!save) return null;
    return {
      resources: readResources(save),
      counts: consumableCounts(save),
      name: save.vault?.VaultName ?? '000',
      mode: save.vault?.VaultMode ?? 'Normal',
      theme: save.vault?.VaultTheme ?? 0,
      strangerShown: isMysteriousStrangerShown(save),
      strangerTimeToAppear: save.MysteriousStranger?.timeToAppear ?? 180,
      strangerRemaining: save.MysteriousStranger?.remainingTimeToAppear ?? 0,
      starterPackPurchased: isStarterPackPurchased(save),
    };
  }, [save]);

  if (!save || !view) {
    return <div className="p-8 text-sm text-neutral-400">No save loaded.</div>;
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl p-6">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold">Vault settings</h2>
          {gameDataStatus === 'loading' && (
            <span className="text-xs text-neutral-400">loading game data…</span>
          )}
          {gameDataStatus === 'error' && (
            <span className="text-xs text-amber-500">game data unavailable - caps disabled</span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ResourcesCard
            resources={view.resources}
            caps={caps}
            allowOutOfRange={allowOutOfRange}
            onSet={(key, value) => applyEdit((s) => setResource(s, key, value), `Set ${key}`)}
            onMaxAll={() => {
              if (!caps) return;
              applyEdit((s) => maxResources(s, caps), 'Max resources');
              pushToast('Resources maxed to legal capacity');
            }}
          />

          <ConsumablesCard
            counts={view.counts}
            onSet={(code, count) =>
              applyEdit((s) => setConsumableCount(s, code, count), 'Set consumables')
            }
            starterPackPurchased={view.starterPackPurchased}
            onToggleStarterPack={(purchased) => {
              applyEdit((s) => setStarterPackPurchased(s, purchased), 'Starter Pack');
              pushToast(`Starter Pack offer ${purchased ? 'hidden' : 'restored'}`);
            }}
            starterPacksInVault={view.counts[CONSUMABLE_CODES.StarterPack] ?? 0}
            onSetStarterPacks={(count) =>
              applyEdit(
                (s) => setConsumableCount(s, CONSUMABLE_CODES.StarterPack, count),
                'Set Starter Packs',
              )
            }
          />

          <VaultConfigCard
            name={view.name}
            mode={view.mode}
            theme={view.theme}
            onName={(value) => applyEdit((s) => setVaultName(s, value), 'Set vault name')}
            onMode={(mode: VaultMode) => applyEdit((s) => setVaultMode(s, mode), 'Set vault mode')}
            onTheme={(theme) => applyEdit((s) => setVaultTheme(s, theme), 'Set vault theme')}
          />

          <MiscCard
            strangerShown={view.strangerShown}
            onToggleStranger={(show) => {
              applyEdit((s) => setMysteriousStranger(s, show), 'Mysterious Stranger');
              pushToast(`Mysterious Stranger ${show ? 'set to appear' : 'hidden'}`);
            }}
            timeToAppear={view.strangerTimeToAppear}
            remainingTime={view.strangerRemaining}
            onSetTimers={(timers) =>
              applyEdit((s) => setStrangerTimers(s, timers), 'Stranger timers')
            }
          />
        </div>

        <div className="mt-6 border-t border-neutral-800 pt-2">
          <SaveOverview />
        </div>
      </div>
    </div>
  );
}
