import type { ReactNode } from 'react';
import { InfoTooltip } from '../InfoTooltip.tsx';

// Shared card shell for the vault-settings grid (grouped cards, no expand/collapse).
// Title + optional help/description/right-aligned action, then content.
export function VaultCard({
  title,
  help,
  description,
  action,
  children,
}: {
  title: string;
  help?: ReactNode;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-200">
            {title}
            {help && <InfoTooltip text={help} />}
          </h3>
          {description && <p className="mt-0.5 text-xs text-neutral-400">{description}</p>}
        </div>
        {action}
      </header>
      <div className="mt-3">{children}</div>
    </section>
  );
}
