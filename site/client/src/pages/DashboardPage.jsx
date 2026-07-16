import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder, CheckCircle, Clock, TrendingUp, Activity } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import StatCard from '../components/ui/StatCard';
import {
  SkeletonStatCard,
  SkeletonRecentBoards,
  SkeletonRecentActivity,
  SkeletonQuickActions,
  SkeletonGreetingBanner,
} from '../components/ui/Skeleton';
import GreetingBanner from '../components/dashboard/GreetingBanner';
import RecentBoards from '../components/dashboard/RecentBoards';
import QuickActions from '../components/dashboard/QuickActions';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';
import useBoardStore from '../store/boardStore';
import { getDashboardStats } from '../services/boardService';
import { timeAgo } from '../utils/dateUtils';

const INITIAL_STATS = {
  totalBoards: 0,
  completedTasks: 0,
  pendingTasks: 0,
  completionRate: 0,
};

const RecentActivity = ({ boards = [] }) => {
  const { t } = useTranslation();
  const items = boards.slice(0, 4);
  return (
    <section
      className="bg-surface"
      style={{
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        padding: 20,
      }}
    >
      <div className="flex items-center gap-2">
        <Activity size={18} color="var(--color-accent)" aria-hidden="true" />
        <h2
          className="font-display font-bold"
          style={{ fontSize: 15, color: 'var(--color-text-primary)' }}
        >
          {t('dashboard.recentActivity')}
        </h2>
      </div>

      <div className="mt-3 flex flex-col">
        {items.length === 0 ? (
          <p
            className="font-body"
            style={{
              fontSize: 13,
              color: 'var(--color-text-muted)',
              padding: '12px 0',
            }}
          >
            {t('dashboard.recentActivityEmpty')}
          </p>
        ) : (
          items.map((b, i) => (
            <div
              key={b._id}
              className="flex items-center gap-3"
              style={{
                padding: '10px 0',
                borderBottom:
                  i === items.length - 1
                    ? 'none'
                    : '1px solid var(--color-border)',
              }}
            >
              <div
                className="flex items-center justify-center shrink-0"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-accent-light)',
                }}
                aria-hidden="true"
              >
                <Folder size={14} color="var(--color-accent)" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="font-body truncate"
                  style={{
                    fontSize: 13,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <span className="font-semibold">{b.name}</span>{' '}
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    was updated
                  </span>
                </p>
                <p
                  className="font-body"
                  style={{ fontSize: 11, color: 'var(--color-text-muted)' }}
                >
                  {timeAgo(b.updatedAt || b.createdAt)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
};

const DashboardPage = () => {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const boards = useBoardStore((s) => s.boards);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);
  const boardsLoading = useBoardStore((s) => s.loading);

  const [stats, setStats] = useState(INITIAL_STATS);
  const [statsLoading, setStatsLoading] = useState(true);
  const orgId = currentOrg?._id || null;

  // Fetch boards + stats whenever the current org changes
  useEffect(() => {
    if (!orgId) return undefined;

    let cancelled = false;

    fetchBoards(orgId).catch((err) => {
      console.error('Failed to fetch boards:', err);
    });

    setStatsLoading(true);
    getDashboardStats(orgId)
      .then((data) => {
        if (!cancelled) setStats({ ...INITIAL_STATS, ...data });
      })
      .catch((err) => {
        console.error('Failed to fetch dashboard stats:', err);
        if (!cancelled) setStats(INITIAL_STATS);
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, fetchBoards]);

  const statCards = useMemo(
    () => [
      {
        icon: Folder,
        label: t('dashboard.statTotalBoards'),
        value: stats.totalBoards,
        color: 'blue',
      },
      {
        icon: CheckCircle,
        label: t('dashboard.statCompletedLeads'),
        value: stats.completedTasks,
        color: 'green',
      },
      {
        icon: Clock,
        label: t('dashboard.statPendingLeads'),
        value: stats.pendingTasks,
        color: 'orange',
      },
      {
        icon: TrendingUp,
        label: t('dashboard.statCompletionRate'),
        value: stats.completionRate,
        suffix: '%',
        color: 'purple',
      },
    ],
    [stats]
  );

  return (
    <PageWrapper>
      {/* Greeting banner */}
      {boardsLoading && boards.length === 0 ? (
        <SkeletonGreetingBanner />
      ) : (
        <GreetingBanner
          name={user?.name}
          pendingCount={stats.pendingTasks}
        />
      )}

      {/* Stat cards — 4 cols desktop, 2 cols tablet, 1 col mobile */}
      <div className="grid gap-4 mt-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {statsLoading && stats === INITIAL_STATS
          ? [0, 1, 2, 3].map((i) => <SkeletonStatCard key={i} index={i} />)
          : statCards.map((card) => (
              <StatCard
                key={card.label}
                icon={card.icon}
                label={card.label}
                value={card.value}
                color={card.color}
                suffix={card.suffix}
              />
            ))}
      </div>

      {/* Content row — 2 cols desktop (1fr + 320px), single col below lg */}
      <div className="mt-6 grid gap-6 grid-cols-1 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {boardsLoading && boards.length === 0 ? (
            <SkeletonRecentBoards rows={4} />
          ) : (
            <RecentBoards boards={boards} />
          )}
        </div>
        <div className="flex flex-col gap-4 min-w-0">
          {boardsLoading && boards.length === 0 ? (
            <>
              <SkeletonQuickActions />
              <SkeletonRecentActivity rows={3} />
            </>
          ) : (
            <>
              <QuickActions />
              <RecentActivity boards={boards} />
            </>
          )}
        </div>
      </div>

    </PageWrapper>
  );
};

export default DashboardPage;
