import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import Button from '../ui/Button';

/**
 * GreetingBanner — full-width greeting card with CTA buttons at the top of
 * the dashboard. See Macan_Design.md Section 7.3.
 *
 * Props:
 *   name            — user's display name
 *   pendingCount    — number of leads waiting for the user
 */

const greetingKeyForNow = () => {
  const h = new Date().getHours();
  if (h < 12) return 'dashboard.greetingMorning';
  if (h < 18) return 'dashboard.greetingAfternoon';
  return 'dashboard.greetingEvening';
};

const MacanIcon = () => (
  <div
    className="flex items-center justify-center bg-accent shrink-0"
    style={{
      width: 40,
      height: 40,
      borderRadius: 'var(--radius-md)',
    }}
    aria-hidden="true"
  >
    <span className="font-display font-bold text-white text-[20px] leading-none">
      M
    </span>
  </div>
);

const GreetingBanner = ({ name = 'there', pendingCount = 0 }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const firstName = (name || '').split(' ')[0] || 'there';
  const greeting = t(greetingKeyForNow(), { name: firstName });
  const tasksLabel = t('dashboard.leadsWaiting', { count: pendingCount });

  return (
    <div
      className="w-full bg-surface"
      style={{
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        padding: '24px 32px',
      }}
    >
      <div className="flex items-start gap-4">
        <MacanIcon />
        <div className="min-w-0 flex-1">
          <h1
            className="font-display font-bold leading-tight"
            style={{
              fontSize: 28,
              color: 'var(--color-text-primary)',
              letterSpacing: 'var(--tracking-tight)',
            }}
          >
            {greeting}
          </h1>
          <p
            className="font-body mt-1"
            style={{
              fontSize: 14,
              color: 'var(--color-text-secondary)',
            }}
          >
            {tasksLabel}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          icon={ArrowRight}
          iconPosition="right"
          onClick={() => navigate('/boards')}
        >
          {t('dashboard.viewBoards')}
        </Button>
        <Button variant="secondary" onClick={() => navigate('/analytics')}>
          {t('dashboard.viewReports')}
        </Button>
      </div>
    </div>
  );
};

export default GreetingBanner;
