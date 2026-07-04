// Collapse/expand header button for the Rooms-screen sections (Advisors, Build). Styled
// like the existing section labels (xs uppercase neutral) with a chevron, so collapsing a
// section leaves just this one line - freeing vertical space for the room grid.

export function SectionToggle({
  label,
  collapsed,
  onToggle,
  hint,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  /** Optional trailing note (e.g. a count) shown while collapsed. */
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400 transition-colors hover:text-neutral-200"
    >
      <span aria-hidden className="inline-block w-3 text-center text-[10px] leading-none">
        {collapsed ? '▶' : '▼'}
      </span>
      {label}
      {hint && (
        <span className="font-normal normal-case tracking-normal text-neutral-500">{hint}</span>
      )}
    </button>
  );
}
