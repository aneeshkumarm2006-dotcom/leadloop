import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Workflow, HeartPulse, BarChart3, Plug, Zap, AlertTriangle, Search,
  ChevronRight, CheckCircle2, XCircle, Power, Mail, MessageSquare,
  Phone, Webhook, CalendarClock,
} from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import BarChart from '../components/analytics/BarChart';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';
import useToastStore from '../store/toastStore';
import * as automationService from '../services/automationService';
import { Toggle } from '../components/board/automationFields';
import { timeAgo } from '../utils/dateUtils';

// Mirror of the trigger labels used in AutomationsPage so the hub reads the
// same. (The automation builder surface is English across the app.)
const TRIGGER_TITLES = {
  SCHEDULE: 'On a schedule',
  ITEM_CREATED: 'When an item is created',
  GROUP_CREATED: 'When a group is created',
  COLUMN_VALUE_CHANGED: 'When a column changes',
  STATUS_BECAME: 'When status becomes…',
  STATUS_CHANGED_FROM_TO: 'When status changes X → Y',
  CHECKBOX_CHECKED: 'When a checkbox is checked',
  NUMBER_CROSSED: 'When a number crosses a threshold',
  ITEM_MOVED_TO_GROUP: 'When an item moves to a group',
  ITEM_NAME_CHANGED: 'When an item name changes',
  UPDATE_POSTED: 'When an update is posted',
  DATE_ARRIVED: 'When a date arrives',
  PERSON_ASSIGNED: 'When a person is assigned',
  FORM_SUBMITTED: 'When a form is submitted',
  WEBHOOK_RECEIVED: 'When a webhook is received',
};

const useIsCurrentOrgAdmin = () => {
  const user = useAuthStore((s) => s.user);
  const currentOrg = useOrgStore((s) => s.currentOrg);
  if (!user || !currentOrg) return false;
  const adminId =
    typeof currentOrg.admin === 'object' && currentOrg.admin !== null
      ? currentOrg.admin._id || currentOrg.admin
      : currentOrg.admin;
  const isMain = !!adminId && String(adminId) === String(user._id);
  const isExtra =
    Array.isArray(currentOrg.admins) &&
    currentOrg.admins.some((a) => String(typeof a === 'object' ? a?._id || a : a) === String(user._id));
  return isMain || isExtra;
};

const SECTIONS = [
  { key: 'workflows', icon: Workflow, labelKey: 'automationsHub.workflows' },
  { key: 'health', icon: HeartPulse, labelKey: 'automationsHub.health' },
  { key: 'usage', icon: BarChart3, labelKey: 'automationsHub.usage' },
  { key: 'connections', icon: Plug, labelKey: 'automationsHub.connections' },
];

const AutomationsHubPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAdmin = useIsCurrentOrgAdmin();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id;
  const toastError = useToastStore((s) => s.error);

  const [section, setSection] = useState('workflows');
  const [hub, setHub] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadHub = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const data = await automationService.getHub(orgId);
      setHub(data);
    } catch (err) {
      toastError(err?.response?.data?.error || t('automationsHub.loadError'));
    } finally {
      setLoading(false);
    }
  }, [orgId, toastError, t]);

  useEffect(() => {
    loadHub();
  }, [loadHub]);

  const handleToggle = async (auto, next) => {
    // optimistic
    setHub((prev) =>
      prev
        ? { ...prev, automations: prev.automations.map((a) => (a._id === auto._id ? { ...a, enabled: next } : a)) }
        : prev
    );
    try {
      await automationService.updateAutomation(auto._id, { enabled: next });
    } catch (err) {
      toastError(err?.response?.data?.error || t('automationsHub.toggleError'));
      loadHub(); // rollback to server truth
    }
  };

  const openAutomation = (auto) => navigate(`/boards/${auto.board?._id}/automations`);

  if (!isAdmin) {
    return (
      <PageWrapper>
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          {t('automationsHub.adminOnly')}
        </div>
      </PageWrapper>
    );
  }

  const stats = hub?.stats || { total: 0, enabled: 0, needsSetup: 0, failing: 0, boards: 0 };

  return (
    <PageWrapper>
      <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
        <Zap size={22} color="var(--color-accent)" aria-hidden="true" />
        <h1 className="font-display" style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary)' }}>
          {t('automationsHub.title')}
        </h1>
      </div>
      <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
        {t('automationsHub.subtitle')}
      </p>

      {/* Stat cards */}
      <div className="flex flex-wrap gap-3" style={{ marginBottom: 20 }}>
        <StatCard label={t('automationsHub.statTotal')} value={stats.total} icon={Workflow} />
        <StatCard label={t('automationsHub.statActive')} value={stats.enabled} icon={Power} accent="#00C875" />
        <StatCard label={t('automationsHub.statNeedsSetup')} value={stats.needsSetup} icon={AlertTriangle} accent="#FDAB3D" />
        <StatCard label={t('automationsHub.statFailing')} value={stats.failing} icon={XCircle} accent="#E2445C" />
      </div>

      <div className="flex gap-5" style={{ alignItems: 'flex-start' }}>
        {/* Left rail */}
        <nav
          className="flex flex-col gap-1 shrink-0"
          style={{ width: 180, position: 'sticky', top: 16 }}
          aria-label={t('automationsHub.sections')}
        >
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSection(s.key)}
                className="flex items-center gap-2.5 font-body transition-colors duration-150"
                style={{
                  height: 38,
                  padding: '0 12px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: active ? 600 : 500,
                  textAlign: 'left',
                  color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  background: active ? 'var(--color-accent-light)' : 'transparent',
                }}
              >
                <Icon size={16} aria-hidden="true" />
                {t(s.labelKey)}
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {loading && !hub ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
              {t('automationsHub.loading')}
            </div>
          ) : section === 'workflows' ? (
            <WorkflowsSection hub={hub} onToggle={handleToggle} onOpen={openAutomation} />
          ) : section === 'health' ? (
            <HealthSection hub={hub} onOpen={openAutomation} />
          ) : section === 'usage' ? (
            <UsageSection orgId={orgId} />
          ) : (
            <ConnectionsSection orgId={orgId} />
          )}
        </div>
      </div>
    </PageWrapper>
  );
};

const StatCard = ({ label, value, icon: Icon, accent }) => (
  <div
    className="bg-surface flex items-center gap-3"
    style={{ minWidth: 150, flex: '1 1 150px', padding: '14px 16px', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)' }}
  >
    <div
      style={{
        width: 38, height: 38, borderRadius: 'var(--radius-md)',
        background: accent ? `${accent}1A` : 'var(--color-accent-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Icon size={18} color={accent || 'var(--color-accent)'} aria-hidden="true" />
    </div>
    <div>
      <div className="font-display" style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.1 }}>{value}</div>
      <div className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  </div>
);

const triggerLabel = (type) => TRIGGER_TITLES[type] || type;

// ---- Workflows ------------------------------------------------------------
const WorkflowsSection = ({ hub, onToggle, onOpen }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const automations = hub?.automations || [];

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? automations.filter((a) => a.name.toLowerCase().includes(q) || a.board?.name?.toLowerCase().includes(q))
      : automations;
    const map = new Map();
    for (const a of filtered) {
      const key = a.board?._id?.toString() || '—';
      if (!map.has(key)) map.set(key, { board: a.board, items: [] });
      map.get(key).items.push(a);
    }
    return [...map.values()].sort((x, y) => (x.board?.name || '').localeCompare(y.board?.name || ''));
  }, [automations, query]);

  if (automations.length === 0) {
    return <EmptyBlock icon={Workflow} title={t('automationsHub.noAutomationsTitle')} desc={t('automationsHub.noAutomationsDesc')} />;
  }

  return (
    <div>
      <SearchBox value={query} onChange={setQuery} placeholder={t('automationsHub.searchWorkflows')} />
      <div className="flex flex-col gap-5" style={{ marginTop: 14 }}>
        {grouped.map(({ board, items }) => (
          <div key={board?._id || '—'}>
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: board?.color || 'var(--color-accent)' }} />
              <h3 className="font-body" style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{board?.name || '—'}</h3>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>· {items.length}</span>
            </div>
            <div className="bg-surface" style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
              {items.map((a, i) => (
                <AutomationRow key={a._id} auto={a} onToggle={onToggle} onOpen={onOpen} last={i === items.length - 1} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const AutomationRow = ({ auto, onToggle, onOpen, last }) => {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center gap-3 transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)]"
      style={{ padding: '12px 16px', borderBottom: last ? 'none' : '1px solid var(--color-border)' }}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <Toggle checked={auto.enabled} onChange={(v) => onToggle(auto, v)} />
      </div>
      <button
        type="button"
        onClick={() => onOpen(auto)}
        className="flex-1 min-w-0 text-left"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <div className="flex items-center gap-2">
          <span className="font-body truncate" style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{auto.name}</span>
          {auto.needsSetup && (
            <span style={badgeStyle('#FDAB3D')}>{t('automationsHub.needsSetup')}</span>
          )}
          {auto.recentFailures > 0 && (
            <span style={badgeStyle('#E2445C')}>{t('automationsHub.failingBadge', { count: auto.recentFailures })}</span>
          )}
        </div>
        <div className="font-body truncate" style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
          {triggerLabel(auto.triggerType)} · {t('automationsHub.actionCount', { count: auto.actionCount })}
          {auto.lastRunAt ? ` · ${t('automationsHub.lastRun', { time: timeAgo(auto.lastRunAt) })}` : ` · ${t('automationsHub.neverRun')}`}
        </div>
      </button>
      {auto.owner && <Avatar user={auto.owner} size={26} />}
      <ChevronRight size={16} color="var(--color-text-muted)" aria-hidden="true" />
    </div>
  );
};

// ---- Health ---------------------------------------------------------------
const HealthSection = ({ hub, onOpen }) => {
  const { t } = useTranslation();
  const automations = hub?.automations || [];
  const problems = automations.filter((a) => a.needsSetup || a.recentFailures > 0);

  if (problems.length === 0) {
    return (
      <div className="bg-surface flex flex-col items-center justify-center text-center" style={{ padding: 48, borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)' }}>
        <CheckCircle2 size={40} color="#00C875" aria-hidden="true" />
        <p className="font-body" style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 12 }}>{t('automationsHub.allHealthyTitle')}</p>
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4, maxWidth: 320 }}>{t('automationsHub.allHealthyDesc')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {problems.map((a) => (
        <button
          key={a._id}
          type="button"
          onClick={() => onOpen(a)}
          className="bg-surface flex items-start gap-3 text-left transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)]"
          style={{ padding: 16, borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', border: 'none', cursor: 'pointer' }}
        >
          <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: a.recentFailures > 0 ? '#E2445C1A' : '#FDAB3D1A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {a.recentFailures > 0 ? <XCircle size={18} color="#E2445C" /> : <AlertTriangle size={18} color="#FDAB3D" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-body" style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{a.name}</div>
            <div className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{a.board?.name}</div>
            <div className="font-body" style={{ fontSize: 13, color: a.recentFailures > 0 ? '#E2445C' : '#B7791F', marginTop: 6 }}>
              {a.recentFailures > 0
                ? t('automationsHub.healthFailing', { count: a.recentFailures })
                : t('automationsHub.healthNeedsSetup')}
              {a.lastError ? ` — ${a.lastError}` : ''}
            </div>
          </div>
          <span className="font-body" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>{t('automationsHub.fix')} →</span>
        </button>
      ))}
    </div>
  );
};

// ---- Usage ----------------------------------------------------------------
const RANGES = [
  { key: '7', days: 7 },
  { key: '30', days: 30 },
  { key: '90', days: 90 },
];

const UsageSection = ({ orgId }) => {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState(30);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(false);
  const toastError = useToastStore((s) => s.error);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setLoading(true);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400000);
    automationService
      .getUsage(orgId, { from: from.toISOString(), to: to.toISOString() })
      .then((data) => { if (!cancelled) setUsage(data); })
      .catch((err) => { if (!cancelled) toastError(err?.response?.data?.error || t('automationsHub.loadError')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, days, toastError, t]);

  const actionBars = useMemo(
    () => (usage?.byActionType || []).map((r) => ({ key: r.actionType, label: r.actionType, count: r.count, color: 'var(--color-accent)' })),
    [usage]
  );
  const boardBars = useMemo(
    () => (usage?.topBoards || []).map((r) => ({ key: r._id, label: r.name, count: r.count, color: '#7E5EF2' })),
    [usage]
  );
  const creatorBars = useMemo(
    () => (usage?.topCreators || []).map((r) => ({ key: r._id, label: r.name, count: r.count, color: '#00A9FF' })),
    [usage]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setDays(r.days)}
            className="font-body transition-colors duration-150"
            style={{
              height: 32, padding: '0 12px', fontSize: 13, fontWeight: 600,
              borderRadius: 'var(--radius-md)',
              border: `1.5px solid ${days === r.days ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
              background: days === r.days ? 'var(--color-accent-light)' : 'transparent',
              color: days === r.days ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            {t('automationsHub.lastNDays', { count: r.days })}
          </button>
        ))}
        <span className="font-body" style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--color-text-muted)' }}>
          {t('automationsHub.totalActions', { count: usage?.totalActions || 0 })}
        </span>
      </div>

      {loading && !usage ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>{t('automationsHub.loading')}</div>
      ) : (
        <>
          <div className="bg-surface" style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: 20 }}>
            <h3 className="font-body" style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 12 }}>
              {t('automationsHub.actionsPerDay')}
            </h3>
            <DailyBars data={usage?.byDay || []} lang={i18n.resolvedLanguage} />
            <div className="flex items-center gap-4" style={{ marginTop: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
              <LegendDot color="#00C875" label={t('automationsHub.ok', { count: usage?.byStatus?.ok || 0 })} />
              <LegendDot color="#E2445C" label={t('automationsHub.failed', { count: usage?.byStatus?.failed || 0 })} />
              <LegendDot color="var(--color-border-strong)" label={t('automationsHub.skipped', { count: usage?.byStatus?.skipped || 0 })} />
            </div>
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <BarChart title={t('automationsHub.topBoards')} icon={Workflow} data={boardBars} />
            <BarChart title={t('automationsHub.topCreators')} icon={Power} data={creatorBars} />
          </div>

          <BarChart title={t('automationsHub.byActionType')} icon={Zap} data={actionBars} />
        </>
      )}
    </div>
  );
};

const DailyBars = ({ data, lang }) => {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1" style={{ height: 120 }}>
      {data.map((d) => {
        const h = Math.round((d.count / max) * 100);
        const dt = new Date(`${d.date}T00:00:00`);
        const label = dt.toLocaleDateString(lang || undefined, { month: 'short', day: 'numeric' });
        return (
          <div key={d.date} className="flex-1 flex flex-col justify-end" style={{ minWidth: 3 }} title={`${label}: ${d.count}`}>
            <div
              style={{
                height: `${h}%`,
                minHeight: d.count > 0 ? 3 : 0,
                background: d.count > 0 ? 'var(--color-accent)' : 'transparent',
                borderRadius: '3px 3px 0 0',
                transition: 'height 300ms ease-out',
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

const LegendDot = ({ color, label }) => (
  <span className="inline-flex items-center gap-1.5">
    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
    {label}
  </span>
);

// ---- Connections ----------------------------------------------------------
const CHANNEL_META = {
  email: { icon: Mail, color: '#00A9FF' },
  sms: { icon: Phone, color: '#00C875' },
  whatsapp: { icon: MessageSquare, color: '#25D366' },
  webhooks: { icon: Webhook, color: '#FF642E' },
  calendar: { icon: CalendarClock, color: '#7E5EF2' },
};

const ConnectionsSection = ({ orgId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toastError = useToastStore((s) => s.error);
  const [channels, setChannels] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setLoading(true);
    automationService
      .getConnections(orgId)
      .then((data) => { if (!cancelled) setChannels(data); })
      .catch((err) => { if (!cancelled) toastError(err?.response?.data?.error || t('automationsHub.loadError')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, toastError, t]);

  if (loading && !channels) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>{t('automationsHub.loading')}</div>;
  }

  const order = ['email', 'sms', 'whatsapp', 'webhooks', 'calendar'];

  // Per-channel subtitle: live status detail when connected, else the generic blurb.
  const subtitleFor = (key, c) => {
    if (!c) return t(`automationsHub.channelDesc.${key}`);
    if (key === 'email' && c.connected) return t('automationsHub.emailConnected', { count: c.count });
    if (key === 'sms' && c.connected && c.defaultFrom) return c.defaultFrom;
    if (key === 'whatsapp' && c.connected && c.sender) return c.sender;
    if (key === 'webhooks' && c.connected) return t('automationsHub.webhooksConnected', { count: c.count });
    return t(`automationsHub.channelDesc.${key}`);
  };

  const goManage = (key, c) => {
    if (key === 'webhooks') {
      const b = c?.boards?.[0];
      navigate(b ? `/boards/${b._id}/integrations` : '/boards');
      return;
    }
    navigate(c?.manageLink || '/settings');
  };

  return (
    <div>
      <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 14 }}>
        {t('automationsHub.connectionsIntro')}
      </p>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {order.map((key) => {
          const meta = CHANNEL_META[key];
          const c = channels ? channels[key] : null;
          const Icon = meta.icon;
          const connected = !!c?.connected;
          const calendarUnavailable = key === 'calendar' && c && c.available === false && !connected;
          return (
            <div key={key} className="bg-surface flex items-start gap-3" style={{ padding: 16, borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: `${meta.color}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={20} color={meta.color} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-body" style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{t(`automationsHub.channel.${key}`)}</span>
                  <ConnBadge connected={connected} soon={calendarUnavailable} t={t} />
                </div>
                <div className="font-body truncate" style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {subtitleFor(key, c)}
                </div>
                <button
                  type="button"
                  onClick={() => goManage(key, c)}
                  className="font-body"
                  style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: 'var(--color-accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  {(connected ? t('automationsHub.manage') : t('automationsHub.connect'))} →
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ConnBadge = ({ connected, soon, t }) => {
  const { label, color } = soon
    ? { label: t('automationsHub.comingSoon'), color: '#A25DDC' }
    : connected
      ? { label: t('automationsHub.connected'), color: '#00C875' }
      : { label: t('automationsHub.notConnected'), color: 'var(--color-text-muted)' };
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color, background: connected && !soon ? '#00C8751A' : 'var(--color-bg-subtle)', borderRadius: 'var(--radius-full)', padding: '2px 7px' }}
    >
      {connected && !soon && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00C875' }} />}
      {label}
    </span>
  );
};

// ---- shared bits ----------------------------------------------------------
const SearchBox = ({ value, onChange, placeholder }) => (
  <div
    className="inline-flex items-center gap-2"
    style={{ height: 36, padding: '0 12px', borderRadius: 'var(--radius-md)', border: '1.5px solid var(--color-border-strong)', background: 'var(--color-bg-surface, #fff)', width: 300, maxWidth: '100%' }}
  >
    <Search size={15} color="var(--color-text-muted)" aria-hidden="true" />
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="font-body focus:outline-none"
      style={{ border: 'none', background: 'transparent', fontSize: 13, flex: 1, minWidth: 0, color: 'var(--color-text-primary)' }}
    />
  </div>
);

const EmptyBlock = ({ icon: Icon, title, desc }) => (
  <div className="bg-surface flex flex-col items-center justify-center text-center" style={{ padding: 48, borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)' }}>
    <Icon size={36} color="var(--color-text-muted)" aria-hidden="true" />
    <p className="font-body" style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 12 }}>{title}</p>
    <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4, maxWidth: 320 }}>{desc}</p>
  </div>
);

const badgeStyle = (color) => ({
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color,
  background: `${color}1A`,
  borderRadius: 'var(--radius-full)',
  padding: '2px 7px',
  whiteSpace: 'nowrap',
});

const Avatar = ({ user, size = 26 }) => {
  const [err, setErr] = useState(false);
  const name = user?.name || '';
  const initial = name.charAt(0).toUpperCase() || '?';
  const base = { width: size, height: size, borderRadius: '50%', flexShrink: 0 };
  if (user?.profilePic && !err) {
    return <img src={user.profilePic} alt={name} title={name} style={{ ...base, objectFit: 'cover' }} onError={() => setErr(true)} />;
  }
  return (
    <span title={name} className="inline-flex items-center justify-center font-body font-semibold" style={{ ...base, background: 'var(--color-accent-light)', color: 'var(--color-accent-text)', fontSize: Math.round(size * 0.4) }}>
      {initial}
    </span>
  );
};

export default AutomationsHubPage;
