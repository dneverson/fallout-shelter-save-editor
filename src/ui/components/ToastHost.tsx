import { useEffect } from 'react';
import { useToastStore, type Toast } from '../../state/toastStore.ts';

// Bottom-right toast stack with auto-dismiss. `aria-live="polite"` so
// screen readers announce each message without stealing focus.

const DISMISS_MS = 3200;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const tone =
    toast.tone === 'success'
      ? 'border-emerald-700 bg-emerald-950/90 text-emerald-200'
      : 'border-sky-700 bg-sky-950/90 text-sky-200';

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 rounded border px-3 py-2 text-sm shadow-lg ${tone}`}
    >
      <span>{toast.message}</span>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        className="ml-auto text-neutral-400 hover:text-neutral-100"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    // z-[60]: above modals (z-50, see modalClasses.ts) - dialogs that stay open across
    // adds (e.g. storage's Add items) rely on toasts for feedback, and Radix portals
    // mount after this host in the DOM, so an equal z-index would paint over the toasts.
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-72 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  );
}
