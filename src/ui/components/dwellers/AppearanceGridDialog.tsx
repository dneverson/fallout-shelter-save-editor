import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  hairLabel,
  hairOptions,
  type GameData,
  type HairKind,
} from '../../../domain/gamedata/gameData.ts';
import { pieceByName, type VisualAssets } from '../../../domain/gamedata/visualAssets.ts';
import { spriteStyle } from '../itemIconSprite.ts';
import { MODAL_LARGE } from '../../lib/modalClasses.ts';

// Visual appearance picker (hair / face + facial hair): a searchable card GRID with the
// real atlas sprite and the catalog name under each piece, gender-filtered like the
// in-game barbershop. Clicking a card commits the piece (one undo step at the call
// site) and closes. The catalog's explicit "null" pieces are dropped in favour of an
// explicit None card. Pieces render as CSS atlas crops (spriteStyle); when the visual
// assets are unavailable the cards degrade to label-only.

interface AppearanceGridDialogProps {
  title: string;
  kind: HairKind;
  /** Save gender (1 = female, 2 = male); filters the catalog. */
  gender: number | undefined;
  current: string | null;
  gameData: GameData;
  assets: VisualAssets | null;
  /** Offer a None card that clears the field. */
  allowNone?: boolean;
  onPick: (value: string | null) => void;
  onClose: () => void;
}

/** Sprite-index piece type for a picker kind. */
const SPRITE_TYPE: Record<HairKind, string> = { hair: 'hair', face: 'faceMask' };

const THUMB = 72;

function PieceThumb({
  assets,
  kind,
  pieceName,
  gender,
}: {
  assets: VisualAssets | null;
  kind: HairKind;
  pieceName: string;
  gender: number | undefined;
}) {
  const genderStr = gender === 1 ? 'female' : 'male';
  const piece = assets ? pieceByName(assets, SPRITE_TYPE[kind], pieceName, genderStr) : null;
  if (!piece) {
    return (
      <span className="flex h-[72px] w-[72px] items-center justify-center rounded bg-neutral-800 text-lg text-neutral-500">
        ?
      </span>
    );
  }
  const b = piece.bounds;
  const atlasSize = assets!.meshSet.atlasSize;
  // Unity atlas bounds are BOTTOM-LEFT origin (the WebGL renderer samples with flipV);
  // CSS crops are top-left, so flip the y here or the crop lands on the wrong sprite.
  const yTop = atlasSize - b.y - b.h;
  return (
    <span
      aria-hidden="true"
      className="rounded bg-neutral-700/70"
      style={spriteStyle(
        { atlas: piece.atlas, x: b.x, y: yTop, w: b.w, h: b.h },
        { w: atlasSize, h: atlasSize },
        THUMB,
      )}
    />
  );
}

export function AppearanceGridDialog({
  title,
  kind,
  gender,
  current,
  gameData,
  assets,
  allowNone = false,
  onPick,
  onClose,
}: AppearanceGridDialogProps) {
  const [search, setSearch] = useState('');

  const options = useMemo(() => {
    // Drop the catalog's "null" placeholder pieces; the None card covers clearing.
    const base = hairOptions(gameData, kind, gender).filter((o) => o.value !== 'null');
    // The current value stays selectable even when outside the gender-filtered set
    // (special characters, opposite-gender pieces).
    if (current && !base.some((o) => o.value === current)) {
      base.unshift({ value: current, label: hairLabel(gameData, current), sortId: -1 });
    }
    const q = search.trim().toLowerCase();
    return q ? base.filter((o) => o.label.toLowerCase().includes(q)) : base;
  }, [gameData, kind, gender, current, search]);

  const cardClass = (selected: boolean): string =>
    `flex flex-col items-center gap-1 rounded border p-2 text-center ${
      selected
        ? 'border-amber-500 bg-amber-500/10'
        : 'border-neutral-800 bg-neutral-950 hover:border-neutral-600 hover:bg-neutral-900'
    }`;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_LARGE} p-5`}>
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <div className="flex items-center gap-3">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                aria-label={`Search ${title.toLowerCase()}`}
                className="w-48 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder-neutral-500"
              />
              <Dialog.Close
                aria-label="Close"
                className="rounded px-2 py-1 text-neutral-400 hover:text-neutral-100"
              >
                ✕
              </Dialog.Close>
            </div>
          </div>
          <Dialog.Description className="sr-only">
            Pick a piece from the grid to apply it.
          </Dialog.Description>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
              {allowNone && (
                <button
                  type="button"
                  onClick={() => {
                    onPick(null);
                    onClose();
                  }}
                  aria-pressed={current === null || current === ''}
                  className={cardClass(current === null || current === '')}
                >
                  <span className="flex h-[72px] w-[72px] items-center justify-center rounded bg-neutral-900 text-2xl text-neutral-600">
                    ∅
                  </span>
                  <span className="text-[11px] leading-tight text-neutral-300">None</span>
                </button>
              )}
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onPick(o.value);
                    onClose();
                  }}
                  aria-pressed={o.value === current}
                  title={o.label}
                  className={cardClass(o.value === current)}
                >
                  <PieceThumb assets={assets} kind={kind} pieceName={o.value} gender={gender} />
                  <span className="line-clamp-2 text-[11px] leading-tight text-neutral-300">
                    {o.label}
                  </span>
                </button>
              ))}
              {options.length === 0 && (
                <p className="col-span-full py-8 text-center text-sm text-neutral-500">
                  No pieces match the search.
                </p>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
