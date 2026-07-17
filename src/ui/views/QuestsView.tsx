import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useSaveStore } from '../../state/saveStore.ts';
import type { SaveData } from '../../domain/model/saveSchema.ts';
import { useUIStore } from '../../state/uiStore.ts';
import { pushToast } from '../../state/toastStore.ts';
import { useGameData } from '../hooks/useGameData.ts';
import { useQuestCatalog } from '../hooks/useQuestCatalog.ts';
import { useSectionNavigate } from '../routing/useSectionNavigate.ts';
import { ResizableSplit } from '../components/ResizableSplit.tsx';
import { QuestMap } from '../components/quests/QuestMap.tsx';
import { QuestDetailPanel } from '../components/quests/QuestDetailPanel.tsx';
import { buildQuestMapLayout } from '../../domain/quests/questGraphLayout.ts';
import type { QuestSearchMatch } from '../../domain/quests/questSearch.ts';
import { ObjectivesPanel } from '../components/quests/ObjectivesPanel.tsx';
import { QuestFilterBar } from '../components/quests/QuestFilterBar.tsx';
import { computeResourceCaps } from '../../domain/selectors/vaultSelectors.ts';
import { grantLineChip, questRewardChips } from '../../domain/quests/questDisplay.ts';
import {
  chainIdSet,
  EMPTY_QUEST_FILTER,
  filterQuestCatalog,
  isFilterActive,
  questFacetOptions,
  questSaveContext,
  questStatuses,
  regionOf,
  type QuestFilter,
} from '../../domain/quests/questFilter.ts';
import {
  completeQuest,
  completedDependents,
  completedQuestSet,
  isQuestComplete,
  isQuestTip,
  uncompleteQuest,
} from '../../domain/quests/questCompletion.ts';

// Quests tab: the horizontal questline graph (left) + a right-hand detail panel (master-detail,
// like Recipes). Selection lives in the URL `:detail` param (a quest-name), so it is deep-linkable
// and the panel's Prerequisite links navigate through the router. The multi-MB quest catalog is
// lazy-loaded (useQuestCatalog), separate from the core game-data bundle.

/** A short "2500 Caps, 1 LaserRifle, …" summary of granted rewards for the completion toast. */
function grantSummary(lines: ReturnType<typeof completeQuest>['granted']): string {
  const chips = lines.map(grantLineChip);
  if (chips.length === 0) return 'no rewards';
  const shown = chips.slice(0, 4).map((c) => (c.qty > 1 ? `${c.qty}× ${c.label}` : c.label));
  const extra = chips.length - shown.length;
  return shown.join(', ') + (extra > 0 ? `, +${extra} more` : '');
}

export function QuestsView() {
  const save = useSaveStore((s) => s.save);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const { data: gameData, status: gameDataStatus } = useGameData();
  const { data: catalog, status: catalogStatus, error: catalogError } = useQuestCatalog();
  const goTo = useSectionNavigate();
  const panelWidth = useUIStore((s) => s.detailPanelWidth);
  const setPanelWidth = useUIStore((s) => s.setDetailPanelWidth);

  const { detail } = useParams();

  // Selection restore. The URL `:detail` param stays the source of truth (deep-linkable,
  // back/forward-able), but the sidebar enters the section at bare `/quests`, which would drop
  // the selection - and close the right-hand panel - on every tab switch. So the store keeps a
  // session-only shadow of the last selection: entering with no `:detail` redirects ONCE to it
  // (replace, so back-navigation is not polluted); once the redirect has landed the shadow
  // simply follows the URL, which is what makes an explicit panel close (detail -> null) stick.
  const setStoredDetail = useUIStore((s) => s.setQuestDetail);
  // Decided once at mount: null when the tab opened WITH a selection (deep link / back-nav).
  const [restoreTo] = useState<string | null>(() =>
    detail == null ? useUIStore.getState().questDetail : null,
  );
  // Flipped by the panel's close button: an explicit close must stick, not restore right back.
  const [dismissed, setDismissed] = useState(false);
  const restoring = restoreTo != null && !dismissed && detail == null;
  useEffect(() => {
    // Skip the pre-redirect render: recording its transient `null` would wipe the very
    // selection the redirect is about to restore.
    if (restoring) return;
    setStoredDetail(detail ?? null);
  }, [detail, restoring, setStoredDetail]);

  // Two sub-tabs (like Pets: Owned/Catalog): the questline graph and the daily-objectives editor.
  // Held in the uiStore (session-only) so leaving the section and coming back reopens the same
  // sub-tab; objectives have no per-item selection, so they need no URL detail param.
  const tab = useUIStore((s) => s.questsTab);
  const setTab = useUIStore((s) => s.setQuestsTab);

  const completed = useMemo(() => (save ? completedQuestSet(save) : new Set<string>()), [save]);

  // Filtering. The filter itself lives in the uiStore (session-only) so a built-up facet
  // selection survives switching sections. `filterTick` stays view-local: it re-frames the map
  // when the filter CHANGES (see QuestMap's refitTick) - re-packing moves every node, so the old
  // viewport is meaningless - but a remount with a restored filter must NOT refit, it restores
  // the saved viewport instead.
  const filter = useUIStore((s) => s.questFilter);
  const setFilter = useUIStore((s) => s.setQuestFilter);
  const viewport = useUIStore((s) => s.questViewport);
  const setViewport = useUIStore((s) => s.setQuestViewport);
  const [filterTick, setFilterTick] = useState(0);
  const onFilterChange = (next: QuestFilter): void => {
    setFilter(next);
    setFilterTick((t) => t + 1);
  };

  // Quest-log state comes from the save's pickers. With no save loaded this resolves to empty
  // ledgers, which leaves the catalog-only facets (type, environment, rewards, …) fully usable.
  const saveContext = useMemo(
    () => (catalog ? questSaveContext(save ?? ({} as SaveData), catalog.quests) : null),
    [save, catalog],
  );

  // Lane titles for the Questline facet (build-quests emits questlines already title-sorted).
  const questlineTitles = useMemo(() => catalog?.questlines.map((q) => q.title) ?? [], [catalog]);

  // The unfiltered layout: static per catalog, and the baseline for the "X of Y shown" readout.
  const fullLayout = useMemo(
    () => (catalog ? buildQuestMapLayout(catalog.questlines, catalog.quests) : null),
    [catalog],
  );

  const filtered = useMemo(
    () =>
      catalog && saveContext
        ? filterQuestCatalog(catalog.questlines, catalog.quests, filter, saveContext)
        : null,
    [catalog, saveContext, filter],
  );

  // Excel-style cascading lists: each facet only offers values that still yield a match, given
  // the OTHER facets. Recomputed per filter change (one catalog pass per facet).
  const facetOptions = useMemo(
    () =>
      catalog && saveContext
        ? questFacetOptions(catalog.questlines, catalog.quests, filter, saveContext)
        : null,
    [catalog, saveContext, filter],
  );

  // Re-pack: the filtered subset goes back through the same pure layout, so a filter collapses
  // 45 lanes to the handful that matched instead of leaving holes where quests used to be.
  const layout = useMemo(
    () =>
      filtered && isFilterActive(filter)
        ? buildQuestMapLayout(filtered.questlines, filtered.quests)
        : fullLayout,
    [filtered, filter, fullLayout],
  );

  // The headline tallies count MATCHES only. `layout` is the post-expansion map, so its nodes and
  // lanes include the chains a match dragged in - counting those would answer "how much is drawn",
  // when the question the header asks is "how much did I ask for". The full/shown split still gets
  // reported, in the filter bar's "X of Y shown" readout.
  //
  // Nodes, not quest names, are the unit throughout: one card can stand for many catalog rows.
  const tally = useMemo(() => {
    if (!layout) return { quests: 0, chains: 0 };
    if (!filtered || !isFilterActive(filter)) {
      return { quests: layout.nodes.length, chains: layout.lanes.length };
    }
    const { matched } = filtered;
    const hit = (names: readonly string[]): boolean => names.some((n) => matched.has(n));
    return {
      quests: layout.nodes.filter((n) => hit(n.questNames)).length,
      chains: layout.lanes.filter((l) => hit(l.questNames)).length,
    };
  }, [layout, filtered, filter]);

  // Find-in-map. Search is a FACET, not a separate mechanism: it lives in the QuestFilter, so it
  // ANDs with the dropdowns, re-packs the map, drags a chain in around a text hit and greys the
  // context, exactly like ticking a box. ↑/↓ then step through the hits inside that result;
  // focusTick re-frames even when a step lands on the already-selected quest.
  const query = filter.search;
  const [matchIndex, setMatchIndex] = useState(0);
  const [focusTick, setFocusTick] = useState(0);

  // ↑/↓ walks the FILTER'S MATCHES - the bright-bordered cards - and nothing else.
  //
  // It used to re-run a text search over the drawn map, which is a different question and gave a
  // different answer. The drawn map includes the chain context a match drags in, and a text search
  // cannot tell context from a match: with Status=In-log + "to", the map draws every step of
  // "Journey to the Center of Vaultopolis" as context, all of them text hits via their lane title,
  // none of them matches. Stepping landed on 20 nodes when only 2 had matched.
  //
  // That also explains why it only sometimes misbehaved. When search is the ONLY active facet a
  // text hit IS a match, so the two agreed exactly and nothing escaped; adding any second facet
  // pulled them apart. Reading the match set instead of re-deriving it removes the second opinion
  // altogether, so no facet can ever be forgotten here again.
  const matches = useMemo((): QuestSearchMatch[] => {
    if (!layout || !filtered || query.trim() === '') return [];
    const { matched } = filtered;
    const out: QuestSearchMatch[] = [];
    for (const n of layout.nodes) {
      // Select the variant that actually matched, not merely the node's first name.
      const rep = n.questNames.find((q) => matched.has(q));
      if (rep !== undefined) out.push({ nodeId: n.id, questName: rep });
    }
    return out;
  }, [layout, filtered, query]);

  const jumpTo = (list: QuestSearchMatch[], index: number): void => {
    const match = list[index];
    if (!match) return;
    setMatchIndex(index);
    setFocusTick((t) => t + 1);
    goTo('quests', match.questName);
  };

  // Typing re-filters the map. No auto-jump to the first hit any more: the map now re-packs to
  // the hits themselves, so framing one node would hide the result you just asked for. The
  // re-pack's refit shows the whole result instead, and ↑/↓ still walks it.
  const onQueryChange = (next: string): void => {
    setMatchIndex(0);
    onFilterChange({ ...filter, search: next });
  };

  const step = (delta: number): void => {
    if (matches.length === 0) return;
    jumpTo(matches, (matchIndex + delta + matches.length) % matches.length);
  };

  const selectedQuest = useMemo(
    () => (detail != null ? (catalog?.questByName.get(detail) ?? null) : null),
    [detail, catalog],
  );

  const rewardChips = useMemo(
    () => (selectedQuest && gameData ? questRewardChips(selectedQuest, gameData) : []),
    [selectedQuest, gameData],
  );

  // The detail panel answers every filter facet, so the two facets it cannot read off the Quest
  // alone are resolved here with the filter's OWN helpers: status needs the save context, region
  // needs the chain node-id set. Re-deriving either in the panel would risk it disagreeing with
  // the facet that selected the quest in the first place.
  const chainIds = useMemo(() => (catalog ? chainIdSet(catalog.questlines) : null), [catalog]);

  const selectedStatuses = useMemo(
    () => (selectedQuest && saveContext ? questStatuses(selectedQuest, saveContext) : []),
    [selectedQuest, saveContext],
  );

  const selectedRegion = useMemo(
    () => (selectedQuest && chainIds ? regionOf(selectedQuest, chainIds) : null),
    [selectedQuest, chainIds],
  );

  const onComplete = (): void => {
    if (!save || !selectedQuest || !catalog) return;
    if (!gameData) {
      pushToast('Game data is still loading - try again in a moment.', 'info');
      return;
    }
    // Clamp resource rewards to the save's legal caps (Section 5.4.3): grants never push a
    // resource past its computed max, and never lower an already-over-cap value.
    const caps = computeResourceCaps(save, gameData.roomCapacity);
    const result = completeQuest(save, selectedQuest.m_questName, gameData, catalog.questByName, {
      caps,
    });
    if (result.completedNames.length === 0) return;
    applyEdit(() => result.save, `Complete ${selectedQuest.title}`);
    const also = result.completedNames.length - 1;
    pushToast(
      `Completed ${selectedQuest.title}${also > 0 ? ` (+${also} prerequisite${also === 1 ? '' : 's'})` : ''}. Granted: ${grantSummary(result.granted)}.`,
    );
  };

  const onUncomplete = (): void => {
    if (!save || !selectedQuest || !catalog) return;
    applyEdit(
      (s) => uncompleteQuest(s, selectedQuest.m_questName, catalog.questByName),
      `Un-complete ${selectedQuest.title}`,
    );
    pushToast(`Marked ${selectedQuest.title} incomplete.`);
  };

  // Variant-aware, like the map's node colouring: a step whose other difficulty cut is in the
  // ledger IS completed, so the panel must never offer to complete (and re-grant) it again.
  const isCompleted =
    save && selectedQuest && catalog
      ? isQuestComplete(save, selectedQuest.m_questName, catalog.questByName)
      : false;
  const isTip =
    save && selectedQuest
      ? isQuestTip(save, selectedQuest.m_questName, catalog!.questByName)
      : false;
  const blockedBy =
    save && selectedQuest
      ? completedDependents(save, selectedQuest.m_questName, catalog!.questByName)
      : [];
  const knownDependencies = useMemo(() => {
    if (!selectedQuest || !catalog) return new Set<string>();
    return new Set(
      (selectedQuest.m_questDependancies ?? []).filter((d) => catalog.questByName.has(d)),
    );
  }, [selectedQuest, catalog]);

  const leftPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">Quests</h2>
        {catalog && layout && (
          <span className="text-sm text-neutral-400">
            {tally.quests} quests · {tally.chains} chains · {completed.size} completed
          </span>
        )}
        {(catalogStatus === 'loading' || gameDataStatus === 'loading') && (
          <span className="text-xs text-neutral-400">loading…</span>
        )}
        {catalogStatus === 'error' && (
          <span className="text-xs text-amber-500">{catalogError ?? 'quest data unavailable'}</span>
        )}
      </div>

      <div className="mt-3 flex shrink-0 items-center gap-1">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
          }}
          disabled={!layout}
          placeholder="Search quests, questlines & ids…"
          aria-label="Search quests"
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 focus:border-amber-500/60 focus:outline-none disabled:opacity-40"
        />
        {query.trim() && (
          <>
            <span className="shrink-0 tabular-nums text-[11px] text-neutral-400">
              {matches.length === 0 ? '0/0' : `${matchIndex + 1}/${matches.length}`}
            </span>
            <button
              type="button"
              aria-label="Previous match"
              onClick={() => step(-1)}
              disabled={matches.length === 0}
              className="rounded px-1.5 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Next match"
              onClick={() => step(1)}
              disabled={matches.length === 0}
              className="rounded px-1.5 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            >
              ↓
            </button>
          </>
        )}
      </div>

      {catalog && saveContext && fullLayout && facetOptions && (
        <div className="mt-2">
          <QuestFilterBar
            filter={filter}
            onChange={onFilterChange}
            options={facetOptions}
            questlineTitles={questlineTitles}
            rotationExpired={saveContext.rotationExpired}
            shown={layout?.nodes.length ?? 0}
            total={fullLayout.nodes.length}
            matched={tally.quests}
          />
        </div>
      )}

      <div className="mt-3 min-h-0 min-w-0 flex-1">
        {catalog && layout ? (
          layout.nodes.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No quests match these filters.{' '}
              <button
                type="button"
                onClick={() => onFilterChange(EMPTY_QUEST_FILTER)}
                className="text-amber-400 underline hover:text-amber-300"
              >
                Clear filters
              </button>
              .
            </p>
          ) : (
            <QuestMap
              layout={layout}
              completed={completed}
              selectedName={detail ?? null}
              onSelectNode={(name) => goTo('quests', name)}
              // With no filter every node is a match, so skip the set entirely and let the map
              // draw everything in full colour.
              matched={isFilterActive(filter) ? filtered?.matched : undefined}
              focusTick={focusTick}
              refitTick={filterTick}
              initialViewport={viewport}
              onViewportChange={setViewport}
            />
          )
        ) : catalogStatus === 'error' ? (
          <p className="text-sm text-amber-500">Could not load the quest catalog.</p>
        ) : (
          <p className="text-sm text-neutral-500">Loading quest catalog…</p>
        )}
      </div>
    </div>
  );

  // Re-enter on the remembered selection (all hooks above have run; one throwaway render).
  if (restoring) {
    return <Navigate to={`/quests/${restoreTo}`} replace />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Quests view"
        className="flex gap-1 border-b border-neutral-800 px-4 pt-3"
      >
        {(['quests', 'objectives'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-t px-3 py-1.5 text-sm ${
              tab === t
                ? 'bg-neutral-800 font-medium text-amber-300'
                : 'text-neutral-400 hover:text-neutral-100'
            }`}
          >
            {t === 'quests' ? 'Quests' : 'Objectives'}
          </button>
        ))}
      </div>

      {tab === 'objectives' ? (
        <div className="min-h-0 flex-1">
          <ObjectivesPanel />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ResizableSplit
            ariaLabel="Resize quest detail panel"
            width={panelWidth}
            onWidthChange={setPanelWidth}
            left={leftPane}
            right={
              selectedQuest ? (
                <QuestDetailPanel
                  quest={selectedQuest}
                  questlineTitle={selectedQuest.questlineTitle ?? null}
                  completed={isCompleted}
                  statuses={selectedStatuses}
                  region={selectedRegion}
                  isTip={isTip}
                  blockedBy={blockedBy}
                  rewardChips={rewardChips}
                  canEdit={!!save}
                  onComplete={onComplete}
                  onUncomplete={onUncomplete}
                  onSelectDependency={(name) => goTo('quests', name)}
                  knownDependencies={knownDependencies}
                  onClose={() => {
                    setDismissed(true);
                    goTo('quests', null);
                  }}
                />
              ) : null
            }
          />
        </div>
      )}
    </div>
  );
}
