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
} from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
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
  {
    id: 'facebook_lead_ads',
    icon: Users,
    tint: '#1877F2',
    ready: true,
    steps: 'fb',
  },
  { id: 'instagram_lead_ads', icon: Camera, tint: '#C13584', ready: true, steps: 'fb' },
  { id: 'google_ads', icon: Megaphone, tint: '#4285F4', ready: true, steps: 'google_ads' },
  { id: 'website', icon: Globe, tint: '#4E9068', ready: true, steps: 'website' },
  { id: 'zapier', icon: Zap, tint: '#FF4A00', ready: true, steps: 'webhook' },
  { id: 'generic', icon: Webhook, tint: '#8C8578', ready: true, steps: 'webhook' },
  { id: 'zillow', icon: Home, tint: '#006AFF', ready: false, steps: 'email' },
  { id: 'realtor_com', icon: Building2, tint: '#D92228', ready: false, steps: 'email' },
  { id: 'realtor_ca', icon: Building2, tint: '#EF4136', ready: false, steps: 'email' },
  { id: 'redfin', icon: Home, tint: '#A02021', ready: false, steps: 'email' },
  { id: 'google_forms', icon: ClipboardList, tint: '#7248B9', ready: false, steps: 'poll' },
  { id: 'google_lsa', icon: BadgeCheck, tint: '#34A853', ready: false, steps: 'webhook' },
];

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

  const renderCard = (entry) => {
    const Icon = entry.icon;
    const count = countBySource[entry.id] || 0;
    return (
      <button
        key={entry.id}
        type="button"
        onClick={() => openConnect(entry)}
        disabled={!entry.ready}
        className="text-left"
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: 16,
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg-surface, #fff)',
          boxShadow: 'var(--shadow-card)',
          cursor: entry.ready ? 'pointer' : 'default',
          opacity: entry.ready ? 1 : 0.62,
          transition: 'transform .15s ease, box-shadow .15s ease',
        }}
        onMouseEnter={(e) => {
          if (!entry.ready) return;
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = 'var(--shadow-card-hover, 0 8px 24px rgba(0,0,0,.10))';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = '';
          e.currentTarget.style.boxShadow = 'var(--shadow-card)';
        }}
      >
        <div className="flex items-center justify-between">
          <span
            className="inline-flex items-center justify-center"
            style={{ width: 40, height: 40, borderRadius: 10, background: `${entry.tint}1A`, color: entry.tint }}
          >
            <Icon size={21} />
          </span>
          {count > 0 && (
            <span
              className="inline-flex items-center gap-1"
              style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--color-status-done)' }}
            >
              <Check size={13} /> {t('leadSources.connectedN', '{{count}} connected', { count })}
            </span>
          )}
          {!entry.ready && (
            <span
              className="inline-flex items-center gap-1"
              style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
            >
              <Lock size={12} /> {t('leadSources.soon', 'Soon')}
            </span>
          )}
        </div>
        <div>
          <div className="font-heading" style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            {t(`leadSources.catalog.${entry.id}.name`, entry.id)}
          </div>
          <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 3, lineHeight: 1.45 }}>
            {t(`leadSources.catalog.${entry.id}.blurb`, '')}
          </p>
        </div>
        {entry.ready && (
          <span className="inline-flex items-center gap-1" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-accent)', marginTop: 'auto' }}>
            <Plus size={14} /> {t('leadSources.connect', 'Connect')}
          </span>
        )}
      </button>
    );
  };

  return (
    <PageWrapper>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '4px 2px 40px' }}>
        <div className="flex items-center gap-3" style={{ marginBottom: 6 }}>
          <span
            className="inline-flex items-center justify-center"
            style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--color-accent-subtle, rgba(78,144,104,.14))', color: 'var(--color-accent)' }}
          >
            <Radio size={18} />
          </span>
          <h1 className="font-heading" style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-text-primary)' }}>
            {t('leadSources.title', 'Lead Sources')}
          </h1>
        </div>
        <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 26, maxWidth: 640 }}>
          {t('leadSources.subtitle', 'Connect the places your leads come from. Pick a board and stage, paste one URL into the platform, and new leads flow straight onto your pipeline.')}
        </p>

        {/* Nothing connected yet → explain the job of this page, in place. */}
        {!loading && connections.length === 0 && (
          <div style={{ marginBottom: 20 }}>
            <EmptyState
              icon={Radio}
              title={t('leadSources.emptyTitle', 'Connect where your leads come from')}
              body={t('leadSources.emptyBody', 'Right now leads have to be typed in by hand. Connect a source and they arrive on your board by themselves, on the stage you choose.')}
              steps={[
                { label: t('setup.stepN', 'Step {{n}}', { n: 1 }), text: t('leadSources.emptyStep1', 'Pick a source — Facebook, Google Ads, your website form.') },
                { label: t('setup.stepN', 'Step {{n}}', { n: 2 }), text: t('leadSources.emptyStep2', 'Choose the board and the stage new leads should land on.') },
                { label: t('setup.stepN', 'Step {{n}}', { n: 3 }), text: t('leadSources.emptyStep3', 'Paste one link into that platform. That’s the whole setup.') },
              ]}
            />
          </div>
        )}

        {/* Ready sources */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {ready.map(renderCard)}
        </div>

        {/* Coming soon */}
        <h2 className="font-heading" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', margin: '30px 0 12px' }}>
          {t('leadSources.roadmap', 'Coming soon')}
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {soon.map(renderCard)}
        </div>

        {loading && (
          <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 20 }}>
            {t('common.loading', 'Loading…')}
          </p>
        )}
      </div>

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
              <Button variant="primary" onClick={submit} disabled={creating || !boardId}>
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

            {error && (
              <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-status-stuck)', marginTop: 12 }}>
                {error}
              </p>
            )}
          </div>
        )}

        {source && created && endpoints && (
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
