import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { PageBody } from '../layout/PageHeader';
import Spinner from '../ui/Spinner';
import { SkeletonBlock } from '../ui/Skeleton';
import BrandLogo from './ads/BrandLogo';
import { Notice, SecondaryButton } from './ads/AdsShared';
import * as emailService from '../../services/emailService';
import useToastStore from '../../store/toastStore';
import { SettingsHeader, SettingsCard, CardTitle, CardText, CheckList, MainAsideGrid } from './SettingsLayout';

/**
 * EmailAccountConnect — Settings → Email connection (F8.6).
 *
 * Per-user, per-workspace: Google / Microsoft provider cards that redirect to
 * the provider consent screen, and a connected state showing "Connected as X"
 * with Disconnect (and Reconnect when the token broke). Sends and the
 * SEND_EMAIL automation route through the connected mailbox; with none
 * connected, mail falls back to the system sender.
 *
 * The OAuth return (?email=connected|error) is toasted by SettingsPage.
 *
 * Props: workspaceId — the current workspace the mailbox is scoped to.
 */
const PROVIDERS = [
  { key: 'gmail', label: 'Gmail', logo: 'google-g', nameKey: 'settings.email.gmailName', descKey: 'settings.email.gmailDesc', ctaKey: 'settings.email.signInGoogle', border: '#747775' },
  { key: 'microsoft', label: 'Microsoft 365', logo: 'microsoft', nameKey: 'settings.email.microsoftName', descKey: 'settings.email.microsoftDesc', ctaKey: 'settings.email.signInMicrosoft', border: '#8C8C8C' },
];

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]';

const ProviderCard = ({ p, account, connecting, onConnect, onDisconnect }) => {
  const { t } = useTranslation();
  const isError = account && account.status === 'error';
  const titleId = `email-provider-${p.key}`;
  return (
    <SettingsCard as="article" aria-labelledby={titleId} style={{ padding: 22, gap: 12 }}>
      <BrandLogo name={p.logo} size={34} />
      <div>
        <h3 id={titleId} className="font-display font-bold" style={{ margin: 0, fontSize: 17 }}>{t(p.nameKey)}</h3>
        {account ? (
          <p
            className="font-body flex items-center gap-1.5 break-all"
            style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 600, color: isError ? 'var(--color-status-stuck)' : 'var(--color-status-done)' }}
          >
            {isError ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
            {isError ? t('pages.reconnectNeeded') : t('pages.connectedAs', { mailbox: account.defaultFrom || t('pages.yourMailbox') })}
          </p>
        ) : (
          <CardText style={{ marginTop: 4, fontSize: 13 }}>{t(p.descKey)}</CardText>
        )}
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        {account ? (
          <>
            {isError && (
              <SecondaryButton onClick={() => onConnect(p.key)} loading={connecting === p.key}>
                {t('pages.reconnect')}
              </SecondaryButton>
            )}
            <button
              type="button"
              onClick={() => onDisconnect(account)}
              className={`inline-flex items-center justify-center font-body font-bold hover:bg-[color:var(--color-status-stuck-bg)] ${focusRing}`}
              style={{ height: 42, padding: '0 16px', borderRadius: 10, border: '1px solid var(--color-status-stuck)', background: '#fff', color: 'var(--color-status-stuck)', fontSize: 14, cursor: 'pointer' }}
            >
              {t('pages.disconnect')}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onConnect(p.key)}
            disabled={!!connecting}
            aria-busy={connecting === p.key || undefined}
            className={`w-full inline-flex items-center justify-center gap-2.5 font-body font-bold hover:bg-[#F8F9FA] disabled:opacity-60 disabled:cursor-not-allowed ${focusRing}`}
            style={{ height: 42, borderRadius: 10, border: `1px solid ${p.border}`, background: '#fff', color: '#1F1F1F', fontSize: 14, cursor: 'pointer' }}
          >
            {connecting === p.key ? <Spinner size="sm" /> : <BrandLogo name={p.logo} size={18} />}
            {connecting === p.key ? t('pages.connecting') : t(p.ctaKey)}
          </button>
        )}
      </div>
    </SettingsCard>
  );
};

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
      .then((list) => setAccounts(Array.isArray(list) ? list : []))
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

  const connected = PROVIDERS.map((p) => accountFor(p.key)).filter(Boolean);
  const healthy = connected.find((a) => a.status !== 'error');
  const broken = !healthy && connected.length > 0;

  let status;
  if (healthy) {
    status = { dot: 'var(--color-status-done-solid)', title: t('settings.email.sendingAs', { mailbox: healthy.defaultFrom || t('pages.yourMailbox') }), body: t('settings.email.sendingAsBody') };
  } else if (broken) {
    status = { dot: 'var(--color-status-stuck-solid)', title: t('settings.email.needsReconnectTitle'), body: t('settings.email.needsReconnectBody') };
  } else {
    status = { dot: 'var(--color-status-notstarted-solid)', title: t('settings.email.noMailboxTitle'), body: t('settings.email.noMailboxBody') };
  }

  return (
    <>
      <SettingsHeader tab="email" title={t('pages.emailConnection')} subtitle={t('settings.email.subtitle')} />
      <PageBody>
        <MainAsideGrid>
          <section className="flex flex-col gap-3.5 min-w-0" aria-labelledby="email-providers-title">
            <CardTitle id="email-providers-title">{t('settings.email.chooseProvider')}</CardTitle>
            {error && (
              <Notice tone="error" action={!loading ? <SecondaryButton size="sm" onClick={() => { setError(''); reload(); }}>{t('adsHub.common.retry')}</SecondaryButton> : null}>
                {error}
              </Notice>
            )}
            {loading ? (
              <div role="status" aria-live="polite" className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
                <span className="sr-only">{t('pages.loading')}</span>
                <SkeletonBlock height={210} borderRadius={18} />
                <SkeletonBlock height={210} borderRadius={18} />
              </div>
            ) : (
              <>
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
                  {PROVIDERS.map((p) => (
                    <ProviderCard
                      key={p.key}
                      p={p}
                      account={accountFor(p.key)}
                      connecting={connecting}
                      onConnect={handleConnect}
                      onDisconnect={handleDisconnect}
                    />
                  ))}
                </div>
                <SettingsCard role="status" className="items-center" style={{ padding: '18px 22px', gap: 14, flexDirection: 'row' }}>
                  <span aria-hidden="true" className="shrink-0" style={{ width: 10, height: 10, borderRadius: 999, background: status.dot }} />
                  <div className="flex-1 min-w-0 font-body">
                    <div className="font-bold break-all">{status.title}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{status.body}</div>
                  </div>
                </SettingsCard>
              </>
            )}
          </section>

          <SettingsCard as="aside" aria-labelledby="email-aside-title" style={{ padding: 22, gap: 12 }}>
            <CardTitle id="email-aside-title" size={17}>{t('settings.email.asideTitle')}</CardTitle>
            <CheckList items={[t('settings.email.aside1'), t('settings.email.aside2'), t('settings.email.aside3')]} />
            <p className="font-body" style={{ margin: '6px 0 0', paddingTop: 12, borderTop: '1px solid #EFE8DA', fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
              {t('settings.email.asideFoot')}
            </p>
          </SettingsCard>
        </MainAsideGrid>
      </PageBody>
    </>
  );
};

export default EmailAccountConnect;
