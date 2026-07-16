import {
  Zap,
  UserPlus,
  CalendarClock,
  Bell,
  Webhook,
  ListChecks,
  BadgeCheck,
  Archive,
  MessageCircle,
  Inbox,
  MapPin,
  AlertTriangle,
  Plug,
  Plus,
} from 'lucide-react';
import Button from '../ui/Button';

/**
 * RecipeCard — a single F6 recipe in the catalogue (F6.4).
 *
 * Renders the recipe's name/description with a "Use recipe" button. When the
 * recipe references a not-yet-connected channel (SMS/email/webhook/…), a
 * "Requires … setup" warning chip is shown — cloning it still works but produces
 * an `validation: 'incomplete'` automation (AC4). A dormant trigger (form/webhook
 * with no emitter yet) shows its own note.
 */

// Map the recipe's stored `iconName` to a lucide icon (falls back to Zap).
const ICONS = {
  Zap,
  UserPlus,
  CalendarClock,
  Bell,
  Webhook,
  ListChecks,
  BadgeCheck,
  Archive,
  MessageCircle,
  Inbox,
  MapPin,
};

const Chip = ({ children, tone = 'muted', icon: Icon }) => {
  const tones = {
    muted: { bg: 'var(--color-bg-subtle)', fg: 'var(--color-text-muted)', bd: 'var(--color-border)' },
    warn: { bg: 'var(--color-bg-subtle)', fg: 'var(--color-status-stuck)', bd: 'var(--color-status-stuck)' },
    region: { bg: 'var(--color-accent-light)', fg: 'var(--color-accent-text)', bd: 'var(--color-accent)' },
  };
  const t = tones[tone] || tones.muted;
  return (
    <span
      className="font-body inline-flex items-center gap-1"
      style={{
        fontSize: 11,
        fontWeight: 500,
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.bd}`,
      }}
    >
      {Icon && <Icon size={11} aria-hidden="true" />}
      {children}
    </span>
  );
};

const RecipeCard = ({ recipe, onUse, busy = false, disabled = false }) => {
  const Icon = ICONS[recipe.iconName] || Zap;
  const requiresSetup = Array.isArray(recipe.requiresSetup) ? recipe.requiresSetup : [];
  const regions = Array.isArray(recipe.region) ? recipe.region : [];

  return (
    <div
      className="flex flex-col"
      style={{
        border: '1.5px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg-surface)',
        padding: 16,
        gap: 12,
        height: '100%',
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex items-center justify-center shrink-0"
          style={{
            width: 38,
            height: 38,
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-accent-light)',
            color: 'var(--color-accent-text)',
          }}
        >
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold" style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>
            {recipe.name}
          </p>
          <p className="font-body mt-1" style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.45 }}>
            {recipe.description}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {regions.map((r) => (
          <Chip key={r} tone="region" icon={MapPin}>{r}</Chip>
        ))}
        {requiresSetup.map((c) => (
          <Chip key={c.phase} tone="warn" icon={Plug}>
            Requires {c.label} setup
          </Chip>
        ))}
        {recipe.triggerDormant && (
          <Chip tone="warn" icon={AlertTriangle}>Trigger available later</Chip>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2">
        <Button
          variant="primary"
          size="sm"
          icon={Plus}
          onClick={() => onUse(recipe)}
          disabled={busy || disabled}
        >
          {busy ? 'Adding…' : 'Use recipe'}
        </Button>
      </div>
    </div>
  );
};

export default RecipeCard;
