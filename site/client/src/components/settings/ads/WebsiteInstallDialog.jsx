import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Download } from 'lucide-react';
import BrandLogo from './BrandLogo';
import {
  DialogShell, SignInButton, SelectField, TextField, RadioCard, CopyField, PrimaryButton, SecondaryButton,
  Notice, LoadingBlock, FieldLabel, Pill, RichText, LINE, MUTED,
} from './AdsShared';
import { BUILDERS, asList, isEmail, normalizeWebsite, parseSiteHost, timeAgo, websiteLabel } from './adsHelpers';
import * as adConnect from '../../../services/adConnectService';
import { createConnection } from '../../../services/leadConnectionService';
import useToastStore from '../../../store/toastStore';

/**
 * Add tracking to your website — a builder rail (GTM, WordPress, Wix, …) and
 * per-builder steps. GTM publishes for you via the API, WordPress downloads a
 * pre-configured plugin, everything else is "copy the tag + paste here".
 * First time (no website yet) it creates the website_snippet lead connection.
 */

const StepNumber = ({ n, strong }) => (
  <span
    className="inline-flex items-center justify-center shrink-0 font-bold"
    style={{
      width: 26,
      height: 26,
      borderRadius: 999,
      fontSize: 13,
      background: strong ? 'var(--color-accent)' : 'var(--color-accent-light)',
      color: strong ? '#fff' : 'var(--color-status-done)',
    }}
  >
    {n}
  </span>
);

/** Numbered steps; `first` is rendered as step 1 when given. */
const StepList = ({ first, steps, offset = 0 }) => (
  <ol className="m-0 p-0 list-none flex flex-col gap-[14px]">
    {first && (
      <li className="flex gap-3">
        <StepNumber n={1} strong />
        <div className="flex-1 min-w-0">{first}</div>
      </li>
    )}
    {steps.map((s, i) => (
      <li key={i} className="flex gap-3">
        <StepNumber n={i + 1 + offset} />
        <div className="min-w-0">
          <div className="font-bold"><RichText text={s?.title} /></div>
          {s?.detail && <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 3 }}><RichText text={s.detail} /></div>}
        </div>
      </li>
    ))}
  </ol>
);

const CopyStep = ({ website }) => {
  const { t } = useTranslation();
  return (
    <>
      <div className="font-bold">{t('adsHub.website.copyTag')}</div>
      <div style={{ marginTop: 8 }}>
        {website.snippetTag ? (
          <CopyField value={website.snippetTag} label={t('adsHub.website.yourTag')} />
        ) : (
          <Notice tone="warn">{t('adsHub.website.noTag')}</Notice>
        )}
      </div>
    </>
  );
};

/* ------------------------------ GTM guide ------------------------------ */

const GtmGuide = ({ workspaceId, overview, website, onStartOAuth, onChanged, onCheck }) => {
  const { t } = useTranslation();
  const google = overview.google;
  const canAuto = overview.availability.google && overview.availability.gtm;
  const signedIn = google.status !== 'none';
  // The overview already knows when the Google grant lacks Tag Manager scopes.
  const knownNoScope = signedIn && google.hasGtmAccess === false;

  const [state, setState] = useState(
    knownNoScope
      ? { loading: false, containers: [], error: '', code: 'needs_gtm_scope' }
      : { loading: canAuto && signedIn, containers: [], error: '', code: '' },
  );
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!canAuto || !signedIn || knownNoScope) return undefined;
    let alive = true;
    adConnect
      .getGtmContainers(workspaceId)
      .then((list) => {
        if (!alive) return;
        const containers = list
          .filter((c) => c && c.containerId && c.accountId)
          .map((c) => ({
            accountId: String(c.accountId),
            accountName: String(c.accountName || ''),
            containerId: String(c.containerId),
            publicId: String(c.publicId || ''),
            name: String(c.name || ''),
            domains: Array.isArray(c.domains) ? c.domains.map(String) : [],
          }));
        setState({ loading: false, containers, error: '', code: '' });
      })
      .catch((err) => {
        if (!alive) return;
        setState({ loading: false, containers: [], error: adConnect.errorMessage(err, t('adsHub.gtm.loadError')), code: adConnect.errorCode(err) });
      });
    return () => {
      alive = false;
    };
  }, [workspaceId, canAuto, signedIn, knownNoScope, reloadKey, t]);

  const host = websiteLabel(website);
  const [pickState, setPick] = useState('');
  const keyOf = (c) => `${c.accountId}/${c.containerId}`;
  const matching = state.containers.find((c) => c.domains.some((d) => host && String(d).toLowerCase().includes(host)));
  const pick =
    (state.containers.some((c) => keyOf(c) === pickState) && pickState) ||
    (matching ? keyOf(matching) : state.containers[0] ? keyOf(state.containers[0]) : '');
  const container = state.containers.find((c) => keyOf(c) === pick);

  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState(null);
  const publish = async () => {
    if (!container) return;
    setPublishing(true);
    setResult(null);
    try {
      const r = await adConnect.installGtm(workspaceId, {
        accountId: container.accountId,
        containerId: container.containerId,
        connectionId: website.connectionId,
      });
      if (r && r.ok === false) throw new Error('not ok');
      setResult({ tone: 'ok', text: t('adsHub.gtm.published', { container: String(r?.containerPublicId || container.publicId) }) });
      onChanged();
    } catch (err) {
      setResult({ tone: 'error', text: adConnect.errorMessage(err, t('adsHub.gtm.publishError')) });
    } finally {
      setPublishing(false);
    }
  };

  const resume = { dialog: 'website', builder: 'gtm', connectionId: website.connectionId };
  const groupId = useId();
  const manual = (
    <StepList first={<CopyStep website={website} />} steps={asList(t('adsHub.builders.gtm.steps', { returnObjects: true }))} offset={1} />
  );

  if (!canAuto) return manual;

  return (
    <>
      {google.gtm?.containerPublicId && google.gtm.publishedAt && (
        <Notice tone="ok">{t('adsHub.gtm.alreadyPublished', { container: google.gtm.containerPublicId, when: timeAgo(google.gtm.publishedAt) })}</Notice>
      )}
      {!signedIn ? (
        <div className="flex flex-col gap-3 items-start">
          <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>{t('adsHub.gtm.signInIntro')}</p>
          <SignInButton platform="google" onClick={() => onStartOAuth('google', { gtm: true }, resume)} />
        </div>
      ) : state.loading ? (
        <LoadingBlock label={t('adsHub.gtm.loading')} />
      ) : state.code === 'needs_gtm_scope' ? (
        <div className="flex flex-col gap-3 items-start">
          <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>{t('adsHub.gtm.needsScope')}</p>
          <SignInButton platform="google" onClick={() => onStartOAuth('google', { gtm: true }, resume)} />
        </div>
      ) : state.error ? (
        <Notice
          tone="error"
          action={<SecondaryButton size="sm" onClick={() => { setState({ loading: true, containers: [], error: '', code: '' }); setReloadKey((k) => k + 1); }}>{t('adsHub.common.retry')}</SecondaryButton>}
        >
          {state.error}
        </Notice>
      ) : state.containers.length === 0 ? (
        <Notice tone="warn">{t('adsHub.gtm.noContainers')}</Notice>
      ) : (
        <div className="flex flex-col gap-2">
          <FieldLabel id={groupId}>{t('adsHub.gtm.container')}</FieldLabel>
          <div role="radiogroup" aria-labelledby={groupId} className="flex flex-col gap-2">
            {state.containers.map((c) => (
              <RadioCard
                key={keyOf(c)}
                name="gtm-container"
                value={keyOf(c)}
                checked={pick === keyOf(c)}
                onChange={setPick}
                badge={matching && keyOf(matching) === keyOf(c) ? <Pill tone="ok" small>{t('adsHub.gtm.matchesSite')}</Pill> : null}
              >
                <strong>{c.name || c.publicId}</strong> <span style={{ color: MUTED }}>{c.publicId}</span>
                <br />
                <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                  {[c.accountName, c.domains.slice(0, 3).join(', ')].filter(Boolean).join(' · ')}
                </span>
              </RadioCard>
            ))}
          </div>
          <div className="flex flex-wrap gap-2.5 items-center" style={{ marginTop: 6 }}>
            <PrimaryButton onClick={publish} loading={publishing} disabled={!container}>
              {t('adsHub.gtm.publish', { container: container?.publicId || '' })}
            </PrimaryButton>
            {result?.tone === 'ok' && (
              <SecondaryButton onClick={() => onCheck(website.connectionId)}>{t('adsHub.website.checkNow')}</SecondaryButton>
            )}
          </div>
          {result && <Notice tone={result.tone}>{result.text}</Notice>}
        </div>
      )}
      <details className="group" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 14 }}>
        <summary className="cursor-pointer font-semibold" style={{ fontSize: 13.5, color: 'var(--color-accent)' }}>
          {t('adsHub.gtm.manual')}
        </summary>
        <div style={{ marginTop: 14 }}>{manual}</div>
      </details>
    </>
  );
};

/* --------------------------- WordPress guide --------------------------- */

const WordPressGuide = ({ workspaceId, website }) => {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      await adConnect.downloadWordpressPlugin(workspaceId, website.connectionId);
    } catch (err) {
      // 503 = the plugin build isn't available on this server → manual steps.
      if (adConnect.errorStatus(err) === 503) setUnavailable(true);
      else useToastStore.getState().error(adConnect.errorMessage(err, t('adsHub.wordpress.downloadError')));
    } finally {
      setDownloading(false);
    }
  };
  if (unavailable) {
    return (
      <>
        <Notice tone="info">{t('adsHub.wordpress.unavailable')}</Notice>
        <StepList first={<CopyStep website={website} />} steps={asList(t('adsHub.wordpress.manualSteps', { returnObjects: true }))} offset={1} />
      </>
    );
  }
  return (
    <>
      <StepList
        first={
          <>
            <div className="font-bold">{t('adsHub.wordpress.download')}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 3 }}>{t('adsHub.wordpress.downloadDetail')}</div>
            <div style={{ marginTop: 8 }}>
              <SecondaryButton onClick={download} loading={downloading}>
                {!downloading && <Download size={15} aria-hidden="true" />}
                {t('adsHub.wordpress.downloadButton')}
              </SecondaryButton>
            </div>
          </>
        }
        steps={asList(t('adsHub.builders.wordpress.steps', { returnObjects: true }))}
        offset={1}
      />
      <details style={{ borderTop: `1px solid ${LINE}`, paddingTop: 14 }}>
        <summary className="cursor-pointer font-semibold" style={{ fontSize: 13.5, color: 'var(--color-accent)' }}>
          {t('adsHub.wordpress.manual')}
        </summary>
        <div className="flex flex-col gap-2" style={{ marginTop: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('adsHub.wordpress.manualDetail')}</span>
          {website.snippetTag && <CopyField value={website.snippetTag} label={t('adsHub.website.yourTag')} />}
        </div>
      </details>
    </>
  );
};

/* --------------------------- Email a developer --------------------------- */

const EmailDeveloper = ({ workspaceId, website, builder }) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const send = async (e) => {
    e.preventDefault();
    const to = email.trim();
    if (!isEmail(to)) {
      setError(t('adsHub.email.invalid'));
      return;
    }
    setSending(true);
    setError('');
    try {
      await adConnect.emailDeveloper(workspaceId, { connectionId: website.connectionId, email: to, builder });
      setSentTo(to);
      setEmail('');
    } catch (err) {
      const status = adConnect.errorStatus(err);
      if (status === 429) setError(t('adsHub.email.rateLimited'));
      else if (status === 503) setError(t('adsHub.email.unavailable'));
      else setError(adConnect.errorMessage(err, t('adsHub.email.error')));
    } finally {
      setSending(false);
    }
  };
  return (
    <form onSubmit={send} noValidate className="flex flex-col gap-2.5" style={{ borderRadius: 14, border: '1px dashed var(--color-border-strong)', padding: '14px 16px' }}>
      <div className="font-bold" style={{ fontSize: 13.5 }}>{t('adsHub.email.title')}</div>
      <div className="flex gap-2 flex-wrap items-start">
        <TextField
          label={t('adsHub.email.label')}
          srOnlyLabel
          type="email"
          value={email}
          onChange={(v) => {
            setEmail(v);
            if (error) setError('');
          }}
          placeholder={t('adsHub.email.placeholder')}
          autoComplete="email"
          error={error}
        />
        <SecondaryButton type="submit" loading={sending}>{t('adsHub.email.send')}</SecondaryButton>
      </div>
      {sentTo ? (
        <span role="status" style={{ fontSize: 12.5, color: 'var(--color-status-done)' }}>{t('adsHub.email.sent', { email: sentTo })}</span>
      ) : (
        <span style={{ fontSize: 12, color: MUTED }}>{t('adsHub.email.detail')}</span>
      )}
    </form>
  );
};

/* ------------------------------ First time ------------------------------ */

const CreateWebsite = ({ boards, onCreated }) => {
  const { t } = useTranslation();
  const [site, setSite] = useState('');
  const [boardIdState, setBoardId] = useState('');
  const boardId = boardIdState || boards[0]?._id || '';
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const host = parseSiteHost(site);
    if (!host) {
      setError(t('adsHub.website.invalidSite'));
      return;
    }
    if (!boardId) return;
    setSaving(true);
    setError('');
    try {
      const res = await createConnection(boardId, {
        name: host,
        sourceType: 'website_snippet',
        allowedDomains: host,
      });
      const c = res?.connection || {};
      onCreated(normalizeWebsite({ ...c, connectionId: c._id, domains: c.allowedDomains }));
    } catch (err) {
      setError(adConnect.errorMessage(err, t('adsHub.website.createError')));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-7 py-5 flex flex-col gap-[18px]">
      <div>
        <h3 className="font-display font-bold" style={{ fontSize: 18, margin: 0 }}>{t('adsHub.website.firstTitle')}</h3>
        <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--color-text-secondary)' }}>{t('adsHub.website.firstDetail')}</p>
      </div>
      <TextField
        label={t('adsHub.website.siteLabel')}
        value={site}
        onChange={(v) => {
          setSite(v);
          if (error) setError('');
        }}
        placeholder="example.com"
        inputMode="url"
        autoComplete="url"
        error={error}
        hint={t('adsHub.website.siteHint')}
      />
      {boards.length === 0 ? (
        <Notice tone="warn">{t('adsHub.common.noBoards')}</Notice>
      ) : (
        <SelectField
          label={t('adsHub.common.sendLeadsTo')}
          value={boardId}
          onChange={setBoardId}
          options={boards.map((b) => ({ value: b._id, label: String(b.name || '') }))}
        />
      )}
      <div>
        <PrimaryButton type="submit" loading={saving} disabled={!boardId || !site.trim()}>
          {t('adsHub.common.continue')}
        </PrimaryButton>
      </div>
    </form>
  );
};

/* ------------------------------ Dialog ------------------------------ */

const WebsiteInstallDialog = ({ workspaceId, overview, boards, initialConnectionId, initialBuilder, onClose, onChanged, onCreated: onCreatedProp, onCheck, onStartOAuth }) => {
  const { t } = useTranslation();
  const [created, setCreated] = useState(null);
  const websites = created && !overview.websites.some((w) => w.connectionId === created.connectionId)
    ? [...overview.websites, created]
    : overview.websites;
  const [siteIdState, setSiteId] = useState(initialConnectionId || '');
  const website = websites.find((w) => w.connectionId === siteIdState) || (created && websites.find((w) => w.connectionId === created.connectionId)) || websites[0] || null;
  const [builderId, setBuilderId] = useState(BUILDERS.some((b) => b.id === initialBuilder) ? initialBuilder : 'wix');
  const builder = BUILDERS.find((b) => b.id === builderId) || BUILDERS[2];

  const onCreated = (w) => {
    setCreated(w);
    setSiteId(w.connectionId);
    onCreatedProp?.(w);
    onChanged();
    useToastStore.getState().success(t('adsHub.website.created', { site: websiteLabel(w) }));
  };

  const builderName = t(`adsHub.builders.${builder.id}.name`);
  const steps = asList(t(`adsHub.builders.${builder.id}.steps`, { returnObjects: true }));

  return (
    <DialogShell
      title={t('adsHub.website.dialogTitle')}
      subtitle={t('adsHub.website.dialogSubtitle')}
      onClose={onClose}
      maxWidth={880}
      bare
    >
      {!website ? (
        <CreateWebsite boards={boards} onCreated={onCreated} />
      ) : (
        <>
          <nav
            aria-label={t('adsHub.website.builtWith')}
            className="shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto md:w-[250px] px-3 py-3 md:py-4 border-b md:border-b-0 md:border-r"
            style={{ background: 'var(--color-bg-input)', borderColor: LINE }}
          >
            <div className="hidden md:block font-bold uppercase" style={{ fontSize: 11.5, letterSpacing: '.06em', color: MUTED, padding: '4px 10px 8px' }}>
              {t('adsHub.website.builtWith')}
            </div>
            {BUILDERS.map((b) => {
              const active = b.id === builder.id;
              const tag = t(`adsHub.builders.${b.id}.railTag`, { defaultValue: '' });
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBuilderId(b.id)}
                  aria-current={active ? 'true' : undefined}
                  className="flex items-center gap-2.5 text-left shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--color-accent)] hover:bg-white"
                  style={{
                    padding: 10,
                    minHeight: 44,
                    borderRadius: 11,
                    border: 'none',
                    background: active ? '#fff' : 'transparent',
                    boxShadow: active ? '0 1px 3px rgba(33,30,24,.08), 0 0 0 1px var(--color-border)' : 'none',
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  <span className="inline-flex items-center justify-center" style={{ width: 26, height: 22 }}>
                    <BrandLogo name={b.logo} size={b.logo === 'wix' ? 13 : 22} />
                  </span>
                  <span className="flex-1 whitespace-nowrap" style={{ fontWeight: active ? 700 : 500, fontSize: 13.5 }}>
                    {t(`adsHub.builders.${b.id}.name`)}
                  </span>
                  {tag && <Pill tone="ok" small>{tag}</Pill>}
                </button>
              );
            })}
          </nav>

          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto px-5 sm:px-[26px] py-5 flex flex-col gap-[18px]">
            {websites.length > 1 && (
              <SelectField
                label={t('adsHub.website.whichSite')}
                value={website.connectionId}
                onChange={setSiteId}
                options={websites.map((w) => ({ value: w.connectionId, label: websiteLabel(w) || w.connectionId }))}
              />
            )}
            <div className="flex items-center gap-3">
              <BrandLogo name={builder.logo} size={builder.logo === 'wix' ? 18 : 30} />
              <div>
                <h3 className="font-display font-bold" style={{ fontSize: 18, margin: 0 }}>
                  {builder.id === 'other' ? t('adsHub.website.addToOther') : t('adsHub.website.addTo', { builder: builderName })}
                </h3>
                <div style={{ fontSize: 12.5, color: MUTED }}>
                  {builder.kind === 'gtm' && overview.availability.gtm && overview.availability.google
                    ? t('adsHub.website.gtmMeta')
                    : t('adsHub.website.stepsMeta', { count: steps.length + 1 })}
                  {websiteLabel(website) ? ` · ${websiteLabel(website)}` : ''}
                </div>
              </div>
            </div>

            {builder.kind === 'gtm' ? (
              <GtmGuide
                key={website.connectionId}
                workspaceId={workspaceId}
                overview={overview}
                website={website}
                onStartOAuth={onStartOAuth}
                onChanged={onChanged}
                onCheck={onCheck}
              />
            ) : builder.kind === 'wordpress' ? (
              <WordPressGuide workspaceId={workspaceId} website={website} />
            ) : (
              <StepList first={<CopyStep website={website} />} steps={steps} offset={1} />
            )}

            <div>
              <PrimaryButton onClick={() => onCheck(website.connectionId)}>
                {t('adsHub.website.addedCheck')}
                <ArrowRight size={15} strokeWidth={2.4} aria-hidden="true" />
              </PrimaryButton>
            </div>

            <div className="mt-auto">
              <EmailDeveloper key={`${website.connectionId}-${builder.id}`} workspaceId={workspaceId} website={website} builder={builder.id} />
            </div>
          </div>
        </>
      )}
    </DialogShell>
  );
};

export default WebsiteInstallDialog;
