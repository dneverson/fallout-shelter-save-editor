import { create } from 'zustand';

// Lightweight transient notifications (immediate actions "apply + toast + undo").
// A toast is a fire-and-forget message; the actual
// state change + undo are handled by the edit itself. Session-only - never persisted.

export type ToastTone = 'success' | 'info';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'success') =>
    set((state) => ({ toasts: [...state.toasts, { id: nextId++, message, tone }] })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper for non-component callers. */
export const pushToast = (message: string, tone?: ToastTone): void =>
  useToastStore.getState().push(message, tone);
