import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, UserPlus, Calendar, BarChart2, ArrowRight, Zap } from 'lucide-react';

/**
 * QuickActions — quiet shortcut rows in the dashboard sidebar. One accent
 * family (forest on soft mint) instead of the old rainbow blocks; the row
 * reveals a small arrow on hover.
 *
 * Phase 0 reframe (§0.5): CRM-flavoured labels via i18n, routed to existing
 * pages. Dedicated add-lead / log-viewing flows arrive with Phase 1 templates.
 *
 * Props:
 *   onCreateBoard — optional handler; falls back to navigating to /boards
 */

const ACTIONS = [
  {
    id: 'create-board',
    icon: Plus,
    titleKey: 'dashboard.qaNewBoard',
    subtitleKey: 'dashboard.qaNewBoardSub',
    to: '/boards',
  },
  {
    id: 'invite-team',
    icon: UserPlus,
    titleKey: 'dashboard.qaInviteTeam',
    subtitleKey: 'dashboard.qaInviteTeamSub',
    to: '/settings',
  },
  {
    id: 'calendar',
    icon: Calendar,
    titleKey: 'dashboard.qaCalendar',
    subtitleKey: 'dashboard.qaCalendarSub',
    to: '/calendar',
  },
  {
    id: 'analytics',
    icon: BarChart2,
    titleKey: 'dashboard.qaReports',
    subtitleKey: 'dashboard.qaReportsSub',
    to: '/analytics',
  },
];

const ActionButton = ({ icon: Icon, title, subtitle, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="group/qa w-full flex items-center gap-3 text-left transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
    style={{
      padding: '9px 10px',
      borderRadius: 'var(--radius-md)',
    }}
  >
    <span
      className="flex items-center justify-center shrink-0"
      style={{
        width: 32,
        height: 32,
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-accent-light)',
      }}
      aria-hidden="true"
    >
      <Icon size={16} color="var(--color-accent)" strokeWidth={2.2} />
    </span>
    <span className="min-w-0 flex-1">
      <span
        className="block font-body font-semibold leading-tight"
        style={{ fontSize: 13.5, color: 'var(--color-text-primary)' }}
      >
        {title}
      </span>
      <span
        className="block font-body leading-tight mt-0.5"
        style={{ fontSize: 12, color: 'var(--color-text-muted)' }}
      >
        {subtitle}
      </span>
    </span>
    <ArrowRight
      size={14}
      aria-hidden="true"
      className="shrink-0 opacity-0 -translate-x-1 transition-[opacity,transform] duration-150 group-hover/qa:opacity-100 group-hover/qa:translate-x-0"
      color="var(--color-accent)"
    />
  </button>
);

const QuickActions = ({ onCreateBoard }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleAction = (action) => {
    if (action.id === 'create-board' && typeof onCreateBoard === 'function') {
      onCreateBoard();
      return;
    }
    if (action.to) navigate(action.to);
  };

  return (
    <section
      className="bg-surface"
      style={{
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        padding: 16,
      }}
    >
      <div className="flex items-center gap-2 px-1">
        <Zap size={16} color="var(--color-accent)" aria-hidden="true" />
        <h2
          className="font-display font-bold"
          style={{ fontSize: 15, color: 'var(--color-text-primary)' }}
        >
          {t('dashboard.quickActions')}
        </h2>
      </div>

      <div className="mt-2 flex flex-col gap-0.5">
        {ACTIONS.map((action) => (
          <ActionButton
            key={action.id}
            icon={action.icon}
            title={t(action.titleKey)}
            subtitle={t(action.subtitleKey)}
            onClick={() => handleAction(action)}
          />
        ))}
      </div>
    </section>
  );
};

export default QuickActions;
