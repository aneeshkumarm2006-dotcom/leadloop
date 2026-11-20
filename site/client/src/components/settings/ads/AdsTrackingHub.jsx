import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, Globe, MoreHorizontal, RefreshCw } from 'lucide-react';
import BrandLogo from './BrandLogo';
import MetaConnectDialog from './MetaConnectDialog';
import GoogleConnectDialog from './GoogleConnectDialog';
import TikTokConnectDialog from './TikTokConnectDialog';
import WebsiteInstallDialog from './WebsiteInstallDialog';
import SiteCheckDialog from './SiteCheckDialog';
import { Pill, Tick, SignInButton, SecondaryButton, Notice, LockNote, Switch, LINE, MUTED } from './AdsShared';
import {
  normalizeOverview, websiteTagFound, websiteLabel, timeAgo, tail, formatCustomerId, asList,
  peekResume, rememberResume, takeResume,
} from './adsHelpers';
import AdConversionsSettings from '../AdConversionsSettings';
import { SettingsHeader } from '../SettingsLayout';
import { PageBody } from '../../layout/PageHeader';
import Modal from '../../ui/Modal';
import Button from '../../ui/Button';
import { SkeletonBlock } from '../../ui/Skeleton';
import * as adConnect from '../../../services/adConnectService';
import { getBoards } from '../../../services/boardService';
import { updateConnection } from '../../../services/leadConnectionService';
import useToastStore from '../../../store/toastStore';

/**
 * AdsTrackingHub — Settings → "Ads & tracking". Connect Meta / Google Ads /
 * TikTok by signing in, install one website tag, see lead sources and what was
 * sent back to the ad platforms. The original manual settings
 * (AdConversionsSettings: stage rules, event names, manual IDs) live in the
 * collapsible Advanced section at the bottom; the stage rules are required.
 *
 * OAuth round-trip: `?connect=<platform>` opens that platform's dialog at
 * "choose accounts"; `?connect_error=<msg>` shows a toast. Both are stripped
 * from the URL once read.
 */

const card = {
  background: 'var(--color-bg-surface)',
  borderRadius: 18,
  boxShadow: 'var(--shadow-card)',
};
const BRAND_TILE = { meta: '#F1F6FF', google: '#F4F7FE', tiktok: '#F2F2F2' };
const NOTIFY_KEY = 'leadloop.adsHub.notify';
const CONNECT_ERRORS = ['cancelled', 'expired', 'not_allowed', 'failed', 'not_configured'];

const readNotify = () => {
  try {
    const v = JSON.parse(localStorage.getItem(NOTIFY_KEY) || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

const initialDialogFromUrl = (params) => {
  const c = params.get('connect');
  if (!adConnect.PLATFORMS.includes(c)) return null;
  const resume = peekResume();
  if (c === 'google' && resume?.dialog === 'website') {
    return { type: 'website', builder: typeof resume.builder === 'string' ? resume.builder : 'gtm', connectionId: typeof resume.connectionId === 'string' ? resume.connectionId : '' };
  }
  return { type: c, step: 'accounts' };
};

/* ------------------------------ Section header ------------------------------ */

const SectionHead = ({ title, sub, action }) => (
  <div className="flex items-baseline justify-between gap-3 flex-wrap">
    <h2 className="font-display font-bold" style={{ margin: 0, fontSize: 21 }}>{title}</h2>
    <div className="flex items-center gap-3 flex-wrap">
      {sub && <span style={{ fontSize: 13, color: MUTED }}>{sub}</span>}
      {action}
    </div>
  </div>
);

/* ------------------------------ Progress strip ------------------------------ */

/** Full-width dark strip: ring + "Tracking setup" on the left, step chips across. */
const ProgressStrip = ({ steps }) => {
  const { t } = useTranslation();
  const done = steps.filter((s) => s.done).length;
  const total = steps.length;
  const left = total - done;
  const circ = 2 * Math.PI * 27;
  const dash = total ? (done / total) * circ : 0;
  return (
    <section
      aria-label={t('adsHub.progress.title')}
      className="flex items-center flex-wrap"
      style={{ gap: 28, background: 'var(--color-pine)', color: 'var(--color-pine-text)', borderRadius: 18, padding: '20px 24px' }}
    >
      <div className="flex items-center gap-3.5" style={{ minWidth: 240 }}>
        <svg width="56" height="56" viewBox="0 0 64 64" role="img" aria-label={t('adsHub.progress.aria', { done, total })}>
          <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(237,232,218,.16)" strokeWidth="7" />
          <circle cx="32" cy="32" r="27" fill="none" stroke="var(--color-pine-gold)" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} transform="rotate(-90 32 32)" />
          <text x="32" y="37" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--color-pine-text)" fontFamily="Bricolage Grotesque, sans-serif">{done}/{total}</text>
        </svg>
        <div>
          <h2 className="font-display font-bold" style={{ margin: 0, fontSize: 18 }}>{t('adsHub.progress.title')}</h2>
          <div style={{ fontSize: 13, color: 'var(--color-pine-text-2)' }}>
            {left === 0 ? t('adsHub.progress.allDone') : t('adsHub.progress.minutesLeft', { count: Math.max(1, left) })}
          </div>
        </div>
      </div>
      <ol className="flex-1 m-0 p-0 list-none grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', fontSize: 13.5, minWidth: 'min(100%, 260px)' }}>
        {steps.map((s) => (
          <li key={s.id} className="flex">
            {s.done ? (
              <span className="flex items-center gap-2.5 w-full" style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(237,232,218,.06)' }}>
                <span className="inline-flex items-center justify-center shrink-0" style={{ width: 20, height: 20, borderRadius: 999, background: 'var(--color-pine-gold)', color: 'var(--color-pine)' }}>
                  <Tick color="currentColor" size={12} />
                </span>
                <span style={{ color: 'var(--color-pine-text-2)' }}>
                  {s.label}
                  <span className="sr-only"> ({t('adsHub.common.done')})</span>
                </span>
              </span>
            ) : (
              <button
                type="button"
                onClick={s.action}
                className="flex items-center gap-2.5 w-full text-left font-semibold transition-colors hover:bg-[rgba(237,232,218,.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-pine-gold)]"
                style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(237,232,218,.06)', color: 'var(--color-pine-text)', border: 'none', cursor: 'pointer' }}
              >
                <span aria-hidden="true" className="shrink-0" style={{ width: 20, height: 20, borderRadius: 999, border: '2px solid rgba(237,232,218,.4)', boxSizing: 'border-box' }} />
                {s.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
};

/* ------------------------------ Options menu ------------------------------ */

const OptionsMenu = ({ label, items }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const first = wrapRef.current?.querySelector('[role="menuitem"]');
    first?.focus();
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKeyDown = (e) => {
    const els = [...(wrapRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    const i = els.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative shrink-0" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
        style={{ width: 36, height: 36, borderRadius: 9, border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-20 flex flex-col py-1.5"
          style={{ top: 42, minWidth: 210, background: '#fff', borderRadius: 12, boxShadow: 'var(--shadow-pop)' }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className="text-left hover:bg-[color:var(--color-bg-subtle)] focus:bg-[color:var(--color-bg-subtle)] focus:outline-none"
              style={{ padding: '9px 14px', fontSize: 13.5, border: 'none', background: 'transparent', cursor: 'pointer', color: it.danger ? 'var(--color-status-stuck)' : 'var(--color-text-primary)', fontWeight: 500 }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------ Platform card ------------------------------ */

const DetailList = ({ rows }) => (
  <dl
    className="grid m-0 mx-[22px]"
    style={{ gridTemplateColumns: 'minmax(90px, 130px) 1fr', rowGap: 11, columnGap: 12, fontSize: 13.5, borderTop: `1px solid ${LINE}`, paddingTop: 16 }}
  >
    {rows.map((r) => (
      <div key={r.label} className="contents">
        <dt style={{ color: MUTED }}>{r.label}</dt>
        <dd className="m-0 font-semibold min-w-0 break-words">{r.value}</dd>
      </div>
    ))}
  </dl>
);

const PlatformCard = ({ platform, logo, logoSize, title, subtitle, data, available, starting, onSignIn, onResume, rows, pill, menuItems, onActivity, warning }) => {
  const { t } = useTranslation();
  const ready = data.status === 'ready';
  const authorized = data.status === 'authorized';
  let statusPill;
  if (!available) statusPill = <Pill tone="neutral">{t('adsHub.cards.unavailablePill')}</Pill>;
  else if (ready) statusPill = pill;
  else if (authorized) statusPill = <Pill tone="warn" dot>{t('adsHub.cards.almostDone')}</Pill>;
  else statusPill = <Pill tone="neutral">{t('adsHub.cards.notConnected')}</Pill>;

  return (
    <article className="flex flex-col" style={card} aria-labelledby={`card-${platform}`}>
      <div className="flex gap-3.5 items-start" style={{ padding: '22px 22px 18px' }}>
        <div className="flex items-center justify-center shrink-0" style={{ width: 52, height: 52, borderRadius: 14, background: BRAND_TILE[platform] }}>
          <BrandLogo name={logo} size={logoSize} style={logo === 'tiktok' ? { borderRadius: 8 } : undefined} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 id={`card-${platform}`} className="font-display font-bold" style={{ margin: 0, fontSize: 19 }}>{title}</h3>
            {statusPill}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: MUTED }}>{subtitle}</p>
        </div>
        {available && ready && menuItems?.length > 0 && <OptionsMenu label={t('adsHub.cards.moreOptions', { platform: title })} items={menuItems} />}
      </div>

      {!available ? (
        <div className="mx-[22px] mb-[22px]" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 16, fontSize: 13.5, color: 'var(--color-text-secondary)' }}>
          {t(`adsHub.cards.${platform}.unavailable`)}
        </div>
      ) : ready ? (
        <>
          <DetailList rows={rows} />
          {warning && <div className="mx-[22px] mt-3.5"><Notice tone="warn">{warning}</Notice></div>}
          <div className="flex items-center gap-2.5 flex-wrap mt-auto" style={{ padding: '16px 22px', borderTop: `1px solid ${LINE}`, marginTop: 18 }}>
            <span className="flex-1 min-w-[160px]" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {data.lastSentAt ? (
                <>{t('adsHub.cards.lastSent')} <strong style={{ color: 'var(--color-text-primary)' }}>{timeAgo(data.lastSentAt)}</strong></>
              ) : (
                t('adsHub.cards.nothingSent')
              )}
              {' · '}
              <span style={{ color: data.errorsThisWeek ? 'var(--color-status-stuck)' : undefined }}>
                {t('adsHub.cards.errorsThisWeek', { count: data.errorsThisWeek })}
              </span>
            </span>
            <SecondaryButton size="sm" onClick={onActivity}>{t('adsHub.cards.viewActivity')}</SecondaryButton>
          </div>
        </>
      ) : authorized ? (
        <>
          <div className="mx-[22px]" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 16, fontSize: 13.5, color: 'var(--color-text-secondary)' }}>
            {data.userName || data.email
              ? t('adsHub.cards.resumeAs', { name: data.userName || data.email })
              : t('adsHub.cards.resume')}
          </div>
          <div className="flex items-center gap-3 flex-wrap mt-auto" style={{ padding: '18px 22px 22px' }}>
            <button
              type="button"
              onClick={onResume}
              className="inline-flex items-center font-bold hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
              style={{ height: 44, padding: '0 20px', borderRadius: 12, border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 14, cursor: 'pointer', boxShadow: 'var(--shadow-accent)' }}
            >
              {t('adsHub.cards.finishSetup')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mx-[22px]" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 16 }}>
            <div className="font-bold uppercase" style={{ fontSize: 12, letterSpacing: '.05em', color: MUTED, marginBottom: 10 }}>{t('adsHub.cards.afterSignIn')}</div>
            <ul className="m-0 p-0 list-none flex flex-col gap-[9px]" style={{ fontSize: 13.5 }}>
              {asList(t(`adsHub.cards.${platform}.benefits`, { returnObjects: true })).map((b) => (
                <li key={b} className="flex gap-2.5 items-start"><Tick />{b}</li>
              ))}
            </ul>
          </div>
          <div className="flex items-center gap-3 flex-wrap mt-auto" style={{ padding: '18px 22px 22px' }}>
            <SignInButton platform={platform} onClick={onSignIn} loading={starting} />
            {platform === 'google' ? (
              <LockNote>{t('adsHub.cards.aboutMinuteDisconnect')}</LockNote>
            ) : (
              <span style={{ fontSize: 12.5, color: MUTED }}>{t('adsHub.cards.aboutMinute')}</span>
            )}
          </div>
        </>
      )}
    </article>
  );
};

/* ------------------------------ Website card ------------------------------ */

const BuilderTiles = ({ onPick }) => {
  const { t } = useTranslation();
  const tiles = [
    { id: 'gtm', logo: 'gtm', tag: t('adsHub.builders.gtm.tileTag') },
    { id: 'wordpress', logo: 'wordpress' },
    { id: 'wix', logo: 'wix' },
    { id: 'squarespace', logo: 'squarespace' },
    { id: 'webflow', logo: 'webflow' },
    { id: 'shopify', logo: 'shopify' },
    { id: 'noWebsite', logo: 'leadloop', link: '/automations/forms' },
    { id: 'someoneElse', logo: 'leadloop', builder: 'other' },
  ];
  const tileClass =
    'flex flex-col gap-2.5 text-left hover:border-[color:var(--color-border-strong)] hover:bg-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]';
  const tileStyle = { padding: 14, borderRadius: 14, border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', minHeight: 92, textDecoration: 'none', cursor: 'pointer' };
  return (
    <ul className="grid m-0 p-0 list-none gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
      {tiles.map((b) => {
        const inner = (
          <>
            <span className="flex items-center justify-between w-full">
              <BrandLogo name={b.logo} size={b.logo === 'wix' ? 13 : 26} />
              {b.tag && <Pill tone="ok" small>{b.tag}</Pill>}
            </span>
            <span>
              <span className="block font-bold" style={{ fontSize: 13.5 }}>{t(`adsHub.tiles.${b.id}.name`)}</span>
              <span className="block" style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{t(`adsHub.tiles.${b.id}.how`)}</span>
            </span>
          </>
        );
        return (
          <li key={b.id} className="flex">
            {b.link ? (
              <Link to={b.link} className={`${tileClass} w-full`} style={tileStyle}>{inner}</Link>
            ) : (
              <button type="button" onClick={() => onPick(b.builder || b.id)} className={`${tileClass} w-full`} style={tileStyle}>{inner}</button>
            )}
          </li>
        );
      })}
    </ul>
  );
};

/** "Also load my Meta, Google & TikTok pixels" — snippet.loadPixels on the lead connection. */
const LoadPixelsToggle = ({ website, onChanged }) => {
  const { t } = useTranslation();
  const [override, setOverride] = useState(null);
  const [saving, setSaving] = useState(false);
  const value = override ?? website.loadPixels;
  const change = async (next) => {
    setOverride(next);
    setSaving(true);
    try {
      await updateConnection(website.connectionId, { snippet: { loadPixels: next } });
      onChanged();
    } catch (err) {
      setOverride(null);
      useToastStore.getState().error(adConnect.errorMessage(err, t('adsHub.website.loadPixelsError')));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex items-center gap-3" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 14 }}>
      <span className="flex-1 min-w-0">
        <span className="block font-bold" style={{ fontSize: 13.5 }}>{t('adsHub.website.loadPixels')}</span>
        <span className="block" style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{t('adsHub.website.loadPixelsDetail')}</span>
      </span>
      <Switch checked={value} onChange={change} disabled={saving} label={t('adsHub.website.loadPixels')} />
    </div>
  );
};

const WebsiteCard = ({ website, onPick, onCheck, onGuide, onChanged }) => {
  const { t } = useTranslation();
  const found = websiteTagFound(website);
  const label = websiteLabel(website);
  return (
    <article className="flex flex-col gap-4" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 16 }}>
      <div className="flex items-center gap-3.5 flex-wrap">
        <div className="flex items-center justify-center shrink-0" style={{ width: 40, height: 40, borderRadius: 12, background: found ? 'var(--color-status-done-bg)' : 'var(--color-status-working-bg)', color: found ? 'var(--color-status-done)' : 'var(--color-status-working)' }}>
          <Globe size={20} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="font-display font-bold break-all" style={{ margin: 0, fontSize: 16 }}>{label || t('adsHub.website.untitled')}</h3>
            {!website.enabled ? (
              <Pill tone="neutral">{t('adsHub.website.paused')}</Pill>
            ) : found ? (
              <Pill tone="ok" dot>{t('adsHub.website.tagFound')}</Pill>
            ) : (
              <Pill tone="warn">{t('adsHub.website.tagNotFound')}</Pill>
            )}
          </div>
          <p style={{ margin: '3px 0 0', fontSize: 13, color: MUTED }}>
            {found
              ? [
                website.lastSeenAt && t('adsHub.website.lastSeen', { when: timeAgo(website.lastSeenAt) }),
                website.pagesSeen ? t('adsHub.website.pagesSeen', { count: website.pagesSeen }) : '',
                t('adsHub.website.formLeads', { count: website.submissionCount }),
              ].filter(Boolean).join(' · ')
              : t('adsHub.website.pickBuilder')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {found && <SecondaryButton size="sm" onClick={onGuide}>{t('adsHub.website.installGuide')}</SecondaryButton>}
          <SecondaryButton size="sm" onClick={onCheck}>
            <RefreshCw size={14} aria-hidden="true" />
            {t('adsHub.website.checkMySite')}
          </SecondaryButton>
        </div>
      </div>
      {!found && <BuilderTiles onPick={onPick} />}
      <LoadPixelsToggle website={website} onChanged={onChanged} />
    </article>
  );
};

/* ------------------------------ Lead sources ------------------------------ */

const SourceRow = ({ logo, name, detail, on, status, cta, onCta, soon, first = false }) => {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-3.5 flex-wrap" style={{ padding: '16px 22px', borderTop: first ? 'none' : `1px solid ${LINE}` }}>
      <BrandLogo name={logo} size={32} style={{ borderRadius: 8 }} />
      <div className="flex-1 min-w-[180px]">
        <div className="font-bold" style={{ fontSize: 14 }}>{name}</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{detail}</div>
      </div>
      {soon ? (
        <Pill tone="neutral">{t('adsHub.cards.unavailablePill')}</Pill>
      ) : on ? (
        <Pill tone="ok" dot>{status}</Pill>
      ) : (
        <button
          type="button"
          onClick={onCta}
          className="font-semibold hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
          style={{ fontSize: 13, padding: '8px 14px', borderRadius: 10, background: 'var(--color-accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          {cta}
        </button>
      )}
    </li>
  );
};

/* ------------------------------ Skeleton ------------------------------ */

const HubSkeleton = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-7" role="status" aria-live="polite" aria-label={t('adsHub.loading')}>
      <SkeletonBlock height={96} borderRadius={18} />
      <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ ...card, padding: 22 }} className="flex flex-col gap-3">
            <div className="flex gap-3.5 items-center">
              <SkeletonBlock width={52} height={52} borderRadius={14} />
              <div className="flex-1 flex flex-col gap-2"><SkeletonBlock width="50%" height={16} /><SkeletonBlock width="80%" height={11} /></div>
            </div>
            <SkeletonBlock height={11} width="90%" style={{ marginTop: 10 }} />
            <SkeletonBlock height={11} width="75%" />
            <SkeletonBlock height={11} width="80%" />
            <SkeletonBlock height={44} width={190} borderRadius={999} style={{ marginTop: 12 }} />
          </div>
        ))}
      </div>
      <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
        <SkeletonBlock height={260} borderRadius={18} />
        <SkeletonBlock height={260} borderRadius={18} />
      </div>
    </div>
  );
};

/* ------------------------------ Hub ------------------------------ */

const AdsTrackingHub = ({ workspaceId }) => {
  const { t } = useTranslation();
  const toast = useToastStore.getState;
  const [searchParams, setSearchParams] = useSearchParams();

  const [overview, setOverview] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [boards, setBoards] = useState([]);
  // Without a `pending` id (older callback) the dialog opens straight away;
  // with one, it opens only after POST /:platform/confirm succeeds.
  const [dialog, setDialog] = useState(() => (searchParams.get('pending') ? null : initialDialogFromUrl(searchParams)));
  const [createdSite, setCreatedSite] = useState(null);
  const [starting, setStarting] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [notified, setNotified] = useState(readNotify);
  const advancedRef = useRef(null);
  const advancedId = useId();

  /* -------------------------- data -------------------------- */
  useEffect(() => {
    if (!workspaceId) return undefined;
    let alive = true;
    adConnect
      .getOverview(workspaceId)
      .then((d) => {
        if (!alive) return;
        setOverview(normalizeOverview(d));
        setLoadError('');
      })
      .catch((err) => alive && setLoadError(adConnect.errorMessage(err, t('adsHub.loadError'))));
    return () => {
      alive = false;
    };
  }, [workspaceId, reloadKey, t]);

  useEffect(() => {
    if (!workspaceId) return undefined;
    let alive = true;
    getBoards(workspaceId)
      .then((list) => alive && setBoards((Array.isArray(list) ? list : []).filter((b) => b && b._id && !b.isPersonal)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  /* ------------------- OAuth return (?connect=…) ------------------- */
  const handledUrl = useRef(false);
  useEffect(() => {
    if (handledUrl.current || !workspaceId) return;
    const connect = searchParams.get('connect');
    const connectError = searchParams.get('connect_error');
    const pendingId = searchParams.get('pending');
    if (!connect && !connectError) return;
    handledUrl.current = true;
    const target = initialDialogFromUrl(searchParams);
    takeResume();
    const next = new URLSearchParams(searchParams);
    next.delete('connect');
    next.delete('connect_error');
    next.delete('pending');
    setSearchParams(next, { replace: true });

    if (connectError) {
      const code = CONNECT_ERRORS.includes(connectError) ? connectError : 'failed';
      toast().error(t(`adsHub.toast.errors.${code}`));
      return;
    }
    if (!adConnect.PLATFORMS.includes(connect)) return;
    const platformName = t(`adsHub.platform.${connect}`);
    if (!pendingId) {
      toast().success(t('adsHub.toast.signedIn', { platform: platformName }));
      return;
    }
    // Bind the parked OAuth result to this workspace, then reload the overview
    // so the dialog opens at "choose accounts" with status 'authorized'.
    adConnect
      .confirmOAuth(workspaceId, connect, String(pendingId).slice(0, 200))
      .then(() => adConnect.getOverview(workspaceId))
      .then((d) => {
        setOverview(normalizeOverview(d));
        setLoadError('');
        setDialog(target);
        toast().success(t('adsHub.toast.signedIn', { platform: platformName }));
      })
      .catch((err) => {
        const code = adConnect.errorCode(err);
        if (code === 'confirm_mismatch') toast().error(t('adsHub.toast.confirmMismatch'));
        else if (code === 'pending_expired') toast().error(t('adsHub.toast.pendingExpired'));
        else toast().error(adConnect.errorMessage(err, t('adsHub.toast.errors.failed')));
      });
  }, [workspaceId, searchParams, setSearchParams, t, toast]);

  /* -------------------------- actions -------------------------- */
  const startOAuth = useCallback(
    async (platform, opts = {}, resume = null) => {
      setStarting(platform);
      try {
        const url = await adConnect.startOAuth(workspaceId, platform, opts);
        if (!adConnect.isSafeRedirectUrl(url)) throw new Error('unsafe');
        if (resume) rememberResume(resume);
        window.location.assign(url);
      } catch (err) {
        setStarting('');
        if (adConnect.errorCode(err) === 'not_configured') {
          toast().error(t('adsHub.toast.notConfigured', { platform: t(`adsHub.platform.${platform}`) }));
        } else {
          toast().error(adConnect.errorMessage(err, t('adsHub.toast.startError')));
        }
      }
    },
    [workspaceId, t, toast],
  );

  const connectPlatform = (platform, extra = {}) => {
    const status = overview?.[platform]?.status;
    if (status === 'none') startOAuth(platform);
    else setDialog({ type: platform, step: 'accounts', ...extra });
  };

  const openAdvanced = () => {
    setAdvancedOpen(true);
    window.setTimeout(() => advancedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const doDisconnect = async () => {
    if (!confirm) return;
    setDisconnecting(true);
    try {
      await adConnect.disconnectPlatform(workspaceId, confirm);
      toast().success(t('adsHub.toast.disconnected', { platform: t(`adsHub.platform.${confirm}`) }));
      setConfirm(null);
      refresh();
    } catch (err) {
      toast().error(adConnect.errorMessage(err, t('adsHub.toast.disconnectError')));
    } finally {
      setDisconnecting(false);
    }
  };

  const notify = (id) => {
    const next = [...new Set([...notified, id])];
    setNotified(next);
    try {
      localStorage.setItem(NOTIFY_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    toast().success(t('adsHub.more.notifyThanks'));
  };

  /* -------------------------- render -------------------------- */
  const frame = (content, ready = false) => (
    <>
      <SettingsHeader
        tab="ads"
        title={t('settings.tabs.ads')}
        subtitle={t('settings.ads.subtitle')}
        actions={ready ? <SecondaryButton onClick={openAdvanced}>{t('settings.ads.advancedButton')}</SecondaryButton> : null}
      />
      <PageBody>{content}</PageBody>
    </>
  );

  if (!workspaceId || (!overview && !loadError)) return frame(<HubSkeleton />);
  if (!overview) {
    return frame(
      <div className="flex flex-col gap-3 items-start" style={{ ...card, padding: 22 }}>
        <Notice tone="error">{loadError}</Notice>
        <SecondaryButton onClick={() => { setLoadError(''); refresh(); }}>{t('adsHub.common.retry')}</SecondaryButton>
      </div>,
    );
  }

  const av = overview.availability;
  const avail = { meta: av.meta && av.encryption, google: av.google && av.encryption, tiktok: av.tiktok && av.encryption };
  const { meta, google, tiktok, websites } = overview;
  const subscribedPages = meta.pages.filter((p) => p.subscribed);
  const igPages = subscribedPages.filter((p) => p.hasInstagram);
  const stagesDone = !!overview.checklist?.steps?.find((s) => s.id === 'stages')?.done;
  const findWebsite = (id) => websites.find((w) => w.connectionId === id) || (createdSite && createdSite.connectionId === id ? createdSite : null);

  const steps = [];
  if (avail.meta) steps.push({ id: 'meta', label: t('adsHub.progress.meta'), done: meta.status === 'ready', action: () => connectPlatform('meta') });
  steps.push({ id: 'stages', label: t('adsHub.progress.stages'), done: stagesDone, action: openAdvanced });
  if (avail.meta) {
    steps.push({
      id: 'leadAds',
      label: t('adsHub.progress.leadAds'),
      done: subscribedPages.length > 0,
      action: () => (meta.status === 'ready' ? setDialog({ type: 'meta', step: 'leadads' }) : connectPlatform('meta')),
    });
  }
  if (avail.google) steps.push({ id: 'google', label: t('adsHub.progress.google'), done: google.status === 'ready', action: () => connectPlatform('google') });
  if (avail.tiktok) steps.push({ id: 'tiktok', label: t('adsHub.progress.tiktok'), done: tiktok.status === 'ready', action: () => connectPlatform('tiktok') });
  steps.push({
    id: 'website',
    label: t('adsHub.progress.website'),
    done: websites.some(websiteTagFound),
    action: () => setDialog({ type: 'website', connectionId: websites[0]?.connectionId || '' }),
  });

  const metaWarning = meta.tokenExpiresAt && new Date(meta.tokenExpiresAt).getTime() - Date.now() < 14 * 864e5
    ? t('adsHub.cards.meta.tokenExpiring', { when: timeAgo(meta.tokenExpiresAt) })
    : '';

  const dash = <span style={{ fontWeight: 400, color: MUTED }}>—</span>;
  const idTail = (id) => (id ? <span style={{ fontWeight: 400, color: MUTED }}> {tail(id)}</span> : null);

  const anySiteFound = websites.some(websiteTagFound);
  let websitePill;
  if (websites.length === 0) websitePill = <Pill tone="warn">{t('settings.ads.notInstalled')}</Pill>;
  else if (anySiteFound) websitePill = <Pill tone="ok" dot>{t('adsHub.website.tagFound')}</Pill>;
  else websitePill = <Pill tone="warn">{t('adsHub.website.tagNotFound')}</Pill>;

  return frame(
    <div className="flex flex-col gap-7 font-body" style={{ color: 'var(--color-text-primary)', fontSize: 14 }}>
      {/* progress, full width */}
      <ProgressStrip steps={steps} />

      {!av.encryption && <Notice tone="warn">{t('adsHub.encryptionMissing')}</Notice>}
      {loadError && <Notice tone="error" action={<SecondaryButton size="sm" onClick={refresh}>{t('adsHub.common.retry')}</SecondaryButton>}>{loadError}</Notice>}

      {/* ad accounts */}
      <section className="flex flex-col gap-3.5" aria-labelledby="ads-accounts">
        <SectionHead title={<span id="ads-accounts">{t('adsHub.sections.accounts')}</span>} sub={t('adsHub.sections.accountsSub')} />
        <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' }}>
          <PlatformCard
            platform="meta"
            logo="meta"
            logoSize={24}
            title="Meta"
            subtitle={t('adsHub.cards.meta.subtitle')}
            data={meta}
            available={avail.meta}
            starting={starting === 'meta'}
            onSignIn={() => startOAuth('meta')}
            onResume={() => setDialog({ type: 'meta', step: 'accounts' })}
            onActivity={() => setDialog({ type: 'check', connectionId: '' })}
            warning={metaWarning}
            pill={meta.live ? <Pill tone="ok" dot>{t('adsHub.cards.connectedLive')}</Pill> : <Pill tone="warn" dot>{t('adsHub.cards.connectedTest')}</Pill>}
            rows={[
              { label: t('adsHub.cards.meta.business'), value: meta.businessName || dash },
              { label: t('adsHub.cards.meta.adAccount'), value: <>{meta.adAccountName || dash}{idTail(meta.adAccountId)}</> },
              { label: t('adsHub.cards.meta.pixel'), value: <>{meta.pixelName || dash}{idTail(meta.pixelId)}</> },
              {
                label: t('adsHub.cards.meta.leadAds'),
                value: subscribedPages.length ? (
                  <span className="inline-flex items-center gap-1.5">
                    <BrandLogo name="facebook" size={16} />
                    {igPages.length > 0 && <BrandLogo name="instagram" size={16} />}
                    {t('adsHub.cards.meta.pagesSyncing', { count: subscribedPages.length })}
                  </span>
                ) : (
                  <span style={{ fontWeight: 400, color: MUTED }}>{t('adsHub.common.off')}</span>
                ),
              },
            ]}
            menuItems={[
              { label: t('adsHub.menu.changeAccounts'), onSelect: () => setDialog({ type: 'meta', step: 'accounts' }) },
              { label: t('adsHub.menu.leadAdsPages'), onSelect: () => setDialog({ type: 'meta', step: 'leadads' }) },
              { label: t('adsHub.menu.sendTest'), onSelect: () => setDialog({ type: 'meta', step: 'test' }) },
              { label: t('adsHub.menu.disconnect'), danger: true, onSelect: () => setConfirm('meta') },
            ]}
          />
          <PlatformCard
            platform="google"
            logo="google-ads"
            logoSize={29}
            title="Google Ads"
            subtitle={t('adsHub.cards.google.subtitle')}
            data={google}
            available={avail.google}
            starting={starting === 'google'}
            onSignIn={() => startOAuth('google')}
            onResume={() => setDialog({ type: 'google' })}
            onActivity={() => setDialog({ type: 'check', connectionId: '' })}
            pill={<Pill tone="ok" dot>{t('adsHub.cards.connected')}</Pill>}
            rows={[
              { label: t('adsHub.cards.google.account'), value: <>{google.customerName || dash}<span style={{ fontWeight: 400, color: MUTED }}> {formatCustomerId(google.customerId)}</span></> },
              {
                label: t('adsHub.cards.google.conversions'),
                value: google.conversionActions.qualified || google.conversionActions.customer
                  ? t('adsHub.cards.google.conversionsOn')
                  : <span style={{ fontWeight: 400, color: MUTED }}>{t('adsHub.cards.google.conversionsOff')}</span>,
              },
              { label: t('adsHub.cards.google.autoTagging'), value: google.autoTagging ? t('adsHub.common.on') : <span style={{ color: 'var(--color-status-working)' }}>{t('adsHub.common.off')}</span> },
              {
                label: t('adsHub.cards.google.websiteTag'),
                value: google.gtm?.containerPublicId
                  ? t('adsHub.cards.google.viaGtm', { container: google.gtm.containerPublicId })
                  : google.conversionTrackingId
                    ? t('adsHub.cards.google.viaTag', { id: google.conversionTrackingId })
                    : dash,
              },
            ]}
            menuItems={[
              { label: t('adsHub.menu.changeAccount'), onSelect: () => setDialog({ type: 'google' }) },
              ...(av.gtm ? [{ label: t('adsHub.menu.installGtm'), onSelect: () => setDialog({ type: 'website', builder: 'gtm', connectionId: websites[0]?.connectionId || '' }) }] : []),
              { label: t('adsHub.menu.disconnect'), danger: true, onSelect: () => setConfirm('google') },
            ]}
          />
          <PlatformCard
            platform="tiktok"
            logo="tiktok"
            logoSize={34}
            title="TikTok Ads"
            subtitle={t('adsHub.cards.tiktok.subtitle')}
            data={tiktok}
            available={avail.tiktok}
            starting={starting === 'tiktok'}
            onSignIn={() => startOAuth('tiktok')}
            onResume={() => setDialog({ type: 'tiktok', step: 'accounts' })}
            onActivity={() => setDialog({ type: 'check', connectionId: '' })}
            pill={tiktok.live ? <Pill tone="ok" dot>{t('adsHub.cards.connectedLive')}</Pill> : <Pill tone="warn" dot>{t('adsHub.cards.connectedTest')}</Pill>}
            rows={[
              { label: t('adsHub.cards.tiktok.advertiser'), value: <>{tiktok.advertiserName || dash}{idTail(tiktok.advertiserId)}</> },
              { label: t('adsHub.cards.tiktok.pixel'), value: <>{tiktok.pixelName || dash}{idTail(tiktok.pixelCode)}</> },
              { label: t('adsHub.cards.tiktok.instantForms'), value: tiktok.instantForms.enabled ? t('adsHub.cards.syncing') : <span style={{ fontWeight: 400, color: MUTED }}>{t('adsHub.common.off')}</span> },
            ]}
            menuItems={[
              { label: t('adsHub.menu.changeAccounts'), onSelect: () => setDialog({ type: 'tiktok', step: 'accounts' }) },
              { label: t('adsHub.menu.sendTest'), onSelect: () => setDialog({ type: 'tiktok', step: 'test' }) },
              { label: t('adsHub.menu.disconnect'), danger: true, onSelect: () => setConfirm('tiktok') },
            ]}
          />
        </div>
      </section>

      {/* website tracking + lead sources, side by side */}
      <div className="grid gap-[18px] items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
        <section className="flex flex-col gap-4 min-w-0" style={{ ...card, padding: 22 }} aria-labelledby="ads-website">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 id="ads-website" className="flex-1 font-display font-bold" style={{ margin: 0, fontSize: 19 }}>{t('adsHub.sections.website')}</h2>
            {websitePill}
            {websites.length > 0 && (
              <SecondaryButton size="sm" onClick={() => setDialog({ type: 'website', connectionId: '__new__' })}>{t('adsHub.website.addAnother')}</SecondaryButton>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--color-text-secondary)' }}>{t('adsHub.sections.websiteSub')}</p>
          {websites.length === 0 ? (
            <>
              <p className="font-bold" style={{ margin: 0, fontSize: 13.5 }}>{t('adsHub.website.pickBuilder')}</p>
              <BuilderTiles onPick={(b) => setDialog({ type: 'website', builder: b, connectionId: '' })} />
            </>
          ) : (
            websites.map((w) => (
              <WebsiteCard
                key={w.connectionId}
                website={w}
                onPick={(b) => setDialog({ type: 'website', builder: b, connectionId: w.connectionId })}
                onCheck={() => setDialog({ type: 'check', connectionId: w.connectionId })}
                onGuide={() => setDialog({ type: 'website', connectionId: w.connectionId })}
                onChanged={refresh}
              />
            ))
          )}
        </section>

        <section className="overflow-hidden min-w-0" style={card} aria-labelledby="ads-sources">
          <div style={{ padding: '22px 22px 10px' }}>
            <h2 id="ads-sources" className="font-display font-bold" style={{ margin: 0, fontSize: 19 }}>{t('adsHub.sections.sources')}</h2>
            <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--color-text-secondary)' }}>{t('adsHub.sections.sourcesSub')}</p>
          </div>
          <ul className="m-0 p-0 list-none">
            <SourceRow
              logo="facebook"
              name={t('adsHub.sources.facebook')}
              soon={!avail.meta}
              on={subscribedPages.length > 0}
              detail={subscribedPages.length ? subscribedPages.map((p) => p.name).join(' · ') : meta.status === 'ready' ? t('adsHub.sources.pickPages') : t('adsHub.sources.connectMetaFirst')}
              status={t('adsHub.sources.syncingPages', { count: subscribedPages.length })}
              cta={meta.status === 'ready' ? t('adsHub.sources.turnOn') : t('adsHub.sources.connect')}
              onCta={() => (meta.status === 'ready' ? setDialog({ type: 'meta', step: 'leadads' }) : connectPlatform('meta'))}
            />
            <SourceRow
              logo="instagram"
              name={t('adsHub.sources.instagram')}
              soon={!avail.meta}
              on={igPages.length > 0}
              detail={t('adsHub.sources.instagramDetail')}
              status={t('adsHub.cards.syncing')}
              cta={meta.status === 'ready' ? t('adsHub.sources.turnOn') : t('adsHub.sources.connect')}
              onCta={() => (meta.status === 'ready' ? setDialog({ type: 'meta', step: 'leadads' }) : connectPlatform('meta'))}
            />
            <SourceRow
              logo="google-ads"
              name={t('adsHub.sources.google')}
              soon={!avail.google}
              on={!!google.leadFormConnectionId}
              detail={google.leadFormConnectionId ? t('adsHub.sources.googleOn') : google.status === 'ready' ? t('adsHub.sources.googleTurnOn') : t('adsHub.sources.connectGoogleFirst')}
              status={t('adsHub.cards.syncing')}
              cta={google.status === 'ready' ? t('adsHub.sources.turnOn') : t('adsHub.sources.connect')}
              onCta={() => (google.status === 'ready' ? setDialog({ type: 'google', leadForms: true }) : connectPlatform('google', { leadForms: true }))}
            />
            <SourceRow
              logo="tiktok"
              name={t('adsHub.sources.tiktok')}
              soon={!avail.tiktok}
              on={tiktok.instantForms.enabled}
              detail={tiktok.instantForms.enabled ? t('adsHub.sources.tiktokOn', { name: tiktok.advertiserName }) : tiktok.status === 'ready' ? t('adsHub.sources.tiktokTurnOn') : t('adsHub.sources.connectTikTokFirst')}
              status={t('adsHub.cards.syncing')}
              cta={tiktok.status === 'ready' ? t('adsHub.sources.turnOn') : t('adsHub.sources.connect')}
              onCta={() => connectPlatform('tiktok', { instantForms: true })}
            />
            <SourceRow
              logo="leadloop"
              name={t('adsHub.sources.website')}
              on={websites.length > 0}
              detail={websites.length ? t('adsHub.sources.websiteOn', { sites: websites.map(websiteLabel).filter(Boolean).join(', ') }) : t('adsHub.sources.websiteDetail')}
              status={t('adsHub.sources.capturing', { count: websites.reduce((n, w) => n + w.submissionCount, 0) })}
              cta={t('adsHub.sources.setUp')}
              onCta={() => setDialog({ type: 'website', connectionId: '' })}
            />
          </ul>
        </section>
      </div>

      {/* more platforms */}
      <section className="flex flex-col gap-3.5" aria-labelledby="ads-more">
        <h2 id="ads-more" className="font-display font-bold" style={{ margin: 0, fontSize: 19 }}>{t('adsHub.sections.more')}</h2>
        <ul className="grid m-0 p-0 list-none gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
          {[
            { id: 'linkedin', name: 'LinkedIn Ads' },
            { id: 'microsoft', name: 'Microsoft Advertising' },
          ].map((m) => (
            <li key={m.id} className="flex items-center gap-3" style={{ padding: '14px 16px', borderRadius: 14, border: '1px dashed var(--color-border-strong)', background: 'rgba(255,255,255,.5)' }}>
              <BrandLogo name={m.id} size={30} />
              <div className="flex-1 min-w-0">
                <div className="font-bold" style={{ fontSize: 13.5 }}>{m.name}</div>
                <div style={{ fontSize: 12, color: MUTED }}>{t('adsHub.more.comingSoon')}</div>
              </div>
              {notified.includes(m.id) ? (
                <span style={{ fontSize: 12.5, color: 'var(--color-status-done)', fontWeight: 600 }}>{t('adsHub.more.notified')}</span>
              ) : (
                <SecondaryButton size="sm" onClick={() => notify(m.id)} aria-label={t('adsHub.more.notifyAria', { name: m.name })}>
                  {t('adsHub.more.notify')}
                </SecondaryButton>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* advanced */}
      <section id="advanced" ref={advancedRef} style={{ ...card, padding: 0, scrollMarginTop: 72 }}>
        <h2 style={{ margin: 0 }}>
          <button
            type="button"
            aria-expanded={advancedOpen}
            aria-controls={advancedId}
            onClick={() => setAdvancedOpen((o) => !o)}
            className="w-full flex items-center gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
            style={{ padding: '18px 22px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 18, color: 'var(--color-text-primary)' }}
          >
            <span className="flex-1">
              <span className="block font-display font-bold" style={{ fontSize: 17 }}>{t('adsHub.advanced.title')}</span>
              <span className="block font-body" style={{ fontSize: 13, color: MUTED, fontWeight: 400, marginTop: 2 }}>
                {stagesDone ? t('adsHub.advanced.sub') : t('adsHub.advanced.subNeedsStages')}
              </span>
            </span>
            {!stagesDone && <Pill tone="warn">{t('adsHub.advanced.required')}</Pill>}
            <ChevronDown size={18} aria-hidden="true" style={{ transform: advancedOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
          </button>
        </h2>
        <div id={advancedId} hidden={!advancedOpen} style={{ padding: '4px 22px 22px', borderTop: `1px solid ${LINE}` }}>
          {advancedOpen && <div style={{ paddingTop: 18 }}><AdConversionsSettings workspaceId={workspaceId} /></div>}
        </div>
      </section>

      {/* dialogs */}
      {dialog?.type === 'meta' && (
        <MetaConnectDialog
          workspaceId={workspaceId}
          overview={overview}
          boards={boards}
          initialStep={dialog.step}
          onClose={() => setDialog(null)}
          onChanged={refresh}
          onStartOAuth={startOAuth}
        />
      )}
      {dialog?.type === 'google' && (
        <GoogleConnectDialog
          workspaceId={workspaceId}
          overview={overview}
          boards={boards}
          initialOptions={{ leadForms: dialog.leadForms }}
          onClose={() => setDialog(null)}
          onChanged={refresh}
          onStartOAuth={startOAuth}
          onOpenWebsite={(builder) => setDialog({ type: 'website', builder, connectionId: websites[0]?.connectionId || '' })}
        />
      )}
      {dialog?.type === 'tiktok' && (
        <TikTokConnectDialog
          workspaceId={workspaceId}
          overview={overview}
          boards={boards}
          initialStep={dialog.step}
          initialInstantForms={dialog.instantForms}
          onClose={() => setDialog(null)}
          onChanged={refresh}
          onStartOAuth={startOAuth}
        />
      )}
      {dialog?.type === 'website' && (
        <WebsiteInstallDialog
          workspaceId={workspaceId}
          overview={dialog.connectionId === '__new__' ? { ...overview, websites: [] } : overview}
          boards={boards}
          initialConnectionId={dialog.connectionId}
          initialBuilder={dialog.builder}
          onClose={() => setDialog(null)}
          onChanged={refresh}
          onCreated={setCreatedSite}
          onCheck={(connectionId) => setDialog({ type: 'check', connectionId })}
          onStartOAuth={startOAuth}
        />
      )}
      {dialog?.type === 'check' && (
        <SiteCheckDialog
          workspaceId={workspaceId}
          overview={overview}
          website={dialog.connectionId ? findWebsite(dialog.connectionId) : null}
          onClose={() => setDialog(null)}
          onChanged={refresh}
          onInstall={(connectionId) => setDialog({ type: 'website', connectionId })}
        />
      )}

      <Modal
        isOpen={!!confirm}
        onClose={() => !disconnecting && setConfirm(null)}
        title={confirm ? t('adsHub.disconnect.title', { platform: t(`adsHub.platform.${confirm}`) }) : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={disconnecting}>{t('adsHub.common.cancel')}</Button>
            <Button variant="danger" onClick={doDisconnect} disabled={disconnecting}>
              {disconnecting ? t('adsHub.disconnect.working') : t('adsHub.menu.disconnect')}
            </Button>
          </>
        }
      >
        <p className="font-body" style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--color-text-secondary)' }}>
          {confirm ? t(`adsHub.disconnect.body.${confirm}`) : ''}
        </p>
      </Modal>
    </div>,
    true,
  );
};

export default AdsTrackingHub;
