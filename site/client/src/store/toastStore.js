import { create } from 'zustand';

/**
 * toastStore — small global store for transient toast notifications.
 * See Stage 20.8 (error/success feedback).
 *
 * Shape: { id, type: 'error'|'success'|'info', message, duration }
 * Default duration is 4000ms. Pass 0 for persistent toasts.
 */

const DEFAULT_DURATION = 4000;

const useToastStore = create((set, get) => ({
  toasts: [],

  show: (message, options = {}) => {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    const toast = {
      id,
      type: options.type || 'info',
      message,
      duration: options.duration ?? DEFAULT_DURATION,
    };
    set((s) => ({ toasts: [...s.toasts, toast] }));

    if (toast.duration > 0) {
      setTimeout(() => {
        get().dismiss(id);
      }, toast.duration);
    }
    return id;
  },

  success: (message, options) =>
    get().show(message, { ...options, type: 'success' }),
  error: (message, options) =>
    get().show(message, { ...options, type: 'error' }),
  info: (message, options) =>
    get().show(message, { ...options, type: 'info' }),

  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  clear: () => set({ toasts: [] }),
}));

export default useToastStore;
