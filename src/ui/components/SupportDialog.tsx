import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { MODAL_SMALL } from '../lib/modalClasses.ts';
import {
  BUYMEACOFFEE_URL,
  CASHAPP_URL,
  PAYPAL_URL,
  SPONSORS_URL,
  STRIPE_URL,
  VENMO_URL,
} from '../lib/links.ts';

// Support dialog: a stack of donation links, each styled to match the destination
// service's own button branding so users recognize where each link goes at a glance.
// The Stripe button only renders once STRIPE_URL is filled in (links.ts).

/** Shared shell for every service button: full-width pill, brand look via className/style. */
function ServiceLink({
  href,
  label,
  className,
  children,
}: {
  href: string;
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className={`flex h-11 w-full items-center justify-center gap-2 rounded-full text-base font-semibold transition-opacity hover:opacity-90 ${className}`}
    >
      {children}
    </a>
  );
}

/** GitHub Sponsors heart, pink like on github.com. */
function SponsorHeart() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-[#db61a2]">
      <path d="M8 14.25 6.85 13.2C2.7 9.44.9 7.79.9 5.5.9 3.64 2.36 2.2 4.2 2.2c1.04 0 2.05.49 2.7 1.26L8 4.75l1.1-1.29c.65-.77 1.66-1.26 2.7-1.26 1.84 0 3.3 1.44 3.3 3.3 0 2.29-1.8 3.94-5.95 7.7L8 14.25z" />
    </svg>
  );
}

export function SupportDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className={`${MODAL_SMALL} p-6`}>
          <div className="flex items-start justify-between gap-3">
            <span aria-hidden="true" className="w-6" />
            <Dialog.Title className="flex-1 text-center text-lg font-semibold">
              Support this project
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded px-2 py-1 text-neutral-400 hover:text-neutral-100"
            >
              ✕
            </Dialog.Close>
          </div>

          <Dialog.Description className="mt-3 text-center text-sm text-neutral-300">
            Thanks for using this tool! If you feel like supporting this project and future
            projects, please feel free to send anything through any link below. A little goes a long
            way.
          </Dialog.Description>

          <div className="mt-5 flex flex-col gap-3">
            {STRIPE_URL && (
              <ServiceLink href={STRIPE_URL} label="Donate via Stripe" className="bg-[#635BFF]">
                <span className="text-white">Stripe</span>
              </ServiceLink>
            )}

            <ServiceLink href={PAYPAL_URL} label="Donate via PayPal" className="bg-[#FFC439]">
              <span className="italic" style={{ fontFamily: 'Verdana, sans-serif' }}>
                <span className="font-bold text-[#003087]">Pay</span>
                <span className="font-bold text-[#009CDE]">Pal</span>
              </span>
            </ServiceLink>

            <ServiceLink href={VENMO_URL} label="Donate via Venmo" className="bg-[#008CFF]">
              <span className="font-bold lowercase tracking-tight text-white">venmo</span>
            </ServiceLink>

            <ServiceLink href={CASHAPP_URL} label="Donate via Cash App" className="bg-[#00D632]">
              <span className="font-bold text-white">
                <span aria-hidden="true">$ </span>Cash App
              </span>
            </ServiceLink>

            <ServiceLink
              href={BUYMEACOFFEE_URL}
              label="Donate via Buy Me a Coffee"
              className="bg-[#FFDD00] text-neutral-900"
            >
              <span aria-hidden="true">☕</span>
              <span className="font-bold">Buy me a coffee</span>
            </ServiceLink>

            <ServiceLink
              href={SPONSORS_URL}
              label="Sponsor on GitHub"
              className="border border-[#30363d] bg-[#21262d] text-[#c9d1d9]"
            >
              <SponsorHeart />
              <span className="font-semibold">Sponsor on GitHub</span>
            </ServiceLink>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
