import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Globe,
  Zap,
  Webhook,
  Megaphone,
  Users,
  Camera,
  ClipboardList,
  Home,
  Building2,
  BadgeCheck,
  Copy,
  Check,
  Plus,
  ArrowRight,
  Lock,
  Radio,
  Code2,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import { PageHeader, PageBody } from '../components/layout/PageHeader';
import BrandLogo from '../components/settings/ads/BrandLogo';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Dropdown from '../components/ui/Dropdown';
import EmptyState from '../components/onboarding/EmptyState';
import useOrgStore from '../store/orgStore';
import { getBoards, getBoardPipeline } from '../services/boardService';
import { listOrgConnections, createConnection } from '../services/leadConnectionService';

/**
 * LeadSourcesPage — the one-click connectors hub. Each source is a card; a
 * "Connect" flow picks the destination board + landing stage, mints a lead
 * connection (F14) with that source's `sourceType`, and hands back a ready-to-
 * paste ingest URL + key. The server's per-source payload adapter
 * (sourceAdapters.js) then normalises that platform's webhook body into the
 * shared ingest spine, so leads land on the chosen stage regardless of source.
 *
 * "Ready" sources deliver by webhook and are live today. "Coming soon" sources
 * (portal ADF-email + Google Forms polling + LSA) are shown as roadmap so the
 * hub reads as complete; they don't open the connect flow yet.
 */

// Client catalog — the presentation half of the server's SOURCE_TYPES registry.
// `id` MUST match a server sourceType. `ready` mirrors the server's `ready`.
const CATALOG = [
  // No-code: one script tag on the client's site (public site key + domain lock).
  { id: 'website_snippet', icon: Code2, brand: 'leadloop', tint: '#3E6B4E', ready: true, steps: 'snippet' },
  { id: 'facebook_lead_ads', icon: Users, brand: 'facebook', tint: '#1877F2', ready: true, steps: 'fb' },
  { id: 'instagram_lead_ads', icon: Camera, brand: 'instagram', tint: '#C13584', ready: true, steps: 'fb' },
  { id: 'google_ads', icon: Megaphone, brand: 'google-ads', tint: '#4285F4', ready: true, steps: 'google_ads' },
  { id: 'website', icon: Globe, brand: 'leadloop', tint: '#4E9068', ready: true, steps: 'website' },
  { id: 'zapier', icon: Zap, mono: 'Z', tint: '#FF4A00', ready: true, steps: 'webhook' },
  { id: 'generic', icon: Webhook, mono: '{ }', tint: '#5C554A', ready: true, steps: 'webhook' },
  { id: 'zillow', icon: Home, tint: '#006AFF', ready: false, steps: 'email' },
  { id: 'realtor_com', icon: Building2, tint: '#D92228', ready: false, steps: 'email' },
  { id: 'realtor_ca', icon: Building2, tint: '#EF4136', ready: false, steps: 'email' },
  { id: 'redfin', icon: Home, tint: '#A02021', ready: false, steps: 'email' },
  { id: 'google_forms', icon: ClipboardList, tint: '#7248B9', ready: false, steps: 'poll' },
  { id: 'google_lsa', icon: BadgeCheck, tint: '#34A853', ready: false, steps: 'webhook' },
];

/**
 * Polls the org's connections until this snippet connection has received its
 * first submission — the "is it installed?" answer, without leaving the page.
 */
const SnippetWaiting = ({ orgId, connectionId }) => {
  const { t } = useTranslation();
  const [received, setReceived] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (!orgId || !connectionId) return undefined;
    let stopped = false;
    const startedAt = Date.now();
    const tick = async () => {
      if (stopped) return;
      try {
        const list = await listOrgConnections(orgId);
        const mine = (list || []).find((c) => String(c._id) === String(connectionId));
        if (mine && mine.submissionCount > 0) {
          setReceived(true);
          return;
        }
      } catch {
        /* keep polling */
      }
      if (Date.now() - startedAt > 15 * 60 * 1000) {
        setGaveUp(true);
        return;
      }
      setTimeout(tick, 4000);
    };
    tick();
    return () => {
      stopped = true;
    };
  }, [orgId, connectionId]);

  const color = received ? 'var(--color-status-done)' : 'var(--color-text-secondary)';
  return (
    <div
      className="flex items-center gap-2 font-body"
      role="status"
      style={{
        marginTop: 14,
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${received ? 'var(--color-status-done)' : 'var(--color-border)'}`,
        fontSize: 13,
        color,
      }}
    >
      {received ? <CheckCircle2 size={16} /> : <Loader2 size={16} className={gaveUp ? '' : 'animate-spin'} />}
      {received
        ? t('leadSources.snippetReceived', 'First lead received — the snippet is working.')
        : gaveUp
          ? t('leadSources.snippetGaveUp', 'Nothing yet. Check the snippet is on the page and the domain matches, then submit a test.')
          : t('leadSources.snippetWaiting', 'Waiting for the first submission… paste the snippet, then submit your form once.')}
    </div>
  );
};

// White surface with the card shadow (the shadow carries the hairline ring).
const surface = {
  background: 'var(--color-bg-surface)',
  borderRadius: 16,
  boxShadow: 'var(--shadow-card)',
};

const CopyRow = ({ label, value }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        className="font-body"
        style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 5 }}
      >
        {label}
      </div>
      <div className="flex items-stretch gap-2">
        <code
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            padding: '9px 11px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-subtle)',
            color: 'var(--color-text-primary)',
            overflowX: 'auto',
            whiteSpace: 'nowrap',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={t('leadSources.copy', 'Copy')}
          className="inline-flex items-center gap-1.5"
          style={{
            flex: '0 0 auto',
            fontSize: 12,
            padding: '0 12px',
            borderRadius: 'var(--radius-md)',
            border: '1.5px solid var(--color-border)',
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? t('leadSources.copied', 'Copied') : t('leadSources.copy', 'Copy')}
        </button>
      </div>
    </div>
  );
};

const LeadSourcesPage = () => {
  const { t } = useTranslation();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;

  const [boards, setBoards] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);

  // Connect flow state
  const [source, setSource] = useState(null); // the catalog entry being connected
  const [name, setName] = useState('');
  const [boardId, setBoardId] = useState('');
  const [stages, setStages] = useState([]);
  const [landingGroupId, setLandingGroupId] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null); // { connection, apiKey }
  const [error, setError] = useState('');
  // Website snippet settings
  const [domains, setDomains] = useState('');
  const [consentWording, setConsentWording] = useState('');
  const isSnippet = source?.id === 'website_snippet';

  const reload = useCallback(() => {
    if (!orgId) return;
    setLoading(true);
    Promise.all([getBoards(orgId), listOrgConnections(orgId)])
      .then(([b, c]) => {
        setBoards(b || []);
        setConnections(c || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // When a board is chosen in the connect flow, load its stages for the picker.
  useEffect(() => {
    if (!boardId) {
      setStages([]);
      setLandingGroupId('');
      return;
    }
    let cancelled = false;
    getBoardPipeline(boardId)
      .then((d) => {
        if (cancelled) return;
        const s = d?.stages || [];
        setStages(s);
        setLandingGroupId(s[0]?._id ? String(s[0]._id) : '');
      })
      .catch(() => {
        if (!cancelled) setStages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  const countBySource = useMemo(() => {
    const m = {};
    for (const c of connections) m[c.sourceType] = (m[c.sourceType] || 0) + 1;
    return m;
  }, [connections]);

  const openConnect = (entry) => {
    if (!entry.ready) return;
    setSource(entry);
    setName(t(`leadSources.catalog.${entry.id}.name`, entry.id));
    setBoardId(boards[0]?._id ? String(boards[0]._id) : '');
    setDomains('');
    setConsentWording(
      t('leadSources.consentDefault', 'I agree that my details may be used to measure and improve advertising.')
    );
    setCreated(null);
    setError('');
  };

  const closeConnect = () => {
    setSource(null);
    setCreated(null);
    setError('');
  };

  const submit = async () => {
    if (!source || !boardId) return;
    setCreating(true);
    setError('');
    try {
      const res = await createConnection(boardId, {
        name: name.trim() || t(`leadSources.catalog.${source.id}.name`, source.id),
        sourceType: source.id,
        landingGroupId: landingGroupId || undefined,
        ...(source.id === 'website_snippet'
          ? { allowedDomains: domains, snippet: { consentWording: consentWording.trim() } }
          : {}),
      });
      setCreated(res); // { connection, apiKey }
      reload();
    } catch (e) {
      setError(e?.response?.data?.error || t('leadSources.createError', 'Could not create the connection.'));
    } finally {
      setCreating(false);
    }
  };

  // Build the two ready-to-paste endpoints from the created connection.
  const endpoints = useMemo(() => {
    if (!created) return null;
    const { connection, apiKey } = created;
    const base = connection?.ingestUrl || '';
    let origin = '';
    try {
      origin = new URL(base).origin;
    } catch {
      origin = '';
    }
    return {
      apiKey,
      headerUrl: base,
      urlKeyed: origin ? `${origin}/api/leads/in/${apiKey}` : `/api/leads/in/${apiKey}`,
    };
  }, [created]);

  const boardOptions = boards.map((b) => ({ value: String(b._id), label: b.name }));
  const stageOptions = stages.map((s) => ({ value: String(s._id), label: s.name }));

  const ready = CATALOG.filter((c) => c.ready);
  const soon = CATALOG.filter((c) => !c.ready);

  const renderLogo = (entry) => {
    if (entry.brand) return <BrandLogo name={entry.brand} size={34} />;
    if (entry.mono) {
      return (
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center font-body"
          style={{ width: 34, height: 34, borderRadius: 9, background: entry.tint, color: '#FFFFFF', fontWeight: 800, fontSize: 14 }}
        >
          {entry.mono}
        </span>
      );
    }
    const Icon = entry.icon;
    return (
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center"
        style={{ width: 34, height: 34, borderRadius: 9, background: `${entry.tint}1A`, color: entry.tint }}
      >
        <Icon size={19} />
      </span>
    );
  };

  const renderCard = (entry) => {
    const count = countBySource[entry.id] || 0;
    const entryName = t(`leadSources.catalog.${entry.id}.name`, entry.id);
    return (
      <article
        key={entry.id}
        className="flex flex-col"
        style={{ ...surface, padding: 20, gap: 12 }}
      >
        <div className="flex items-center justify-between gap-2">
          {renderLogo(entry)}
          {count > 0 && (
            <span
              className="inline-flex items-center gap-1 font-body"
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                color: 'var(--color-status-done)',
                background: 'var(--color-status-done-bg)',
                padding: '3px 9px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              <Check size={12} aria-hidden="true" /> {t('leadSources.connectedN', '{{count}} connected', { count })}
            </span>
          )}
        </div>
        <div>
          <h3 className="font-display" style={{ margin: 0, fontSize: 16.5, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            {entryName}
          </h3>
          <p className="font-body" style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
            {t(`leadSources.catalog.${entry.id}.blurb`, '')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => openConnect(entry)}
          aria-label={t('leadSources.connectTitle', 'Connect {{name}}', { name: entryName })}
          className="inline-flex items-center justify-center gap-1.5 font-body transition-colors hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
          style={{
            marginTop: 'auto',
            height: 40,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-bg-input)',
            color: 'var(--color-text-primary)',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <Plus size={15} aria-hidden="true" /> {t('leadSources.connect', 'Connect')}
        </button>
      </article>
    );
  };

  const steps = [
    t('leadSources.emptyStep1', 'Pick a source — Facebook, Google Ads, your website form.'),
    t('leadSources.emptyStep2', 'Choose the board and the stage new leads should land on.'),
    t('leadSources.emptyStep3', 'Paste one link into that platform. That’s the whole setup.'),
  ];

  const headerStats = (
    <div className="flex font-body" style={{ gap: 24, fontSize: 13, color: 'var(--color-text-secondary)' }}>
      <div>
        <div className="font-display" style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.15 }}>
          {loading ? '—' : connections.length}
        </div>
        {t('leadSources.statConnected', 'connected')}
      </div>
      <div>
        <div className="font-display" style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.15 }}>
          {ready.length}
        </div>
        {t('leadSources.statAvailable', 'available')}
      </div>
    </div>
  );

  return (
    <PageWrapper flush>
      <PageHeader
        title={t('leadSources.title', 'Lead Sources')}
        subtitle={t('leadSources.subtitle', 'Connect the places your leads come from. Pick a board and stage, paste one URL into the platform, and new leads flow straight onto your pipeline.')}
        actions={headerStats}
      />
      <PageBody className="flex flex-col" style={{ gap: 28 }}>
        {/* Nothing connected yet → explain the job of this page, in place. */}
        {!loading && connections.length === 0 && (
          <EmptyState
            icon={Radio}
            title={t('leadSources.emptyTitle', 'Connect where your leads come from')}
            body={t('leadSources.emptyBody', 'Right now leads have to be typed in by hand. Connect a source and they arrive on your board by themselves, on the stage you choose.')}
          />
        )}

        {/* How it works — the three steps, always visible on the pine band. */}
        <section aria-label={t('leadSources.howItWorks', 'How it works')}>
          <ol
            className="grid overflow-hidden"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              background: 'var(--color-pine)',
              color: 'var(--color-pine-text)',
              borderRadius: 18,
              margin: 0,
              padding: 0,
              listStyle: 'none',
            }}
          >
            {steps.map((text, i) => (
              <li
                key={i}
                className="flex font-body"
                style={{ padding: '20px 24px', gap: 14, borderRight: '1px solid var(--color-pine-line)' }}
              >
                <span
                  aria-hidden="true"
                  className="inline-flex items-center justify-center shrink-0"
                  style={{ width: 30, height: 30, borderRadius: 'var(--radius-full)', background: 'var(--color-pine-gold)', color: 'var(--color-pine)', fontWeight: 800 }}
                >
                  {i + 1}
                </span>
                <span style={{ fontSize: 14, lineHeight: 1.5 }}>
                  <span className="sr-only">{t('setup.stepN', 'Step {{n}}', { n: i + 1 })}: </span>
                  {text}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* Ready sources */}
        <section aria-labelledby="ls-ready" className="flex flex-col" style={{ gap: 14 }}>
          <h2 id="ls-ready" className="font-display" style={{ margin: 0, fontSize: 21, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            {t('leadSources.readyTitle', 'Ready to connect')}
          </h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {ready.map(renderCard)}
          </div>
        </section>

        {/* Coming soon — roadmap only, not interactive. */}
        <section aria-labelledby="ls-soon" className="flex flex-col" style={{ gap: 12 }}>
          <h2 id="ls-soon" className="font-display" style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text-secondary)' }}>
            {t('leadSources.roadmap', 'Coming soon')}
          </h2>
          <ul className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, margin: 0, padding: 0, listStyle: 'none' }}>
            {soon.map((entry) => (
              <li
                key={entry.id}
                title={t(`leadSources.catalog.${entry.id}.blurb`, '')}
                className="flex items-center justify-between gap-2 font-body"
                style={{
                  padding: '14px 16px',
                  borderRadius: 14,
                  border: '1px dashed var(--color-border-strong)',
                  color: 'var(--color-text-secondary)',
                  fontWeight: 600,
                }}
              >
                <span className="truncate">{t(`leadSources.catalog.${entry.id}.name`, entry.id)}</span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--color-status-notstarted)',
                    background: 'var(--color-status-notstarted-bg)',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                    flexShrink: 0,
                  }}
                >
                  {t('leadSources.soon', 'Soon')}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {loading && (
          <p className="font-body" role="status" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {t('common.loading', 'Loading…')}
          </p>
        )}
      </PageBody>

      {/* Connect modal */}
      <Modal
        isOpen={!!source}
        onClose={closeConnect}
        maxWidth={created ? 560 : 480}
        title={
          source
            ? created
              ? t('leadSources.connectedTitle', '{{name}} connected', { name: t(`leadSources.catalog.${source.id}.name`, source.id) })
              : t('leadSources.connectTitle', 'Connect {{name}}', { name: t(`leadSources.catalog.${source.id}.name`, source.id) })
            : ''
        }
        footer={
          created ? (
            <Button variant="primary" onClick={closeConnect}>
              {t('common.done', 'Done')}
            </Button>
          ) : (
            <div className="flex items-center gap-2 justify-end">
              <Button variant="ghost" onClick={closeConnect}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button variant="primary" onClick={submit} disabled={creating || !boardId || (isSnippet && !domains.trim())}>
                {creating ? t('leadSources.creating', 'Connecting…') : t('leadSources.connect', 'Connect')}
              </Button>
            </div>
          )
        }
      >
        {source && !created && (
          <div>
            <label className="font-body" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
              {t('leadSources.nameLabel', 'Connection name')}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="font-body"
              style={{
                width: '100%',
                fontSize: 14,
                padding: '9px 11px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-surface, #fff)',
                color: 'var(--color-text-primary)',
                marginBottom: 16,
              }}
            />

            <div style={{ marginBottom: 16 }}>
              <Dropdown
                label={t('leadSources.boardLabel', 'Send leads to board')}
                options={boardOptions}
                value={boardId}
                onChange={setBoardId}
                placeholder={t('leadSources.boardPlaceholder', 'Choose a board…')}
              />
            </div>

            <div style={{ marginBottom: 4 }}>
              <Dropdown
                label={t('leadSources.stageLabel', 'Landing stage')}
                options={stageOptions}
                value={landingGroupId}
                onChange={setLandingGroupId}
                placeholder={t('leadSources.stagePlaceholder', 'First stage')}
                disabled={!boardId || stageOptions.length === 0}
              />
              <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                {t('leadSources.stageHint', 'New leads from this source land here.')}
              </p>
            </div>

            {isSnippet && (
              <div style={{ marginTop: 16 }}>
                <label className="font-body" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
                  {t('leadSources.domainsLabel', 'Your website domain(s)')}
                </label>
                <input
                  value={domains}
                  onChange={(e) => setDomains(e.target.value)}
                  placeholder="example.com"
                  className="font-body"
                  style={{
                    width: '100%',
                    fontSize: 14,
                    padding: '9px 11px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-surface, #fff)',
                    color: 'var(--color-text-primary)',
                  }}
                />
                <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6, marginBottom: 14 }}>
                  {t('leadSources.domainsHint', 'Leads are only accepted from these sites (subdomains included). Separate several with commas.')}
                </p>
                <label className="font-body" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
                  {t('leadSources.consentLabel', 'Ad consent checkbox wording')}
                </label>
                <textarea
                  value={consentWording}
                  onChange={(e) => setConsentWording(e.target.value)}
                  rows={2}
                  className="font-body"
                  style={{
                    width: '100%',
                    fontSize: 13.5,
                    padding: '9px 11px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-surface, #fff)',
                    color: 'var(--color-text-primary)',
                    resize: 'vertical',
                  }}
                />
                <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                  {t('leadSources.consentHint', 'Added unticked above your form’s submit button. Only leads who tick it are reported to Meta / Google. Leave empty for no checkbox.')}
                </p>
              </div>
            )}

            {error && (
              <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-status-stuck)', marginTop: 12 }}>
                {error}
              </p>
            )}
          </div>
        )}

        {source && created && isSnippet && (
          <div>
            <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
              {t('leadSources.steps.snippet', 'Paste this one line into your website, just before </body> on every page (or in your site builder’s footer/custom-code setting). That’s the whole setup — no other code.')}
            </p>
            <CopyRow label={t('leadSources.snippetLabel', 'Your website snippet')} value={created.connection?.snippetTag || ''} />
            <ul className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.7, margin: '4px 0 0', paddingLeft: 18 }}>
              <li>{t('leadSources.snippetWp', 'WordPress: a plugin like WPCode → Footer.')}</li>
              <li>{t('leadSources.snippetWebflow', 'Webflow: Site settings → Custom code → Footer code.')}</li>
              <li>{t('leadSources.snippetWix', 'Wix / Squarespace: Settings → Custom code → Body end.')}</li>
              <li>{t('leadSources.snippetHtml', 'Plain HTML: before </body> on each page.')}</li>
            </ul>
            <SnippetWaiting orgId={orgId} connectionId={created.connection?._id} />
          </div>
        )}

        {source && created && !isSnippet && endpoints && (
          <div>
            <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
              {t(`leadSources.steps.${source.steps}`, t('leadSources.steps.webhook', 'Paste this endpoint into the platform. Every submission creates a lead on your board.'))}
            </p>

            {(source.steps === 'website' || source.steps === 'webhook') && (
              <CopyRow label={t('leadSources.headerUrlLabel', 'POST URL (with X-API-Key header)')} value={endpoints.headerUrl} />
            )}
            <CopyRow
              label={t('leadSources.urlKeyedLabel', 'Webhook URL (key in the link)')}
              value={endpoints.urlKeyed}
            />
            <CopyRow label={t('leadSources.keyLabel', 'API key')} value={endpoints.apiKey} />

            <div
              className="flex items-start gap-2"
              style={{
                marginTop: 8,
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-subtle)',
                border: '1px solid var(--color-border)',
              }}
            >
              <Lock size={14} style={{ marginTop: 2, color: 'var(--color-text-muted)', flexShrink: 0 }} />
              <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                {t('leadSources.keyOnce', 'Copy the key now — for security it is shown only once. You can rotate it later from the board’s Integrations tab.')}
              </p>
            </div>

            <div className="flex items-center gap-1.5" style={{ marginTop: 14, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              <ArrowRight size={14} />
              {t('leadSources.testHint', 'Send a test submission from the platform — it appears on your chosen stage within seconds.')}
            </div>
          </div>
        )}
      </Modal>
    </PageWrapper>
  );
};

export default LeadSourcesPage;
