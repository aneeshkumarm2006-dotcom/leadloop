import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Timer, AlertTriangle, Check } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import EmptyState from '../components/onboarding/EmptyState';
import useOrgStore from '../store/orgStore';
import { getSla, formatDuration } from '../services/slaService';

/**
 * ResponseClockPage — how fast leads are being answered, and which ones are
 * still waiting.
 *
 * The countdown ticks locally between refreshes so it feels live, but every
 * lead's STATE comes from the server — a device with a wrong clock must not
 * decide whether an SLA was met.
 */

const card = {
  background: 'var(--color-bg-surface, #fff)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
};

const COLOR = {
  pending: 'var(--color-status-done)',
  warning: 'var(--color-status-working-solid, #C79A3E)',
  breached: 'var(--color-status-stuck)',
};

/** A countdown ring — colour and sweep encode urgency at a glance. */
const Ring = ({ percent, label, tone }) => {
  const r = 16;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100);
  return (
    <div style={{ position: 'relative', width: 40, height: 40, flex: '0 0 40px' }}>
      <svg width="40" height="40" viewBox="0 0 40 40" style={{ transform: 'rotate(-90deg)', display: 'block' }} aria-hidden="true">
        <circle cx="20" cy="20" r={r} fill="none" stroke="var(--color-bg-subtle)" strokeWidth="4" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke={COLOR[tone] || COLOR.pending}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset .9s linear' }}
        />
      </svg>
      <b
        className="font-mono"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          fontSize: 9.5,
          fontWeight: 700,
          color: 'var(--color-text-primary)',
        }}
      >
        {label}
      </b>
    </div>
  );
};

const Stat = ({ value, label, color }) => (
  <div>
    <b className="font-heading" style={{ display: 'block', fontSize: 22, fontWeight: 800, color: color || 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </b>
    <span className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</span>
  </div>
);

const ResponseClockPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;

  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    if (!orgId) return;
    getSla(orgId)
      .then(setData)
      .catch(() => setData({ queue: [], summary: {}, policy: {} }));
  }, [orgId]);

  useEffect(() => {
    load();
    // Re-fetch every 30s; the countdown itself ticks locally in between.
    const poll = setInterval(load, 30_000);
    const local = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(local);
    };
  }, [load]);

  const summary = data?.summary || {};
  const queue = data?.queue || [];
  const target = data?.policy?.targetMinutes;

  return (
    <PageWrapper>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '4px 2px 40px' }}>
        <div className="flex items-center gap-3" style={{ marginBottom: 6 }}>
          <span className="inline-flex items-center justify-center" style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--color-accent-light, #EEF3EA)', color: 'var(--color-accent)' }}>
            <Timer size={18} />
          </span>
          <h1 className="font-heading" style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-text-primary)' }}>
            {t('sla.title', 'Response clock')}
          </h1>
        </div>
        <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 20, maxWidth: 620 }}>
          {t('sla.subtitle', 'New leads go cold fast. Anything still unanswered when the clock runs out is handed to someone else automatically.')}
        </p>

        {/* Today's numbers */}
        <div style={{ ...card, padding: 18, marginBottom: 18 }}>
          <div className="flex items-center justify-between gap-5 flex-wrap">
            <div className="flex items-center gap-6 flex-wrap">
              <Stat
                value={summary.medianMs != null ? formatDuration(summary.medianMs) : '—'}
                label={t('sla.median', 'Median first response')}
              />
              <Stat
                value={summary.withinTargetPercent != null ? `${summary.withinTargetPercent}%` : '—'}
                label={t('sla.withinTarget', 'Within target')}
                color="var(--color-status-done)"
              />
              <Stat
                value={summary.breached ?? 0}
                label={t('sla.breached', 'Breached')}
                color={(summary.breached ?? 0) > 0 ? 'var(--color-status-stuck)' : undefined}
              />
              <Stat value={summary.pending ?? 0} label={t('sla.waiting', 'Still waiting')} />
            </div>
            {target != null && (
              <span className="font-body" style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
                {t('sla.target', 'Target · {{n}} min', { n: target })}
              </span>
            )}
          </div>
        </div>

        {/* The queue */}
        {data === null ? (
          <div className="skeleton" style={{ height: 180, borderRadius: 12 }} />
        ) : queue.length === 0 ? (
          <EmptyState
            icon={Check}
            title={t('sla.emptyTitle', 'Every lead has been answered')}
            body={t('sla.emptyBody', 'New leads appear here the moment they arrive, with a countdown to your target response time.')}
          />
        ) : (
          <div style={{ ...card, overflow: 'hidden' }}>
            {queue.map((lead) => {
              const breached = lead.state === 'breached';
              // Count down live between the 30s server refreshes, derived from
              // the server's deadline so a wrong device clock only affects the
              // display — never whether the SLA counts as met. `tick` is the
              // 1s re-render trigger.
              void tick;
              const remaining = Math.max(0, new Date(lead.dueAt).getTime() - Date.now());
              return (
                <div
                  key={lead._id}
                  onClick={() => navigate(`/boards/${lead.boardId}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === 'Enter' ? navigate(`/boards/${lead.boardId}`) : null)}
                  className="flex items-center gap-3 flex-wrap"
                  style={{ padding: '13px 16px', borderBottom: '1px solid var(--color-border)', cursor: 'pointer' }}
                >
                  <Ring
                    percent={lead.percentElapsed}
                    tone={lead.state}
                    label={breached ? '!' : formatDuration(remaining)}
                  />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div className="font-heading" style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                      {lead.name}
                    </div>
                    <div className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {lead.boardName}
                      {lead.owner?.name ? ` · ${lead.owner.name}` : ` · ${t('sla.unassigned', 'Unassigned')}`}
                    </div>
                  </div>
                  {breached ? (
                    <span className="inline-flex items-center gap-1.5 font-body" style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: 'var(--color-status-stuck-bg, #F6E7E2)', color: 'var(--color-status-stuck)' }}>
                      <AlertTriangle size={12} />
                      {lead.escalated
                        ? t('sla.reassigned', 'Reassigned')
                        : t('sla.late', '{{time}} late', { time: formatDuration(lead.msLate) })}
                    </span>
                  ) : (
                    <span className="font-body" style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
                      {t('sla.dueIn', 'Due in {{time}}', { time: formatDuration(lead.msRemaining) })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageWrapper>
  );
};

export default ResponseClockPage;
