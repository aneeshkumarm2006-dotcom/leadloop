import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, CheckCircle2, AlertTriangle, Plug } from 'lucide-react';
import Button from '../ui/Button';
import * as emailService from '../../services/emailService';
import useToastStore from '../../store/toastStore';

/**
 * EmailAccountConnect — connect / disconnect a sending mailbox (F8.6).
 *
 * Per-user, per-workspace: "Connect Gmail" / "Connect Microsoft 365" buttons
 * that redirect to the provider consent screen, and a connected state showing
 * "Connected as X" with a Disconnect action. Sends and the SEND_EMAIL
 * automation route through the connected mailbox; with none connected, mail
 * falls back to the system sender.
 *
 * Props: workspaceId — the current workspace the mailbox is scoped to.
 */
const PROVIDERS = [
  { key: 'gmail', label: 'Gmail', blurbKey: 'pages.gmailBlurb' },
  { key: 'microsoft', label: 'Microsoft 365', blurbKey: 'pages.microsoftBlurb' },
];

const EmailAccountConnect = ({ workspaceId }) => {
  const { t } = useTranslation();
  const toast = useToastStore.getState();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(null); // provider key
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    emailService
      .listAccounts(workspaceId)
      .then(setAccounts)
      .catch((err) => setError(err?.response?.data?.error || t('pages.failedToLoadAccounts')))
      .finally(() => setLoading(false));
  }, [workspaceId, t]);

  useEffect(() => {
    reload();
  }, [reload]);

  const accountFor = (provider) => accounts.find((a) => a.provider === provider);

  const handleConnect = async (provider) => {
    if (!workspaceId) {
      toast.error?.(t('pages.selectWorkspaceFirst'));
      return;
    }
    setConnecting(provider);
    setError('');
    try {
      const url = await emailService.connectProvider(provider, workspaceId);
      // Hand off to the provider consent screen; it redirects back to the
      // public OAuth callback, which returns to /settings?tab=email.
      window.location.href = url;
    } catch (err) {
      setConnecting(null);
      setError(
        err?.response?.status === 503
          ? t('pages.oauthNotConfigured', { provider: provider === 'gmail' ? 'Gmail' : 'Microsoft' })
          : err?.response?.data?.error || t('pages.couldNotStartConnection')
      );
    }
  };

  const handleDisconnect = async (account) => {
    try {
      await emailService.disconnectAccount(account._id);
      toast.success?.(t('pages.mailboxDisconnected'));
      reload();
    } catch (err) {
      toast.error?.(err?.response?.data?.error || t('pages.couldNotDisconnect'));
    }
  };

  return (
    <div>
      <header className="mb-6">
        <h2 className="font-display font-bold text-[color:var(--color-text-primary)]" style={{ fontSize: 20 }}>
          {t('pages.emailConnection')}
        </h2>
        <p className="mt-1 font-body text-sm text-[color:var(--color-text-secondary)]">
          {t('pages.emailConnectionDescription')}
        </p>
      </header>

      {error && (
        <p className="font-body text-[12px] mb-4" style={{ color: 'var(--color-status-stuck)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="font-body" style={{ color: 'var(--color-text-muted)' }}>{t('pages.loading')}</p>
      ) : (
        <div className="flex flex-col gap-3" style={{ maxWidth: 560 }}>
          {PROVIDERS.map((p) => {
            const acc = accountFor(p.key);
            const isError = acc && acc.status === 'error';
            return (
              <div
                key={p.key}
                className="flex items-center gap-4"
                style={{
                  padding: 16,
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--color-bg-surface, #FFFFFF)',
                }}
              >
                <div
                  className="flex items-center justify-center shrink-0"
                  style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--color-bg-subtle)' }}
                >
                  <Mail size={20} style={{ color: 'var(--color-text-secondary)' }} aria-hidden="true" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="font-body font-semibold" style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>
                    {p.label}
                  </p>
                  {acc ? (
                    <p className="font-body flex items-center gap-1" style={{ fontSize: 12, color: isError ? 'var(--color-status-stuck)' : 'var(--color-status-done)' }}>
                      {isError ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                      {isError ? t('pages.reconnectNeeded') : t('pages.connectedAs', { mailbox: acc.defaultFrom || t('pages.yourMailbox') })}
                    </p>
                  ) : (
                    <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {t(p.blurbKey)}
                    </p>
                  )}
                </div>
                {acc ? (
                  <div className="flex items-center gap-2 shrink-0">
                    {isError && (
                      <Button variant="secondary" size="sm" onClick={() => handleConnect(p.key)} disabled={connecting === p.key}>
                        {t('pages.reconnect')}
                      </Button>
                    )}
                    <Button variant="danger" size="sm" onClick={() => handleDisconnect(acc)}>
                      {t('pages.disconnect')}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={Plug}
                    onClick={() => handleConnect(p.key)}
                    disabled={connecting === p.key}
                  >
                    {connecting === p.key ? t('pages.connecting') : t('pages.connectProvider', { provider: p.label })}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EmailAccountConnect;
