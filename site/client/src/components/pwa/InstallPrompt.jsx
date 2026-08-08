import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, X } from 'lucide-react';

/**
 * InstallPrompt — a slim, dismissible banner that offers to install LeadLoop as
 * an app. It only appears when the browser fires `beforeinstallprompt` (Android
 * / desktop Chromium) AND the app isn't already installed. Dismissal is
 * remembered so we never nag. iOS (no beforeinstallprompt) is out of scope here
 * — Safari installs via its Share → Add to Home Screen menu.
 */

const DISMISS_KEY = 'leadloop_pwa_install_dismissed';

const isStandalone = () =>
  (typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && navigator.standalone === true);

const InstallPrompt = () => {
  const { t } = useTranslation();
  const [deferred, setDeferred] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return undefined;
    if (localStorage.getItem(DISMISS_KEY) === '1') return undefined;

    const onBeforeInstall = (e) => {
      e.preventDefault(); // keep the event so we can trigger it from our button
      setDeferred(e);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
      localStorage.setItem(DISMISS_KEY, '1');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* user dismissed the native sheet */
    }
    setDeferred(null);
    setVisible(false);
  };

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, '1');
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label={t('pwa.installTitle', 'Install LeadLoop')}
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'max(16px, env(safe-area-inset-bottom))',
        zIndex: 1000,
        width: 'min(440px, calc(100vw - 24px))',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg-surface, #fff)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 12px 32px rgba(0,0,0,.18)',
      }}
    >
      <span
        className="inline-flex items-center justify-center"
        style={{ width: 38, height: 38, flex: '0 0 auto', borderRadius: 10, background: 'var(--color-accent-subtle, rgba(62,107,78,.14))', color: 'var(--color-accent)' }}
      >
        <Download size={19} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-heading" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text-primary)' }}>
          {t('pwa.installTitle', 'Install LeadLoop')}
        </div>
        <div className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
          {t('pwa.installBody', 'Add it to your home screen for one-tap access, even offline.')}
        </div>
      </div>
      <button
        type="button"
        onClick={install}
        className="font-body"
        style={{
          flex: '0 0 auto',
          fontSize: 13,
          fontWeight: 600,
          padding: '8px 14px',
          borderRadius: 'var(--radius-md)',
          border: 'none',
          background: 'var(--color-accent)',
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        {t('pwa.install', 'Install')}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('common.dismiss', 'Dismiss')}
        style={{ flex: '0 0 auto', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 4 }}
      >
        <X size={16} />
      </button>
    </div>
  );
};

export default InstallPrompt;
