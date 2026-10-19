import { useState } from 'react';

const YT_URL = 'https://youtu.be/4EcW8tpcF2g';
const EMBED_URL = 'https://www.youtube-nocookie.com/embed/4EcW8tpcF2g';

interface SeasonPassVideoProps {
  /** Optional class name for the wrapper */
  className?: string;
  /** Whether the video starts collapsed (defaults to false / open) */
  defaultOpen?: boolean;
}

export function SeasonPassVideo({ className = '', defaultOpen = true }: SeasonPassVideoProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      className={`mb-6 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/60 shadow-lg backdrop-blur-sm transition-all ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800/80 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium tracking-wide text-amber-400">
            <svg className="h-3 w-3 fill-amber-400" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            VIDEO GUIDE
          </span>
          <span className="text-xs font-medium text-neutral-200 sm:text-sm">
            How to Collect ALL Season Rewards in Fallout Shelter
          </span>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={YT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-neutral-400 transition-colors hover:text-amber-400"
            title="Open video on YouTube"
          >
            <span>Open in YouTube</span>
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>

          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="flex items-center gap-1 rounded border border-neutral-800 bg-neutral-800/50 px-2 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
            aria-expanded={isOpen}
            aria-label={isOpen ? 'Hide video' : 'Show video'}
          >
            <span>{isOpen ? 'Hide' : 'Show'}</span>
            <svg
              className={`h-3 w-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="p-3 sm:p-4">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-neutral-800/80 bg-black shadow-inner">
            <iframe
              className="h-full w-full border-0"
              src={EMBED_URL}
              title="How to Collect ALL Season Rewards in Fallout Shelter"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              loading="lazy"
            />
          </div>
        </div>
      )}
    </div>
  );
}
