import { useEffect, useState, type ReactElement } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useVisualAssets } from '../hooks/useVisualAssets.ts';
import { renderDwellerThumbnail } from '../../render/dwellerThumbnail.ts';
import type { RenderableDweller } from '../../render/dwellerAppearance.ts';
import { ItemIcon } from './ItemIcon.tsx';
import { MODAL_MEDIUM } from '../lib/modalClasses.ts';
import { REPO_URL } from '../lib/links.ts';

// Credits: the shrine to the OG save editors this project stands on. Layout, outside-in:
// dweller (low, facing center) | ultracite crystal (raised) | OG links (center) - all on
// one centered row. The crystals are the real green junk Ultracite sprite; the dwellers
// render through the same Pixi pipeline as the roster thumbnails (standing figures; the
// pose mesh has no kneel, so they face the OGs instead). Text-only fallback while assets
// load or fail.

const OGS: ReadonlyArray<{ name: string; url: string; blurb: string }> = [
  {
    name: 'rakion99/shelter-editor',
    url: 'https://github.com/rakion99/shelter-editor',
    blurb: 'the original',
  },
  {
    name: 'erayerm/fs-save-editor',
    url: 'https://github.com/erayerm/fs-save-editor',
    blurb: 'which it inspired',
  },
];

/** Fixed looks for the two honouring dwellers (male left, female right). */
const WORSHIPPERS: ReadonlyArray<RenderableDweller> = [
  {
    gender: 2,
    isChild: false,
    hairName: '03',
    outfitName: 'jumpsuit',
    happinessValue: 100,
    hairColor: { r: 90, g: 60, b: 30 },
  },
  {
    gender: 1,
    isChild: false,
    hairName: '01',
    outfitName: 'jumpsuit',
    happinessValue: 100,
    hairColor: { r: 200, g: 160, b: 60 },
  },
];

export function CreditsDialog({ onClose }: { onClose: () => void }) {
  const { assets } = useVisualAssets();
  const [figures, setFigures] = useState<(string | null)[]>([null, null]);

  useEffect(() => {
    if (!assets) return;
    let cancelled = false;
    Promise.all(WORSHIPPERS.map((d) => renderDwellerThumbnail(d, assets).catch(() => null))).then(
      (urls) => {
        if (!cancelled) setFigures(urls);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [assets]);

  // The rendered figure faces slightly screen-RIGHT; mirror the right-hand one so BOTH face
  // the OG links in the center. Figures sit lower than the raised crystals (self-end).
  const figure = (index: 0 | 1): ReactElement => {
    const url = figures[index];
    return (
      <span className="flex h-28 w-24 items-end justify-center self-end">
        {url ? (
          <img
            src={url}
            alt=""
            aria-hidden="true"
            className={`h-28 w-auto ${index === 1 ? '-scale-x-100' : ''}`}
          />
        ) : (
          <span aria-hidden="true" className="text-5xl">
            {index === 0 ? '🚶' : '🚶‍♀️'}
          </span>
        )}
      </span>
    );
  };

  const crystal = (
    <span className="self-start pt-1">
      <ItemIcon type="junk" id="Ultracite" size={56} />
    </span>
  );

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_MEDIUM} p-6`}>
          <div className="flex items-start justify-between gap-3">
            <span aria-hidden="true" className="w-6" />
            <Dialog.Title className="flex-1 text-center text-lg font-semibold">
              Credits: the OGs
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded px-2 py-1 text-neutral-400 hover:text-neutral-100"
            >
              ✕
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Acknowledgments for the projects that inspired this editor.
          </Dialog.Description>

          {/* The shrine row: dweller | crystal | OG links | crystal | dweller. */}
          <div className="mx-auto mt-6 flex items-stretch justify-center gap-4">
            {figure(0)}
            {crystal}
            <div className="flex min-w-0 flex-col items-center justify-center gap-2 px-2 text-center">
              {OGS.map((og) => (
                <span key={og.url} className="flex flex-col leading-tight">
                  <a
                    href={og.url}
                    target="_blank"
                    rel="noreferrer"
                    className="whitespace-nowrap text-base font-medium text-amber-300 underline-offset-2 hover:underline"
                  >
                    {og.name}
                  </a>
                  <span className="text-xs text-neutral-400">({og.blurb})</span>
                </span>
              ))}
            </div>
            {crystal}
            {figure(1)}
          </div>

          <div className="mx-auto mt-6 max-w-xl space-y-2 text-center text-sm text-neutral-300">
            <p>
              This project was inspired by those earlier community save editors. If it were not for
              them, and for what their work revealed about the data inside these save files, there
              would not have been enough inspiration to build this project.
            </p>
            <p>
              This is an independent, from-scratch reimplementation; no code is copied from either,
              but the trail they blazed is the reason it exists.
            </p>
            <p className="text-xs text-neutral-400">
              Source for this editor:{' '}
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:underline"
              >
                {REPO_URL.replace('https://', '')}
              </a>
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
