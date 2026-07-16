import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListChecks,
  TrendingUp,
  AlertTriangle,
  Folder,
  PieChart,
  Flag,
} from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import WorkspaceDashboard from '../components/analytics/WorkspaceDashboard';
import MarketingReport from '../components/analytics/MarketingReport';
import StatCard from '../components/ui/StatCard';
import {
  SkeletonStatCard,
  SkeletonBarChart,
  SkeletonBoardPerformance,
  SkeletonOverdueAssignees,
} from '../components/ui/Skeleton';
import Dropdown from '../components/ui/Dropdown';
import BarChart from '../components/analytics/BarChart';
import BoardPerformance from '../components/analytics/BoardPerformance';
import OverdueAssignees from '../components/analytics/OverdueAssignees';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';
import { getAnalytics } from '../services/analyticsService';

const STATUS_LABEL_KEYS = {
  not_started: 'pages.statusNotStarted',
  working_on_it: 'pages.statusWorkingOnIt',
  done: 'pages.statusDone',
  stuck: 'pages.statusStuck',
};

const STATUS_COLORS = {
  not_started: 'var(--color-status-notstarted)',
  working_on_it: 'var(--color-status-working)',
  done: 'var(--color-status-done)',
  stuck: 'var(--color-status-stuck)',
};

const PRIORITY_LABEL_KEYS = {
  critical: 'pages.priorityCritical',
  high: 'pages.priorityHigh',
  medium: 'pages.priorityMedium',
  low: 'pages.priorityLow',
};

const PRIORITY_COLORS = {
  critical: 'var(--color-priority-critical)',
  high: 'var(--color-priority-high)',
  medium: 'var(--color-priority-medium)',
  low: 'var(--color-priority-low)',
};

const RANGE_OPTION_KEYS = [
  { value: '7d', labelKey: 'pages.last7Days' },
  { value: '30d', labelKey: 'pages.last30Days' },
  { value: 'all', labelKey: 'pages.allTime' },
];

const INITIAL_SUMMARY = {
  totalTasks: 0,
  completionRate: 0,
  overdueTasks: 0,
  activeBoards: 0,
};

const INITIAL_OVERDUE = {
  count: 0,
  avgDaysOverdue: 0,
  byPriority: [],
  topAssignees: [],
};

/**
 * Determine whether the signed-in user is the admin of the current org.
 */
const useIsCurrentOrgAdmin = () => {
  const user = useAuthStore((s) => s.user);
  const currentOrg = useOrgStore((s) => s.currentOrg);
  if (!user || !currentOrg) return false;
  const adminId =
    typeof currentOrg.admin === 'object' && currentOrg.admin !== null
      ? currentOrg.admin._id || currentOrg.admin
      : currentOrg.admin;
  const isMainAdmin = !!adminId && String(adminId) === String(user._id);
  const isExtraAdmin = Array.isArray(currentOrg.admins) &&
    currentOrg.admins.some((a) => {
      const id = typeof a === 'object' && a !== null ? a._id || a : a;
      return String(id) === String(user._id);
    });
  return isMainAdmin || isExtraAdmin;
};

const AnalyticsPage = () => {
  const { t } = useTranslation();
  const isAdmin = useIsCurrentOrgAdmin();
  const currentOrg = useOrgStore((s) => s.currentOrg);

  const [boardFilter, setBoardFilter] = useState('all');
  const [range, setRange] = useState('30d');

  const [summary, setSummary] = useState(INITIAL_SUMMARY);
  const [statusDistribution, setStatusDistribution] = useState([]);
  const [priorityDistribution, setPriorityDistribution] = useState([]);
  const [boardPerformance, setBoardPerformance] = useState([]);
  const [overdue, setOverdue] = useState(INITIAL_OVERDUE);
  const [orgBoards, setOrgBoards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const orgId = currentOrg?._id || null;

  // Fetch analytics whenever filters change
  useEffect(() => {
    if (!orgId || !isAdmin) return undefined;
    let cancelled = false;

    // Defer the loading/error resets to a microtask so the setState doesn't
    // happen synchronously inside the effect body.
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });

    getAnalytics({ orgId, board: boardFilter, range })
      .then((data) => {
        if (cancelled) return;
        setSummary({ ...INITIAL_SUMMARY, ...data.summary });
        setStatusDistribution(data.statusDistribution || []);
        setPriorityDistribution(data.priorityDistribution || []);
        setBoardPerformance(data.boardPerformance || []);
        setOverdue({ ...INITIAL_OVERDUE, ...(data.overdue || {}) });
        setOrgBoards(data.boards || []);
      })
      .catch((err) => {
        console.error('Failed to load analytics:', err);
        if (cancelled) return;
        setError(t('pages.couldNotLoadAnalytics'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, isAdmin, boardFilter, range, t]);

  const boardOptions = useMemo(
    () => [
      { value: 'all', label: t('pages.allBoards') },
      ...orgBoards.map((b) => ({ value: b._id, label: b.name })),
    ],
    [orgBoards, t]
  );

  const rangeOptions = useMemo(
    () => RANGE_OPTION_KEYS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t]
  );

  const statusData = useMemo(
    () =>
      statusDistribution.map((row) => ({
        key: row.status,
        label: STATUS_LABEL_KEYS[row.status] ? t(STATUS_LABEL_KEYS[row.status]) : row.status,
        count: row.count,
        color: STATUS_COLORS[row.status] || 'var(--color-accent)',
      })),
    [statusDistribution, t]
  );

  const priorityData = useMemo(
    () =>
      priorityDistribution.map((row) => ({
        key: row.priority,
        label: PRIORITY_LABEL_KEYS[row.priority] ? t(PRIORITY_LABEL_KEYS[row.priority]) : row.priority,
        count: row.count,
        color: PRIORITY_COLORS[row.priority] || 'var(--color-accent)',
      })),
    [priorityDistribution, t]
  );

  const overduePriorityData = useMemo(
    () =>
      (overdue.byPriority || []).map((row) => ({
        key: row.priority,
        label: PRIORITY_LABEL_KEYS[row.priority] ? t(PRIORITY_LABEL_KEYS[row.priority]) : row.priority,
        count: row.count,
        color: PRIORITY_COLORS[row.priority] || 'var(--color-accent)',
      })),
    [overdue.byPriority, t]
  );

  const statCards = [
    {
      icon: ListChecks,
      label: t('pages.totalLeads'),
      value: summary.totalTasks,
      color: 'blue',
    },
    {
      icon: TrendingUp,
      label: t('pages.completionRate'),
      value: summary.completionRate,
      suffix: '%',
      color: 'green',
    },
    {
      icon: AlertTriangle,
      label: t('pages.overdueLeads'),
      value: summary.overdueTasks,
      color: 'red',
      subLabel:
        overdue.count > 0
          ? t('pages.avgDaysOverdue', { count: overdue.avgDaysOverdue })
          : t('pages.noOverdueLeads'),
    },
    {
      icon: Folder,
      label: t('pages.activeBoards'),
      value: summary.activeBoards,
      color: 'purple',
    },
  ];

  return (
    <PageWrapper>
      {/* Page header with filters */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1
            className="font-display font-bold"
            style={{
              fontSize: 28,
              color: 'var(--color-text-primary)',
              lineHeight: 1.2,
            }}
          >
            {t('pages.analyticsDashboard')}
          </h1>
          <p
            className="font-body mt-1"
            style={{
              fontSize: 14,
              color: 'var(--color-text-secondary)',
            }}
          >
            {t('pages.insightsAcrossWorkspace')}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div style={{ width: 180 }}>
            <Dropdown
              options={boardOptions}
              value={boardFilter}
              onChange={setBoardFilter}
              placeholder={t('pages.allBoards')}
              size="sm"
            />
          </div>
          <div style={{ width: 160 }}>
            <Dropdown
              options={rangeOptions}
              value={range}
              onChange={setRange}
              placeholder={t('pages.last30Days')}
              size="sm"
            />
          </div>
        </div>
      </div>

      {/* Phase 2.1 — composable custom dashboard (admins build; everyone views) */}
      {orgId && (
        <div className="mt-6">
          <WorkspaceDashboard orgId={orgId} isAdmin={isAdmin} />
        </div>
      )}

      {/* Phase 2.3 — Marketing & ROI (admin-only) */}
      {orgId && isAdmin && <MarketingReport orgId={orgId} />}

      <div style={{ borderTop: '1px solid var(--color-border)', margin: '28px 0 0' }} />

      {error && (
        <div
          className="font-body mt-4"
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-status-stuck-bg)',
            color: 'var(--color-status-stuck)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 mt-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {loading && summary === INITIAL_SUMMARY
          ? [0, 1, 2, 3].map((i) => <SkeletonStatCard key={i} index={i} />)
          : statCards.map((card) => (
              <StatCard
                key={card.label}
                icon={card.icon}
                label={card.label}
                value={card.value}
                color={card.color}
                suffix={card.suffix}
                subLabel={card.subLabel}
              />
            ))}
      </div>

      {/* Chart row — 2 cols desktop, 1 col below lg */}
      <div className="mt-6 grid gap-5 grid-cols-1 lg:grid-cols-2">
        {loading && statusData.length === 0 ? (
          <>
            <SkeletonBarChart rows={4} />
            <SkeletonBarChart rows={4} />
          </>
        ) : (
          <>
            <BarChart
              title={t('pages.leadStatusDistribution')}
              icon={PieChart}
              data={statusData}
            />
            <BarChart
              title={t('pages.priorityDistribution')}
              icon={Flag}
              data={priorityData}
            />
          </>
        )}
      </div>

      {/* Overdue insights — by priority + top assignees */}
      <div className="mt-5 grid gap-5 grid-cols-1 lg:grid-cols-2">
        {loading && overduePriorityData.length === 0 ? (
          <>
            <SkeletonBarChart rows={4} />
            <SkeletonOverdueAssignees rows={5} />
          </>
        ) : (
          <>
            <BarChart
              title={t('pages.overdueByPriority')}
              icon={AlertTriangle}
              data={overduePriorityData}
            />
            <OverdueAssignees assignees={overdue.topAssignees} />
          </>
        )}
      </div>

      {/* Board performance */}
      <div className="mt-5">
        {loading && boardPerformance.length === 0 ? (
          <SkeletonBoardPerformance rows={3} />
        ) : (
          <BoardPerformance boards={boardPerformance} />
        )}
      </div>
    </PageWrapper>
  );
};

export default AnalyticsPage;
