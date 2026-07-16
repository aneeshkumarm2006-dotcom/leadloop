import { createPortal } from 'react-dom';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import useToastStore from '../../store/toastStore';

/**
 * ToastContainer — renders all active toasts bottom-right.
 * See Stage 20.8. Uses aria-live="polite" so screen readers announce
 * new toasts without interrupting the user.
 */

const TYPE_STYLES = {
  success: {
    icon: CheckCircle,
    iconColor: 'var(--color-status-done)',
    bg: 'var(--color-status-done-bg)',
    border: 'var(--color-status-done)',
  },
  error: {
    icon: AlertCircle,
    iconColor: 'var(--color-status-stuck)',
    bg: 'var(--color-status-stuck-bg)',
    border: 'var(--color-status-stuck)',
  },
  info: {
    icon: Info,
    iconColor: 'var(--color-accent)',
    bg: 'var(--color-accent-light)',
    border: 'var(--color-accent)',
  },
};

const Toast = ({ toast, onDismiss }) => {
  const styles = TYPE_STYLES[toast.type] || TYPE_STYLES.info;
  const Icon = styles.icon;

  return (
    <div
      role="status"
      className="flex items-start gap-3 bg-white overflow-hidden"
      style={{
        width: 360,
        maxWidth: 'calc(100vw - 32px)',
        padding: '12px 14px',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        borderLeft: `4px solid ${styles.border}`,
        background: styles.bg,
        animation: 'macan-toast-enter 200ms ease-out',
      }}
    >
      <Icon
        size={18}
        color={styles.iconColor}
        aria-hidden="true"
        className="shrink-0 mt-0.5"
      />
      <p
        className="flex-1 font-body text-[13px] text-[color:var(--color-text-primary)]"
        style={{ lineHeight: 1.4 }}
      >
        {toast.message}
      </p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)]"
        style={{ width: 22, height: 22 }}
      >
        <X size={14} color="var(--color-text-secondary)" aria-hidden="true" />
      </button>
    </div>
  );
};

const ToastContainer = () => {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  const node = (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed z-[60] flex flex-col gap-2 pointer-events-none"
      style={{
        bottom: 24,
        right: 24,
        left: 'auto',
      }}
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onDismiss={dismiss} />
        </div>
      ))}

      <style>{`
        @keyframes macan-toast-enter {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 640px) {
          [aria-live="polite"].fixed { left: 16px !important; right: 16px !important; }
        }
      `}</style>
    </div>
  );

  return createPortal(node, document.body);
};

export default ToastContainer;
