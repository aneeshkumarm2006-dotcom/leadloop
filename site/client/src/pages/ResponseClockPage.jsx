import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Check } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import { PageHeader, PageBody } from '../components/layout/PageHeader';
import EmptyState from '../components/onboarding/EmptyState';
import useOrgStore from '../store/orgStore';
import { getSla, formatDuration } from '../services/slaService';
import { timeAgo } from '../utils/dateUtils';

/**
 * ResponseClockPage — how fast leads are being answered, and which ones are
 * still waiting.
 *
 * The countdown ticks locally between refreshes so it feels live, but every
 * lead's STATE comes from the server — a device with a wrong clock must not
 * decide whether an SLA was met.
 */

const card = {
  background: 'var(--color-bg-surface)',
  borderRadius: 16,
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

/** One of the four headline tiles. */
const StatTile = ({ value, label, color }) => (
  <div style={{ ...card, padding: '18px 20px' }}>
    <div className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{label}</div>
    <div
      className="font-display"
      style={{ fontSize: 30, fontWeight: 750, marginTop: 4, lineHeight: 1.15, color: color || 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}
    >
      {value}
    </div>
  </div>
);

/** Text + background for the clock pill, by the server's state. */
const PILL = {
  pending: { color: 'var(--color-status-done)', background: 'var(--color-status-done-bg)' },
  warning: { color: 'var(--color-status-working)', background: 'var(--color-status-working-bg)' },
  breached: { color: 'var(--color-status-stuck)', background: 'var(--color-status-stuck-bg)' },
};

const ResponseClockPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;

  const [data, setData] = useState(null);
  // Wall-clock for the local countdown, refreshed every second.
  const [now, setNow] = useState(() => Date.now());

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
    const local = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(local);
    };
  }, [load]);

  const summary = data?.summary || {};
  const queue = data?.queue || [];
  const target = data?.policy?.targetMinutes;

  const th = { padding: '10px 12px', fontWeight: 700 };
  const td = { padding: '13px 12px', color: 'var(--color-text-secondary)' };

  return (
    <PageWrapper flush>
      <PageHeader
        title={t('sla.title', 'Response clock')}
        subtitle={t('sla.subtitle', 'New leads go cold fast. Anything still unanswered when the clock runs out is handed to someone else automatically.')}
        actions={
          target != null ? (
            <span
              className="font-body"
              style={{
                fontSize: 13,
                fontWeight: 700,
                padding: '6px 12px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-status-done-bg)',
                color: 'var(--color-status-done)',
              }}
            >
              {t('sla.target', 'Target · {{n}} min', { n: target })}
            </span>
          ) : null
        }
      />
      <PageBody className="flex flex-col" style={{ gap: 20 }}>
        {/* Today's numbers */}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <StatTile
            value={summary.medianMs != null ? formatDuration(summary.medianMs) : '—'}
            label={t('sla.median', 'Median first response')}
          />
          <StatTile
            value={summary.withinTargetPercent != null ? `${summary.withinTargetPercent}%` : '—'}
            label={t('sla.withinTarget', 'Within target')}
            color="var(--color-status-done)"
          />
          <StatTile
            value={summary.breached ?? 0}
            label={t('sla.breached', 'Breached')}
            color={(summary.breached ?? 0) > 0 ? 'var(--color-status-stuck)' : undefined}
          />
          <StatTile
            value={summary.pending ?? 0}
            label={t('sla.waiting', 'Still waiting')}
            color={(summary.pending ?? 0) > 0 ? 'var(--color-status-working)' : undefined}
          />
        </div>

        {/* The queue */}
        {data === null ? (
          <div className="skeleton" aria-busy="true" style={{ height: 220, borderRadius: 16 }} />
        ) : queue.length === 0 ? (
          <EmptyState
            icon={Check}
            title={t('sla.emptyTitle', 'Every lead has been answered')}
            body={t('sla.emptyBody', 'New leads appear here the moment they arrive, with a countdown to your target response time.')}
          />
        ) : (
          <section aria-labelledby="sla-queue-title" style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
              <h2 id="sla-queue-title" className="font-display" style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {t('sla.queueTitle', 'Waiting for a first reply')}
              </h2>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="font-body" style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)', fontSize: 12 }}>
                    <th scope="col" style={{ ...th, paddingLeft: 20 }}>{t('sla.colLead', 'Lead')}</th>
                    <th scope="col" style={th}>{t('sla.colBoard', 'Board')}</th>
                    <th scope="col" style={th}>{t('sla.colOwner', 'Owner')}</th>
                    <th scope="col" style={th}>{t('sla.colArrived', 'Arrived')}</th>
                    <th scope="col" style={{ ...th, paddingRight: 20, textAlign: 'right' }}>{t('sla.colClock', 'Clock')}</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((lead) => {
                    const breached = lead.state === 'breached';
                    // Count down live between the 30s server refreshes, derived
                    // from the server's deadline so a wrong device clock only
                    // affects the display — never whether the SLA counts as met.
                    const remaining = Math.max(0, new Date(lead.dueAt).getTime() - now);
                    const pill = PILL[lead.state] || PILL.pending;
                    const href = `/boards/${lead.boardId}`;
                    return (
                      <tr
                        key={lead._id}
                        onClick={() => navigate(href)}
                        className="transition-colors hover:bg-[color:var(--color-bg-input)]"
                        style={{ borderTop: '1px solid var(--color-bg-subtle)', cursor: 'pointer' }}
                      >
                        <td style={{ ...td, paddingLeft: 20 }}>
                          <Link
                            to={href}
                            onClick={(e) => e.stopPropagation()}
                            className="font-body hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
                            style={{ color: 'var(--color-text-primary)', fontWeight: 700, textDecoration: 'none' }}
                          >
                            {lead.name}
                          </Link>
                        </td>
                        <td style={td}>{lead.boardName || '—'}</td>
                        <td style={td}>{lead.owner?.name || t('sla.unassigned', 'Unassigned')}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{lead.createdAt ? timeAgo(lead.createdAt) : '—'}</td>
                        <td style={{ ...td, paddingRight: 20 }}>
                          <div className="flex items-center justify-end gap-2.5">
                            <span
                              className="inline-flex items-center gap-1.5"
                              style={{ fontSize: 12.5, fontWeight: 700, padding: '4px 10px', borderRadius: 'var(--radius-full)', whiteSpace: 'nowrap', ...pill }}
                            >
                              {breached && <AlertTriangle size={12} aria-hidden="true" />}
                              {breached
                                ? lead.escalated
                                  ? t('sla.reassigned', 'Reassigned')
                                  : t('sla.late', '{{time}} late', { time: formatDuration(lead.msLate) })
                                : t('sla.dueIn', 'Due in {{time}}', { time: formatDuration(lead.msRemaining) })}
                            </span>
                            <Ring percent={lead.percentElapsed} tone={lead.state} label={breached ? '!' : formatDuration(remaining)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </PageBody>
    </PageWrapper>
  );
};

export default ResponseClockPage;
