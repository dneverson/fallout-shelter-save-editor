import type { RewardChip } from '../../../domain/quests/questDisplay.ts';
import { ItemIcon } from '../ItemIcon.tsx';

// Renders a quest's reward manifest (Section 8.1): real items/pets reuse the shipped item-icon
// atlas; currency/consumables show a small labelled pill (no per-currency sprite exists); random
// or otherwise ungrantable rewards show a "?" mystery badge, matching the in-game quest card.

const TONE_PILL: Record<RewardChip['tone'], string> = {
  currency: 'border-amber-700/60 bg-amber-950/30 text-amber-200',
  item: 'border-sky-800/60 bg-sky-950/30 text-sky-200',
  pet: 'border-emerald-800/60 bg-emerald-950/30 text-emerald-200',
  special: 'border-purple-800/60 bg-purple-950/30 text-purple-200',
  mystery: 'border-neutral-700 bg-neutral-800/50 text-neutral-300',
};

function Chip({ chip, size }: { chip: RewardChip; size: number }) {
  const qty = chip.qty > 1 ? `×${chip.qty}` : '';
  const title = `${chip.label}${qty ? ` ${qty}` : ''}${chip.rolled ? ' (rolled)' : ''}`;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${TONE_PILL[chip.tone]}`}
    >
      {chip.icon ? (
        <ItemIcon type={chip.icon.type} id={chip.icon.id} size={size} />
      ) : chip.tone === 'mystery' ? (
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center rounded-sm bg-neutral-700 font-bold text-neutral-200"
          style={{ width: size, height: size, fontSize: size * 0.6 }}
        >
          ?
        </span>
      ) : null}
      <span className="max-w-[10rem] truncate">{chip.label}</span>
      {qty && <span className="font-semibold tabular-nums">{qty}</span>}
      {chip.rolled && <span className="text-[9px] uppercase text-amber-300/80">rolled</span>}
    </span>
  );
}

export function RewardChips({
  chips,
  iconSize = 18,
  className,
}: {
  chips: RewardChip[];
  iconSize?: number;
  className?: string;
}) {
  if (chips.length === 0) {
    return <span className="text-xs text-neutral-500">No rewards</span>;
  }
  return (
    <div className={`flex flex-wrap gap-1.5${className ? ` ${className}` : ''}`}>
      {chips.map((chip, i) => (
        <Chip key={`${chip.tone}:${chip.label}:${i}`} chip={chip} size={iconSize} />
      ))}
    </div>
  );
}
