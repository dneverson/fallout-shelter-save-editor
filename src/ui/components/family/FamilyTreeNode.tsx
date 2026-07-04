import { useMemo } from 'react';
import type { VisualAssets } from '../../../domain/gamedata/visualAssets.ts';
import { useSaveStore } from '../../../state/saveStore.ts';
import { selectDwellerById } from '../../../domain/selectors/dwellerSelectors.ts';
import { toRenderableDweller } from '../../../render/dwellerAppearance.ts';
import { useDwellerThumbnail } from '../../hooks/useDwellerThumbnail.ts';
import type { PositionedNode } from '../../lib/familyTreeLayout.ts';
import { NODE_H, NODE_W } from '../../lib/familyTreeLayout.ts';

// One person card in the Family Tree forest. Positioned absolutely at its layout centre.
// Vault dwellers get a live cached portrait (shared offscreen renderer, same as the roster
// table) and are clickable to focus their bloodline; referenced-but-absent special
// ancestors render as a dashed, star-marked placeholder (no portrait, not clickable).

interface FamilyTreeNodeProps {
  node: PositionedNode;
  assets: VisualAssets | null;
  selected: boolean;
  dimmed: boolean;
  onSelect: (serializeId: number) => void;
}

export function FamilyTreeNode({ node, assets, selected, dimmed, onSelect }: FamilyTreeNodeProps) {
  const { meta } = node;
  // Read this node's own raw dweller so only it re-renders when that dweller is edited.
  const dweller = useSaveStore((s) =>
    s.save && meta.serializeId != null ? selectDwellerById(s.save, meta.serializeId) : undefined,
  );
  const renderable = useMemo(() => (dweller ? toRenderableDweller(dweller) : null), [dweller]);
  const url = useDwellerThumbnail(renderable, assets);

  const genderRing = meta.gender === 'female' ? 'border-pink-500/50' : 'border-sky-500/50';
  const ring = selected ? 'border-amber-400 ring-2 ring-amber-400/60' : genderRing;
  const clickable = meta.serializeId != null;

  const inner = (
    <>
      <div
        className={`mx-auto h-12 w-12 overflow-hidden rounded-full border ${
          meta.absent
            ? 'border-dashed border-neutral-600 bg-neutral-800'
            : 'border-neutral-700 bg-neutral-800'
        }`}
        aria-hidden="true"
      >
        {url ? (
          <img src={url} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
            {meta.special ? '★' : '?'}
          </div>
        )}
      </div>
      <div className="mt-1 line-clamp-2 px-1 text-center text-[11px] leading-tight text-neutral-200">
        {meta.special && <span className="text-amber-400">★ </span>}
        {meta.name}
      </div>
    </>
  );

  const style = {
    left: node.cx - NODE_W / 2,
    top: node.cy - NODE_H / 2,
    width: NODE_W,
    height: NODE_H,
  } as const;

  const base = `absolute flex flex-col justify-center rounded-lg border bg-neutral-900/90 p-1.5 shadow transition-opacity ${ring} ${
    dimmed ? 'opacity-25' : 'opacity-100'
  }`;

  if (!clickable) {
    return (
      <div
        className={base}
        style={style}
        title={meta.absent ? 'Special character (not in this vault)' : meta.name}
      >
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`${base} text-left hover:border-amber-500/70`}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => onSelect(meta.serializeId!)}
      title={`Focus ${meta.name}`}
    >
      {inner}
    </button>
  );
}
