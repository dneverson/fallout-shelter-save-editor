import type { FamilyStats, StatGroupKey } from '../../../domain/selectors/familyGraphSelectors.ts';
import { InfoTooltip } from '../InfoTooltip.tsx';

// "Vault Genetics" stat block for the Family Tree tab - a row of stat chips plus a
// tongue-in-cheek overall status (Pristine Bloodlines … One Cursed Bloodline) driven by how
// many children have parents that share an ancestor. Chips backed by a concrete set of
// dwellers are clickable: selecting one highlights exactly those dwellers in the tree.

// Status colour by severity level (0 pristine → 5 cursed).
const STATUS_CLASS: Record<number, string> = {
  0: 'border-emerald-600/60 bg-emerald-500/10 text-emerald-300',
  1: 'border-lime-600/60 bg-lime-500/10 text-lime-300',
  2: 'border-amber-600/60 bg-amber-500/10 text-amber-300',
  3: 'border-orange-600/60 bg-orange-500/10 text-orange-300',
  4: 'border-red-600/60 bg-red-500/10 text-red-300',
  5: 'border-red-500 bg-red-600/20 text-red-200',
};

// Chip order. `key` present → the chip is clickable and highlights stats.groups[key].
// `help` is a plain-language explanation shown as a hover tooltip (some stats are unclear).
const CHIPS: ReadonlyArray<{
  label: string;
  field: keyof FamilyStats;
  key?: StatGroupKey;
  help: string;
}> = [
  {
    label: 'Dwellers',
    field: 'dwellers',
    help: 'Total dwellers in the tree (special characters included).',
  },
  {
    label: 'Families',
    field: 'familyGroups',
    key: 'familyGroups',
    help: 'Groups of two or more related dwellers (connected by parent, child, or partner links).',
  },
  {
    label: 'Lone wolves',
    field: 'loneWolves',
    key: 'loneWolves',
    help: 'Dwellers with no recorded family at all - no parents, partner, or children.',
  },
  {
    label: 'Biggest clan',
    field: 'largestFamily',
    key: 'largestFamily',
    help: 'Number of dwellers in the single largest connected family.',
  },
  {
    label: 'Generations',
    field: 'generations',
    help: 'How many generations deep the deepest bloodline runs (grandparent → parent → child = 3).',
  },
  {
    label: 'Couples',
    field: 'couples',
    key: 'couples',
    help: 'Pairs who are partners or share at least one child.',
  },
  {
    label: 'Founders',
    field: 'founders',
    key: 'founders',
    help: 'Dwellers with no recorded parents - the start of each bloodline.',
  },
  {
    label: 'Specials',
    field: 'specials',
    key: 'specials',
    help: 'Unique / named characters (e.g. legendary or quest dwellers) currently in the vault.',
  },
  {
    label: 'Inbred unions',
    field: 'inbredUnions',
    key: 'inbredUnions',
    help: 'Children whose two parents share a common ancestor (the cause of the genetics status).',
  },
];

function StatChip({
  label,
  value,
  help,
  active,
  onClick,
}: {
  label: string;
  value: number;
  help: string;
  active: boolean;
  onClick?: () => void;
}) {
  const base = 'flex flex-col items-center rounded border px-2.5 py-1';
  const inner = (
    <>
      <span className="text-sm font-semibold tabular-nums text-neutral-100">{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</span>
    </>
  );
  if (!onClick) {
    return (
      <div className={`${base} cursor-help border-neutral-800 bg-neutral-900/60`} title={help}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={`${help}\n\nClick to highlight these dwellers.`}
      className={`${base} ${
        active
          ? 'border-amber-500 bg-amber-500/15'
          : 'border-neutral-800 bg-neutral-900/60 hover:border-amber-600/60'
      }`}
    >
      {inner}
    </button>
  );
}

export function FamilyStatsBar({
  stats,
  activeStat,
  onToggleStat,
}: {
  stats: FamilyStats;
  activeStat: StatGroupKey | null;
  onToggleStat: (key: StatGroupKey) => void;
}) {
  const { status } = stats;
  const pct = stats.twoParentChildren
    ? Math.round((stats.inbredUnions / stats.twoParentChildren) * 100)
    : 0;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-950/60 px-3 py-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${
          STATUS_CLASS[status.level]
        }`}
      >
        <span aria-hidden="true">{status.emoji}</span>
        {status.label}
        <InfoTooltip label="Vault genetics status" text={status.blurb} />
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {CHIPS.map((c) => (
          <StatChip
            key={c.label}
            label={c.label}
            value={stats[c.field] as number}
            help={c.help}
            active={!!c.key && activeStat === c.key}
            {...(c.key ? { onClick: () => onToggleStat(c.key as StatGroupKey) } : {})}
          />
        ))}
      </div>
      <span
        className="cursor-help text-[11px] text-neutral-500"
        title="Share of children (with two known parents) whose parents share a common ancestor."
      >
        {pct}% of births kept it in the family
      </span>
    </div>
  );
}
