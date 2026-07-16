import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import Button from '../ui/Button';

/**
 * GreetingBanner — editorial dashboard opening: a mono date eyebrow, a large
 * display greeting and the day's lead count, with the primary actions on the
 * right. Sits directly on the paper background (no card) so the page opens
 * like the marketing site rather than a widget stack.
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

const GreetingBanner = ({ name = 'there', pendingCount = 0 }) => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const firstName = (name || '').split(' ')[0] || 'there';
  const greeting = t(greetingKeyForNow(), { name: firstName });
  const tasksLabel = t('dashboard.leadsWaiting', { count: pendingCount });

  const locale = (i18n.language || 'en').startsWith('fr') ? 'fr-CA' : 'en-CA';
  const today = new Date().toLocaleDateString(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="w-full flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <p className="ll-label" style={{ color: 'var(--color-text-muted)' }}>
          {today}
        </p>
        <h1
          className="font-display font-bold leading-tight mt-1.5"
          style={{
            fontSize: 30,
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.02em',
          }}
        >
          {greeting}
        </h1>
        <p
          className="font-body mt-1.5 flex items-center gap-2"
          style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}
        >
          {pendingCount > 0 && (
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--color-status-working-solid)',
                flexShrink: 0,
              }}
            />
          )}
          {tasksLabel}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 shrink-0">
        <Button variant="secondary" onClick={() => navigate('/analytics')}>
          {t('dashboard.viewReports')}
        </Button>
        <Button
          variant="primary"
          icon={ArrowRight}
          iconPosition="right"
          onClick={() => navigate('/boards')}
        >
          {t('dashboard.viewBoards')}
        </Button>
      </div>
    </div>
  );
};

export default GreetingBanner;
