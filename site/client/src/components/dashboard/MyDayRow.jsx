import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Inbox, Calendar, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import { getMyTasks } from '../../services/taskService';
import useOrgStore from '../../store/orgStore';

/**
 * MyDayRow — the personal "agent cockpit" row (adapted from the Claude-design
 * Home concept). Three cards: My leads, Today's & upcoming visits (empty until
 * the booking system ships), and Follow-ups due (overdue flagged). Driven by the
 * real `GET /api/tasks/my` assigned-leads data.
 */
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const relDue = (iso, t) => {
  if (!iso) return { label: '—', tone: 'norm' };
  const days = Math.round((new Date(iso).setHours(0, 0, 0, 0) - startOfToday().getTime()) / 86400000);
  if (days < 0) return { label: t('myDay.overdueDays', { count: Math.abs(days) }), tone: 'over' };
  if (days === 0) return { label: t('myDay.today'), tone: 'soon' };
  if (days === 1) return { label: t('myDay.tomorrow'), tone: 'norm' };
  return { label: new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), tone: 'norm' };
};

const toneColor = { over: '#DC2626', soon: '#D97706', norm: 'var(--color-text-muted)' };

const statusOf = (task) => {
  const statuses = task.board?.statuses || [];
  const id = task.status != null ? task.status.toString() : null;
  if (!id) return null;
  return statuses.find((s) => (s._id || s.id || '').toString() === id) || null;
};

const MyDayRow = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const [leads, setLeads] = useState(null); // null = loading
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!currentOrg?._id) return undefined;
    let cancelled = false;
    setLeads(null);
    getMyTasks(currentOrg._id)
      .then((list) => { if (!cancelled) setLeads(Array.isArray(list) ? list.filter((x) => !x.isPersonal) : []); })
      .catch(() => { if (!cancelled) { setLeads([]); setError(true); } });
    return () => { cancelled = true; };
  }, [currentOrg?._id]);

  const myLeads = useMemo(() => (leads || []).slice(0, 6), [leads]);
  const followUps = useMemo(
    () => (leads || []).filter((l) => l.dueDate).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 6),
    [leads]
  );
  const overdueCount = useMemo(
    () => (leads || []).filter((l) => l.dueDate && new Date(l.dueDate).setHours(0, 0, 0, 0) < startOfToday().getTime()).length,
    [leads]
  );

  const openLead = (l) => l.board?._id && navigate(`/boards/${l.board._id}`);

  return (
    <section style={{ marginBottom: 22 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
        <h2 className="font-display font-bold" style={{ fontSize: 17, color: 'var(--color-text-primary)' }}>{t('myDay.title')}</h2>
        <span className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>· {t('myDay.subtitle')}</span>
        <button
          type="button"
          onClick={() => navigate('/my-tasks')}
          className="font-body inline-flex items-center gap-1"
          style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: 'var(--color-accent)', background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          {t('myDay.viewAll')} →
        </button>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {/* My leads */}
        <Card icon={Inbox} color="var(--color-accent)" title={t('myDay.myLeads')} count={leads ? myLeads.length : null}>
          {leads == null ? (
            <Skeleton n={4} />
          ) : myLeads.length === 0 ? (
            <Empty icon={Inbox} title={t('myDay.noLeadsTitle')} sub={t('myDay.noLeadsSub')} />
          ) : (
            myLeads.map((l) => {
              const st = statusOf(l);
              const due = relDue(l.dueDate, t);
              return (
                <Row key={l._id} onClick={() => openLead(l)}>
                  <Tile color={st?.color || 'var(--color-border-strong)'} text={initials(l.name)} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="truncate font-body" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary)' }}>{l.name}</div>
                    <div className="truncate font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{l.board?.name || ''}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {st && <Pill color={st.color}>{st.name}</Pill>}
                    {l.dueDate && <div className="font-body" style={{ fontSize: 11, color: toneColor[due.tone], marginTop: 4, fontWeight: 600 }}>{due.label}</div>}
                  </div>
                </Row>
              );
            })
          )}
        </Card>

        {/* Today's & upcoming visits — empty until the booking system ships */}
        <Card icon={Calendar} color="#7C3AED" title={t('myDay.visits')} count={leads ? 0 : null}>
          {leads == null ? <Skeleton n={3} /> : (
            <Empty icon={Calendar} title={t('myDay.noVisitsTitle')} sub={t('myDay.noVisitsSub')} />
          )}
        </Card>

        {/* Follow-ups due */}
        <Card
          icon={Clock}
          color="#D97706"
          title={t('myDay.followUps')}
          count={leads ? followUps.length : null}
          foot={leads && overdueCount > 0 ? (
            <div className="flex items-center gap-1.5 font-body" style={{ padding: '10px 16px', borderTop: '1px solid var(--color-border)', color: '#DC2626', fontSize: 12.5, fontWeight: 600 }}>
              <AlertTriangle size={15} /> {t('myDay.overdueFoot', { count: overdueCount })}
            </div>
          ) : null}
        >
          {leads == null ? (
            <Skeleton n={3} />
          ) : followUps.length === 0 ? (
            <Empty icon={CheckCircle} title={t('myDay.allCaughtUpTitle')} sub={t('myDay.allCaughtUpSub')} />
          ) : (
            followUps.map((l) => {
              const due = relDue(l.dueDate, t);
              const overdue = due.tone === 'over';
              return (
                <Row key={l._id} onClick={() => openLead(l)} style={overdue ? { background: '#FEF2F2' } : undefined}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: overdue ? '#DC2626' : '#D97706', flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="truncate font-body" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary)' }}>{l.name}</div>
                    <div className="truncate font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{l.board?.name || ''}</div>
                  </div>
                  <div className="font-body" style={{ fontSize: 11.5, color: toneColor[due.tone], fontWeight: 700, flexShrink: 0 }}>{due.label}</div>
                </Row>
              );
            })
          )}
        </Card>
      </div>
      {error && null}
    </section>
  );
};

const initials = (name) => (name || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

const Card = ({ icon: Icon, color, title, count, children, foot }) => (
  <div className="bg-surface flex flex-col" style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
    <div className="flex items-center gap-2.5" style={{ padding: '13px 16px', borderBottom: '1px solid var(--color-border)' }}>
      <span style={{ width: 30, height: 30, borderRadius: 8, background: `color-mix(in srgb, ${color} 14%, transparent)`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon size={16} color={color} />
      </span>
      <h3 className="font-body" style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</h3>
      {count != null && (
        <span className="font-body" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-full)', padding: '1px 9px' }}>{count}</span>
      )}
    </div>
    <div style={{ padding: 6, flex: 1 }}>{children}</div>
    {foot}
  </div>
);

const Row = ({ children, onClick, style }) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => { if (e.key === 'Enter') onClick?.(); }}
    className="flex items-center gap-3 transition-colors hover:bg-[color:var(--color-bg-subtle)]"
    style={{ minHeight: 52, padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', ...style }}
  >
    {children}
  </div>
);

const Tile = ({ color, text }) => (
  <span className="font-display font-bold text-white" style={{ width: 32, height: 32, borderRadius: 8, background: color, display: 'grid', placeItems: 'center', fontSize: 12, flexShrink: 0 }}>{text}</span>
);

const Pill = ({ color, children }) => (
  <span className="inline-flex items-center font-body" style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: color, borderRadius: 'var(--radius-full)', padding: '2px 9px', whiteSpace: 'nowrap' }}>{children}</span>
);

const Empty = ({ icon: Icon, title, sub }) => (
  <div className="flex flex-col items-center justify-center text-center" style={{ padding: '28px 16px' }}>
    <span style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', marginBottom: 10 }}>
      <Icon size={20} color="var(--color-text-muted)" />
    </span>
    <div className="font-body" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</div>
    <div className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 3, maxWidth: 220 }}>{sub}</div>
  </div>
);

const Skeleton = ({ n = 4 }) => (
  <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
    {Array.from({ length: n }).map((_, i) => (
      <div key={i} className="flex items-center gap-3" style={{ padding: '9px 10px' }}>
        <span className="skeleton" style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <span className="skeleton" style={{ display: 'block', width: '60%', height: 11, borderRadius: 4 }} />
          <span className="skeleton" style={{ display: 'block', width: '38%', height: 9, borderRadius: 4, marginTop: 6 }} />
        </div>
      </div>
    ))}
  </div>
);

export default MyDayRow;
