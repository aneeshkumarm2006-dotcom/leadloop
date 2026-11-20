import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, RefreshCw, AlertTriangle } from 'lucide-react';
import BrandLogo from './BrandLogo';
import Spinner from '../../ui/Spinner';
import { DialogShell, CloseButton, PrimaryButton, Notice, Pill, LINE, MUTED } from './AdsShared';
import { normalizeCheck, platformLogo, timeAgo, websiteLabel, websiteTagFound } from './adsHelpers';
import * as adConnect from '../../../services/adConnectService';

/**
 * Website check + activity. With a `website` it runs (or shows the last) site
 * check: tag, pixels, forms, consent. Always shows what was sent to the ad
 * platforms in the last 7 days. Without a website it is the activity view
 * ("View activity" on a platform card).
 */

const CHECK_LOGO = {
  tag: 'leadloop',
  meta_pixel: 'meta',
  google_tag: 'google-ads',
  tiktok_pixel: 'tiktok',
  forms: 'leadloop',
  consent: 'leadloop',
};

const PLATFORM_LABEL = { meta: 'Meta', google: 'Google Ads', tiktok: 'TikTok' };

const CheckStatus = ({ check, onInstall }) => {
  const { t } = useTranslation();
  if (check.status === 'ok') {
    return (
      <Pill tone="ok">
        <Check size={11} strokeWidth={3.5} aria-hidden="true" />
        {t('adsHub.check.working')}
      </Pill>
    );
  }
  if (check.status === 'missing' && check.id === 'tag' && onInstall) {
    return (
      <button
        type="button"
        onClick={onInstall}
        className="font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
        style={{ fontSize: 12.5, color: 'var(--color-status-working)', background: 'var(--color-status-working-bg)', padding: '6px 11px', borderRadius: 999, border: 'none', cursor: 'pointer' }}
      >
        {t('adsHub.check.install')}
      </button>
    );
  }
  if (check.status === 'missing') return <Pill tone="error">{t('adsHub.check.missing')}</Pill>;
  if (check.status === 'warn') return <Pill tone="warn">{t('adsHub.check.attention')}</Pill>;
  return <Pill tone="neutral">{t('adsHub.check.skipped')}</Pill>;
};

const activityText = (t, r) => {
  const platform = PLATFORM_LABEL[r.platform];
  const isNewLead = r.stage === 'lead' || r.status === 'received' || !r.stage;
  if (platform && !isNewLead) {
    const stage = r.stage === 'customer' ? t('adsHub.activity.customer') : t('adsHub.activity.qualified');
    if (r.status === 'failed' || r.status === 'dead') return t('adsHub.activity.failed', { platform, stage });
    if (r.status === 'skipped') return t('adsHub.activity.skipped', { platform, stage });
    if (r.status === 'pending') return t('adsHub.activity.pending', { platform, stage });
    return t('adsHub.activity.sent', { platform, stage });
  }
  const source = t(`adsHub.activity.sources.${r.platform}`, { defaultValue: r.platform || t('adsHub.activity.sources.website_snippet') });
  return t('adsHub.activity.newLead', { source });
};

const SiteCheckDialog = ({ workspaceId, overview, website, onClose, onInstall, onChanged }) => {
  const { t } = useTranslation();
  const hasSite = !!website;

  // runToken > 0 triggers a check; start one automatically when there is no saved result.
  const [runToken, setRunToken] = useState(hasSite && !website.lastCheck ? 1 : 0);
  const [result, setResult] = useState(hasSite ? website.lastCheck : null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(hasSite && !website.lastCheck);

  useEffect(() => {
    if (!hasSite || runToken === 0) return undefined;
    let alive = true;
    adConnect
      .checkWebsite(workspaceId, { connectionId: website.connectionId })
      .then((r) => {
        if (!alive) return;
        const c = normalizeCheck(r);
        if (c) {
          setResult(c);
          setError('');
        } else {
          setError(t('adsHub.check.error'));
        }
        setRunning(false);
        onChanged();
      })
      .catch((err) => {
        if (!alive) return;
        setError(adConnect.errorStatus(err) === 429 ? t('adsHub.check.rateLimited') : adConnect.errorMessage(err, t('adsHub.check.error')));
        setRunning(false);
      });
    return () => {
      alive = false;
    };
    // `website.connectionId` is stable for the dialog's lifetime; onChanged is a parent callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runToken]);

  const recheck = () => {
    setRunning(true);
    setError('');
    setRunToken((n) => n + 1);
  };

  const tagCheck = result?.checks.find((c) => c.id === 'tag');
  const tracking = tagCheck ? tagCheck.status === 'ok' : websiteTagFound(website);
  const site = result?.url ? (() => { try { return new URL(result.url).hostname; } catch { return websiteLabel(website); } })() : websiteLabel(website);
  const checkedWhen = result?.checkedAt ? timeAgo(result.checkedAt) : '';

  let tone = 'pine';
  let title = t('adsHub.check.activityTitle');
  let subtitle = t('adsHub.check.activitySubtitle');
  if (hasSite) {
    if (running) {
      tone = 'cream';
      title = t('adsHub.check.running');
      subtitle = site;
    } else if (error && !result) {
      tone = 'cream';
      title = t('adsHub.check.failedTitle');
      subtitle = site;
    } else if (tracking) {
      title = t('adsHub.check.trackingTitle');
      subtitle = [site, checkedWhen && t('adsHub.check.checked', { when: checkedWhen })].filter(Boolean).join(' · ');
    } else {
      tone = 'cream';
      title = t('adsHub.check.notFoundTitle');
      subtitle = [site, checkedWhen && t('adsHub.check.checked', { when: checkedWhen })].filter(Boolean).join(' · ');
    }
  }
  const dark = tone === 'pine';

  const header = (
    <div
      className="flex items-center gap-3 sm:gap-[18px] px-5 sm:px-7 shrink-0 flex-wrap"
      style={{ paddingTop: 24, paddingBottom: 20, background: dark ? 'var(--color-pine)' : 'var(--color-status-working-bg)', color: dark ? 'var(--color-pine-text)' : 'var(--color-text-primary)' }}
    >
      <div
        className="hidden sm:flex items-center justify-center shrink-0"
        style={{ width: 56, height: 56, borderRadius: 999, background: dark ? 'var(--color-pine-gold)' : '#fff', color: dark ? 'var(--color-pine)' : 'var(--color-status-working)' }}
      >
        {running ? <Spinner size={26} /> : dark ? <Check size={28} strokeWidth={3} aria-hidden="true" /> : <AlertTriangle size={26} aria-hidden="true" />}
      </div>
      <div className="flex-1 min-w-[160px]">
        <h2 className="font-display font-bold" style={{ margin: 0, fontSize: 22 }}>{title}</h2>
        {subtitle && <p style={{ margin: '3px 0 0', fontSize: 13.5, color: dark ? 'var(--color-pine-text-2)' : 'var(--color-text-secondary)' }}>{subtitle}</p>}
      </div>
      {hasSite && (
        <button
          type="button"
          onClick={recheck}
          disabled={running}
          className="inline-flex items-center gap-[7px] font-semibold disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-pine-gold)]"
          style={{
            height: 40,
            padding: '0 14px',
            borderRadius: 10,
            border: dark ? '1px solid rgba(237,232,218,.25)' : '1px solid var(--color-border-strong)',
            background: dark ? 'transparent' : '#fff',
            color: 'inherit',
            fontSize: 13,
            cursor: running ? 'wait' : 'pointer',
          }}
        >
          <RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" />
          {t('adsHub.check.again')}
        </button>
      )}
      <CloseButton onClose={onClose} label={t('adsHub.common.close')} dark={dark} />
    </div>
  );

  const stats = [
    { key: 'leads', label: t('adsHub.check.leadsCaptured'), value: overview.sentLast7d.leadsCaptured, logo: null },
    overview.meta.status === 'ready' && { key: 'meta', label: t('adsHub.check.toPlatform', { platform: 'Meta' }), value: overview.sentLast7d.meta, logo: 'meta' },
    overview.google.status === 'ready' && { key: 'google', label: t('adsHub.check.toPlatform', { platform: 'Google' }), value: overview.sentLast7d.google, logo: 'google-ads' },
    overview.tiktok.status === 'ready' && { key: 'tiktok', label: t('adsHub.check.toPlatform', { platform: 'TikTok' }), value: overview.sentLast7d.tiktok, logo: 'tiktok' },
  ].filter(Boolean);

  return (
    <DialogShell
      title={title}
      onClose={onClose}
      header={header}
      footer={
        <>
          <span className="flex-1 min-w-[180px]" style={{ fontSize: 12.5, color: MUTED }}>{t('adsHub.check.hourly')}</span>
          <PrimaryButton onClick={onClose}>{t('adsHub.common.done')}</PrimaryButton>
        </>
      }
    >
      {hasSite && (
        <div className="flex flex-col gap-[9px]" aria-live="polite" aria-busy={running || undefined}>
          <span className="font-bold" style={{ fontSize: 13.5 }}>{t('adsHub.check.found')}</span>
          {error && <Notice tone="error">{error}</Notice>}
          {running && !result ? (
            <ul className="m-0 p-0 list-none" style={{ border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden' }}>
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex items-center gap-3" style={{ padding: '12px 14px', borderTop: i ? `1px solid ${LINE}` : 'none' }}>
                  <span className="skeleton" style={{ width: 24, height: 22, borderRadius: 6 }} />
                  <span className="flex-1"><span className="skeleton block" style={{ height: 12, width: '45%', borderRadius: 4 }} /><span className="skeleton block" style={{ height: 10, width: '70%', marginTop: 6, borderRadius: 4 }} /></span>
                </li>
              ))}
            </ul>
          ) : result && result.checks.length > 0 ? (
            <ul className="m-0 p-0 list-none" style={{ border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden', opacity: running ? 0.6 : 1 }}>
              {result.checks.map((c, i) => (
                <li key={c.id} className="flex items-center gap-3 flex-wrap sm:flex-nowrap" style={{ padding: '12px 14px', borderTop: i ? `1px solid ${LINE}` : 'none' }}>
                  <span className="inline-flex items-center justify-center" style={{ width: 24, height: 22 }}>
                    <BrandLogo name={CHECK_LOGO[c.id] || 'leadloop'} size={CHECK_LOGO[c.id] === 'meta' ? 14 : 22} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="font-bold">{c.title || t(`adsHub.check.titles.${c.id}`, { defaultValue: c.id })}</span>
                    {c.detail && (
                      <>
                        <br />
                        <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{c.detail}</span>
                      </>
                    )}
                  </span>
                  <CheckStatus check={c} onInstall={() => onInstall(website.connectionId)} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-[9px]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-bold" style={{ fontSize: 13.5 }}>{t('adsHub.check.sentTitle')}</span>
          <span style={{ fontSize: 12.5, color: MUTED }}>{t('adsHub.check.last7')}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {stats.map((s) => (
            <div key={s.key} style={{ borderRadius: 14, background: 'var(--color-bg-input)', border: `1px solid ${LINE}`, padding: 14 }}>
              <div className="flex items-center gap-1.5" style={{ fontSize: 12, color: MUTED }}>
                {s.logo && <BrandLogo name={s.logo} size={s.logo === 'meta' ? 12 : 13} />}
                {s.label}
              </div>
              <div className="font-display font-bold" style={{ fontSize: 26, marginTop: 4 }}>{s.value}</div>
            </div>
          ))}
        </div>
        {overview.recent.length === 0 ? (
          <p style={{ margin: '6px 0 0', fontSize: 13, color: MUTED }}>{t('adsHub.check.noActivity')}</p>
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col">
            {overview.recent.map((r, i) => (
              <li key={i} className="flex items-center gap-2.5" style={{ padding: '10px 2px', borderBottom: `1px solid ${LINE}`, fontSize: 13 }}>
                <span className="inline-flex items-center justify-center" style={{ width: 18 }}>
                  <BrandLogo name={platformLogo(r.platform)} size={platformLogo(r.platform) === 'meta' ? 12 : 16} />
                </span>
                <span className="flex-1 min-w-0">
                  <strong>{r.leadName || t('adsHub.activity.aLead')}</strong>{' '}
                  <span style={{ color: 'var(--color-text-secondary)' }}>{activityText(t, r)}</span>
                </span>
                <span style={{ color: MUTED, fontSize: 12, whiteSpace: 'nowrap' }}>{timeAgo(r.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DialogShell>
  );
};

export default SiteCheckDialog;
