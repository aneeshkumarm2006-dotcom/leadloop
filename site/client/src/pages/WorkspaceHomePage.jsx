import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Home, UserPlus, LayoutList, Users, Lock, Globe,
  LayoutGrid, BarChart3, Folder, CheckCircle, Clock, TrendingUp,
  Search, SlidersHorizontal, FileText, ChevronRight, Plus,
} from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import StatCard from '../components/ui/StatCard';
import RecentBoards from '../components/dashboard/RecentBoards';
import MyDayRow from '../components/dashboard/MyDayRow';
import WorkspaceDashboard from '../components/analytics/WorkspaceDashboard';
import MarketingReport from '../components/analytics/MarketingReport';
import PermissionsTab from '../components/workspace/PermissionsTab';
import useOrgStore from '../store/orgStore';
import useAuthStore from '../store/authStore';
import useBoardStore from '../store/boardStore';
import { getDashboardStats } from '../services/boardService';
import { timeAgo, formatDate } from '../utils/dateUtils';

/**
 * WorkspaceHomePage (Phase 3.0 / Stage A) — the Monday-style workspace home:
 * a cover banner + workspace icon + name, an Invite action, and tabs
 * (Content / Collaborators / Permissions). One company = one Organisation = a
 * Workspace; boards live inside it (folders land in Stage B).
 */

// Premium hero cover — indigo→cyan with soft radial glows (adapted from the
// Claude-design Home concept).
const COVER_GRADIENT =
  'radial-gradient(420px circle at 86% -45%, rgba(129,140,248,0.60), transparent 60%),' +
  'radial-gradient(460px circle at 32% 165%, rgba(34,211,238,0.32), transparent 60%),' +
  'linear-gradient(135deg, #4F46E5 0%, #6366F1 46%, #0E7490 120%)';
// Signature gradient for the workspace logo tile.
const LOGO_GRADIENT = 'linear-gradient(140deg, #3E6B4E, #284A36)';

const AVATAR_COLORS = ['#3E6B4E', '#16A34A', '#EA580C', '#7C3AED', '#D97706', '#DC2626'];
const colorFor = (seed = '') => {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};

const Th = ({ children, align = 'left', style }) => (
  <th
    className="font-body"
    style={{
      textAlign: align,
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--color-text-muted)',
      padding: '10px 14px',
      borderBottom: '1px solid var(--color-border)',
      ...style,
    }}
  >
    {children}
  </th>
);
const Td = ({ children, align = 'left', style, ...rest }) => (
  <td
    className="font-body"
    style={{ textAlign: align, fontSize: 13, color: 'var(--color-text-primary)', padding: '10px 14px', ...style }}
    {...rest}
  >
    {children}
  </td>
);

const ContentTab = ({ boards, members = [], onOpen }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());

  // Resolve a board's creator from the org member list (boards carry createdBy
  // as an id only).
  const memberById = useMemo(() => {
    const m = new Map();
    for (const u of members) m.set(String(u._id), u);
    return m;
  }, [members]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return boards;
    return boards.filter((b) => (b.name || '').toLowerCase().includes(q));
  }, [boards, query]);

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = filtered.length > 0 && filtered.every((b) => selected.has(b._id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(filtered.map((b) => b._id)));

  return (
    <div>
      {/* Toolbar: search + filters */}
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 12 }}>
        <div
          className="inline-flex items-center gap-2"
          style={{ height: 34, padding: '0 10px', borderRadius: 'var(--radius-md)', border: '1.5px solid var(--color-border-strong)', background: 'var(--color-bg-surface, #fff)', width: 240, maxWidth: '100%' }}
        >
          <Search size={14} color="var(--color-text-muted)" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('workspace.searchAssets')}
            className="font-body focus:outline-none"
            style={{ border: 'none', background: 'transparent', fontSize: 13, flex: 1, minWidth: 0, color: 'var(--color-text-primary)' }}
          />
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 font-body"
          style={{ height: 34, padding: '0 12px', fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', background: 'transparent', border: '1.5px solid var(--color-border-strong)', borderRadius: 'var(--radius-md)', cursor: 'default' }}
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          {t('workspace.filters')}
        </button>
        {selected.size > 0 && (
          <span className="font-body" style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--color-text-muted)' }}>
            {t('workspace.selectedCount', { count: selected.size })}
          </span>
        )}
      </div>

      {boards.length === 0 ? (
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 4px' }}>
          {t('workspace.noBoards')}
        </p>
      ) : (
        <div className="bg-surface" style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  <Th style={{ width: 40 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t('workspace.selectAll')} style={{ width: 15, height: 15, accentColor: 'var(--color-accent)', cursor: 'pointer' }} />
                  </Th>
                  <Th>{t('workspace.colAssetName')}</Th>
                  <Th style={{ width: 110 }}>{t('workspace.colAiSummary')}</Th>
                  <Th style={{ width: 90 }}>{t('workspace.colCreator')}</Th>
                  <Th style={{ width: 130 }}>{t('workspace.colCreated')}</Th>
                  <Th style={{ width: 130 }}>{t('workspace.colLastModified')}</Th>
                  <Th style={{ width: 160 }}>{t('workspace.colFolder')}</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const creator = memberById.get(String(b.createdBy));
                  return (
                    <tr
                      key={b._id}
                      className="transition-colors hover:bg-[color:var(--color-bg-subtle)]"
                      style={{ borderTop: '1px solid var(--color-border)' }}
                    >
                      <Td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(b._id)} onChange={() => toggle(b._id)} aria-label={t('workspace.selectNamed', { name: b.name })} style={{ width: 15, height: 15, accentColor: 'var(--color-accent)', cursor: 'pointer' }} />
                      </Td>
                      <Td onClick={() => onOpen(b)} style={{ cursor: 'pointer' }}>
                        <span className="inline-flex items-center gap-2">
                          <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--color-accent-light)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <LayoutList size={13} color="var(--color-accent)" />
                          </span>
                          <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{b.name}</span>
                          {b.visibility !== 'public' && <Lock size={12} color="var(--color-text-muted)" />}
                        </span>
                      </Td>
                      <Td>
                        <FileText size={15} color="var(--color-text-muted)" aria-label={t('workspace.aiSummaryUnavailable')} style={{ opacity: 0.5 }} />
                      </Td>
                      <Td>
                        <CreatorAvatar user={creator} />
                      </Td>
                      <Td style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{b.createdAt ? formatDate(b.createdAt) : '—'}</Td>
                      <Td style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{b.updatedAt ? formatDate(b.updatedAt) : '—'}</Td>
                      <Td style={{ color: 'var(--color-text-muted)' }}>
                        {b.folderName ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Folder size={13} />
                            {b.folderName}
                          </span>
                        ) : '—'}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const CreatorAvatar = ({ user, size = 26 }) => {
  const name = user?.name || user?.email || '';
  if (user?.profilePic) {
    return <img src={user.profilePic} alt={name} title={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />;
  }
  return (
    <span
      title={name || '—'}
      className="inline-flex items-center justify-center font-display font-bold text-white"
      style={{ width: size, height: size, borderRadius: '50%', background: colorFor(user?.email || name || '?'), fontSize: Math.round(size * 0.42) }}
    >
      {(name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
};

const CollaboratorsTab = ({ members, adminId }) => {
  const { t } = useTranslation();
  if (!members || members.length === 0) {
    return <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 4px' }}>{t('workspace.noMembers')}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {members.map((m) => (
        <div key={m._id} className="bg-surface flex items-center gap-3" style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: '10px 14px' }}>
          <div className="flex items-center justify-center font-display font-bold text-white shrink-0" style={{ width: 32, height: 32, borderRadius: 9999, background: colorFor(m.email || m.name || ''), fontSize: 13 }}>
            {(m.name || m.email || '?').trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-body" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{m.name || m.email}</p>
            <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{m.email}</p>
          </div>
          <span className="font-body" style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
            {String(m._id) === String(adminId) ? t('workspace.roleAdmin') : t('workspace.roleMember')}
          </span>
        </div>
      ))}
    </div>
  );
};

const OverviewTab = ({ stats, boards }) => {
  const { t } = useTranslation();
  const cards = [
    { icon: Folder, label: t('dashboard.statTotalBoards'), value: stats.totalBoards, color: 'blue' },
    { icon: CheckCircle, label: t('dashboard.statCompletedLeads'), value: stats.completedTasks, color: 'green' },
    { icon: Clock, label: t('dashboard.statPendingLeads'), value: stats.pendingTasks, color: 'orange' },
    { icon: TrendingUp, label: t('dashboard.statCompletionRate'), value: stats.completionRate, suffix: '%', color: 'purple' },
  ];
  return (
    <div className="flex flex-col gap-6">
      <MyDayRow />
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} icon={c.icon} label={c.label} value={c.value} suffix={c.suffix} color={c.color} />
        ))}
      </div>
      <RecentBoards boards={boards} />
    </div>
  );
};

const INITIAL_STATS = { totalBoards: 0, completedTasks: 0, pendingTasks: 0, completionRate: 0 };

const WorkspaceHomePage = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const members = useOrgStore((s) => s.members);
  const fetchMembers = useOrgStore((s) => s.fetchMembers);
  const adminId = useOrgStore((s) => s.adminId);
  const boards = useBoardStore((s) => s.boards);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(INITIAL_STATS);

  const orgId = currentOrg?._id || null;
  const isAdmin =
    (!!user && String(adminId || '') === String(user._id)) ||
    (!!user && Array.isArray(currentOrg?.admins) && currentOrg.admins.some((a) => String(typeof a === 'object' && a ? a._id || a : a) === String(user._id)));

  useEffect(() => {
    if (!orgId) return;
    fetchBoards(orgId).catch(() => {});
    fetchMembers(orgId).catch(() => {});
    getDashboardStats(orgId).then((d) => setStats(d || INITIAL_STATS)).catch(() => {});
  }, [orgId, fetchBoards, fetchMembers]);

  const name = currentOrg?.displayName || currentOrg?.name || t('workspace.untitled');
  const initial = name.trim().charAt(0).toUpperCase();

  // Personal greeting (hero) — time-of-day + first name + role + date.
  const now = new Date();
  const hour = now.getHours();
  const greetKey = hour < 12 ? 'workspace.greetMorning' : hour < 18 ? 'workspace.greetAfternoon' : 'workspace.greetEvening';
  const firstName = (user?.name || '').trim().split(/\s+/)[0] || (user?.email || '').split('@')[0];
  const dateStr = now.toLocaleDateString(i18n.resolvedLanguage || undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const quickActions = [
    { key: 'newLead', icon: Plus, primary: true, onClick: () => navigate(boards[0]?._id ? `/boards/${boards[0]._id}` : '/boards') },
    { key: 'newBoard', icon: LayoutGrid, onClick: () => navigate('/boards') },
    { key: 'shareForm', icon: FileText, onClick: () => navigate('/forms/new') },
  ];

  const tabs = useMemo(
    () => [
      { key: 'overview', label: t('workspace.overview'), icon: LayoutGrid },
      { key: 'content', label: t('workspace.content'), icon: LayoutList },
      { key: 'collaborators', label: t('workspace.collaborators'), icon: Users },
      ...(isAdmin ? [{ key: 'reports', label: t('workspace.reports'), icon: BarChart3 }] : []),
      ...(isAdmin ? [{ key: 'permissions', label: t('workspace.permissions'), icon: Lock }] : []),
    ],
    [t, isAdmin]
  );

  return (
    <PageWrapper>
      {/* Cover banner */}
      <div style={{ height: 150, borderRadius: 'var(--radius-lg)', background: COVER_GRADIENT, boxShadow: 'var(--shadow-card)' }} />

      {/* Workspace identity */}
      <div className="flex items-end gap-4" style={{ marginTop: -30, paddingLeft: 8 }}>
        <div
          className="flex items-center justify-center font-display font-bold text-white shrink-0"
          style={{ width: 76, height: 76, borderRadius: 19, background: LOGO_GRADIENT, fontSize: 30, border: '4px solid var(--color-bg-surface)', boxShadow: 'var(--shadow-md)' }}
          aria-hidden="true"
        >
          {initial}
        </div>
        <div className="flex-1 min-w-0 pb-1 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display font-bold" style={{ fontSize: 26, color: 'var(--color-text-primary)', lineHeight: 1.1 }}>{name}</h1>
            <div className="flex items-center gap-2 font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 3 }}>
              <span>{t('workspace.boardCount', { count: boards.length })}</span>
              <span style={{ color: 'var(--color-border-strong)' }}>•</span>
              <span>{t('workspace.memberCount', { count: members.length })}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/members')}
            className="inline-flex items-center gap-1.5 font-body transition-colors hover:brightness-95"
            style={{ height: 36, padding: '0 14px', fontSize: 14, fontWeight: 600, borderRadius: 'var(--radius-md)', background: 'var(--color-accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            <UserPlus size={15} /> {t('workspace.invite')}
          </button>
        </div>
      </div>

      {/* Personal greeting + quick actions */}
      <div className="flex items-end justify-between gap-4 flex-wrap" style={{ marginTop: 18, paddingLeft: 8 }}>
        <div className="flex items-center gap-3">
          <CreatorAvatar user={user} size={44} />
          <div>
            <h2 className="font-display font-bold" style={{ fontSize: 20, color: 'var(--color-text-primary)', lineHeight: 1.15 }}>
              {t(greetKey, { name: firstName })}
            </h2>
            <div className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {dateStr} · <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{isAdmin ? t('workspace.roleAdmin') : t('workspace.roleAgent')}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap" role="group" aria-label={t('workspace.quickActions')}>
          {quickActions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.key}
                type="button"
                onClick={a.onClick}
                className="inline-flex items-center gap-2 font-body transition-all duration-150 hover:-translate-y-px"
                style={{
                  height: 40, padding: '0 15px', fontSize: 13.5, fontWeight: 600, borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  background: a.primary ? 'var(--color-accent)' : 'var(--color-bg-surface, #fff)',
                  color: a.primary ? '#fff' : 'var(--color-text-secondary)',
                  border: a.primary ? '1.5px solid var(--color-accent)' : '1.5px solid var(--color-border-strong)',
                  boxShadow: a.primary ? '0 3px 12px -3px var(--color-accent)' : 'none',
                }}
              >
                <Icon size={16} /> {t(`workspace.qa.${a.key}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex items-center gap-1" role="tablist" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {tabs.map((x) => {
          const active = tab === x.key;
          const Icon = x.icon;
          return (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(x.key)}
              className="inline-flex items-center gap-1.5 font-body whitespace-nowrap transition-colors duration-150"
              style={{
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                padding: '8px 14px',
                color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <Icon size={15} /> {x.label}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {tab === 'overview' && <OverviewTab stats={stats} boards={boards} />}
        {tab === 'content' && <ContentTab boards={boards} members={members} onOpen={(b) => navigate(`/boards/${b._id}`)} />}
        {tab === 'collaborators' && <CollaboratorsTab members={members} adminId={adminId} />}
        {tab === 'reports' && (
          <>
            <WorkspaceDashboard orgId={orgId} isAdmin={isAdmin} />
            {isAdmin && <MarketingReport orgId={orgId} />}
          </>
        )}
        {tab === 'permissions' && (
          <PermissionsTab orgId={orgId} boards={boards} members={members} currentUserId={user?._id} />
        )}
      </div>
    </PageWrapper>
  );
};

export default WorkspaceHomePage;
