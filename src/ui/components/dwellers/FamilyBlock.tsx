import { useMemo } from 'react';
import { useSaveStore } from '../../../state/saveStore.ts';
import { useSectionNavigate } from '../../routing/useSectionNavigate.ts';
import { useGameData } from '../../hooks/useGameData.ts';
import { selectFamily, type FamilyMember } from '../../../domain/selectors/familySelectors.ts';

// Family / relationship viewer inside the character sheet - read-only.
// Shows partner, parents, grandparents, and children; vault members are clickable and
// select that dweller into the sheet, so you can walk the family tree. Unique/special
// ascendants absent from the vault are still named via the extracted catalog.

function MemberChip({ member }: { member: FamilyMember }) {
  const goTo = useSectionNavigate();
  const label = (
    <>
      {member.special && <span className="text-amber-400">★ </span>}
      {member.name}
    </>
  );
  if (member.inVault && member.id !== null) {
    return (
      <button
        type="button"
        onClick={() => goTo('dwellers', member.id)}
        className="rounded border border-neutral-700 bg-neutral-800/60 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-700"
        title="Open this dweller"
      >
        {label}
      </button>
    );
  }
  return (
    <span
      className="rounded border border-neutral-800 px-2 py-0.5 text-xs text-neutral-400"
      title={member.special ? 'Special character (not in this vault)' : 'Not in this vault'}
    >
      {label}
    </span>
  );
}

function Row({ label, members }: { label: string; members: FamilyMember[] }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-24 shrink-0 text-xs text-neutral-400">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {members.length === 0 ? (
          <span className="text-xs text-neutral-400">–</span>
        ) : (
          members.map((m, i) => <MemberChip key={`${m.id ?? 'x'}-${i}`} member={m} />)
        )}
      </div>
    </div>
  );
}

export function FamilyBlock({ serializeId }: { serializeId: number }) {
  const save = useSaveStore((s) => s.save);
  const { data: gameData } = useGameData();
  const goToSection = useSectionNavigate();

  const family = useMemo(
    () => (save && gameData ? selectFamily(save, serializeId, gameData.uniqueDwellers) : null),
    [save, gameData, serializeId],
  );

  if (!family) return null;
  const { partner, parents, grandparents, children } = family;
  const hasAny =
    partner !== null || parents.length > 0 || grandparents.length > 0 || children.length > 0;

  const viewInTree = (): void => {
    goToSection('family', serializeId);
  };

  return (
    <section className="mt-4">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/80">
          Family
        </h4>
        <button
          type="button"
          onClick={viewInTree}
          className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-amber-600/60 hover:text-amber-200"
          title="Open this dweller in the Family Tree tab"
        >
          View in family tree
        </button>
      </div>
      {hasAny ? (
        <div className="space-y-1.5">
          <Row label="Partner" members={partner ? [partner] : []} />
          <Row label="Parents" members={parents} />
          <Row label="Grandparents" members={grandparents} />
          <Row label="Children" members={children} />
        </div>
      ) : (
        <p className="text-xs text-neutral-400">No family recorded.</p>
      )}
    </section>
  );
}
