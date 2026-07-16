import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Modal — centered panel over a 40% dark overlay.
 * See Macan_Design.md Section 6.13.
 *
 * Props: isOpen, onClose, title, children, footer, maxWidth (default 480)
 *
 * Behaviour:
 *   - ESC closes
 *   - Click on overlay closes
 *   - Focus trap within the panel
 *   - Scroll lock on <body> while open
 *   - Scale (0.95 → 1) + fade-in 200ms on open
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = 480,
  closeOnOverlayClick = true,
  ariaLabel,
}) => {
  const panelRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      } else if (e.key === 'Tab') {
        // Simple focus trap
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = panel.querySelectorAll(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Scroll lock + initial focus management
  useEffect(() => {
    if (!isOpen) return undefined;

    previouslyFocusedRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus inside the modal
    const t = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll(FOCUSABLE_SELECTOR);
      (focusable[0] || panel).focus();
    }, 10);

    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = previousOverflow;
      if (
        previouslyFocusedRef.current &&
        typeof previouslyFocusedRef.current.focus === 'function'
      ) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOverlayMouseDown = (e) => {
    if (!closeOnOverlayClick) return;
    // Only close if the click actually originated on the overlay itself
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  };

  const node = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || title || 'Dialog'}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onMouseDown={handleOverlayMouseDown}
      style={{
        background: 'var(--color-overlay)',
        animation: 'macan-modal-fade 200ms ease-out',
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative w-full bg-white outline-none flex flex-col"
        style={{
          maxWidth,
          maxHeight: 'calc(100vh - 2rem)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          animation: 'macan-modal-scale 200ms ease-out',
        }}
      >
        {/* Header */}
        {(title || onClose) && (
          <div
            className="flex items-center justify-between px-6 shrink-0"
            style={{
              height: 60,
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            {title && (
              <h2
                className="font-display font-semibold text-[color:var(--color-text-primary)]"
                style={{ fontSize: 18 }}
              >
                {title}
              </h2>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
                style={{ width: 32, height: 32 }}
              >
                <X size={18} color="var(--color-text-secondary)" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-5 flex-1 min-h-0 overflow-y-auto">{children}</div>

        {/* Footer */}
        {footer && (
          <div
            className="flex items-center justify-end gap-3 px-6 shrink-0"
            style={{
              height: 68,
              borderTop: '1px solid var(--color-border)',
            }}
          >
            {footer}
          </div>
        )}
      </div>

      <style>{`
        @keyframes macan-modal-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes macan-modal-scale {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );

  return createPortal(node, document.body);
};

export default Modal;
