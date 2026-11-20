import { useTranslation } from 'react-i18next';
import { PageHeader } from '../layout/PageHeader';
import { SkeletonBlock } from '../ui/Skeleton';
import { Tick } from './ads/AdsShared';
import { settingsGroupOf } from './settingsTabs';

/**
 * Shared building blocks for the full-width Settings tabs. Every tab renders
 * <SettingsHeader> + <PageBody> (from layout/PageHeader) and lays its content
 * out with these cards in a grid.
 */

/** White strip header with the "Settings › <Group>" eyebrow. */
export const SettingsHeader = ({ tab, title, subtitle, actions, children }) => {
  const { t } = useTranslation();
  return (
    <PageHeader
      eyebrow={
        <>
          {t('pages.settings')} <span aria-hidden="true">›</span> {t(`settings.groups.${settingsGroupOf(tab)}`)}
        </>
      }
      title={title}
      subtitle={subtitle}
      actions={actions}
    >
      {children}
    </PageHeader>
  );
};

/** White rounded surface (18px radius, hairline shadow). `tone="danger"` gives the red outline. */
export const SettingsCard = ({ as = 'section', tone, className = '', style, children, ...rest }) => {
  const Tag = as;
  return (
    <Tag
      className={`flex flex-col min-w-0 ${className}`}
      style={{
        background: 'var(--color-bg-surface)',
        borderRadius: 18,
        boxShadow: tone === 'danger' ? '0 0 0 1px #E8C9C2' : 'var(--shadow-card)',
        padding: 24,
        gap: 16,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
};

/** Card heading (h2 by default — the page h1 lives in the header). */
export const CardTitle = ({ as = 'h2', size = 19, tone, id, children }) => {
  const Tag = as;
  return (
    <Tag
      id={id}
      className="font-display font-bold"
      style={{ margin: 0, fontSize: size, color: tone === 'danger' ? 'var(--color-status-stuck)' : 'var(--color-text-primary)' }}
    >
      {children}
    </Tag>
  );
};

export const CardText = ({ children, style }) => (
  <p className="font-body" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--color-text-secondary)', ...style }}>
    {children}
  </p>
);

/** Dark pine panel used for asides ("Used by", plan). */
export const PineCard = ({ as = 'section', children, className = '', ...rest }) => {
  const Tag = as;
  return (
    <Tag
      className={`flex flex-col gap-2.5 font-body ${className}`}
      style={{ background: 'var(--color-pine)', color: 'var(--color-pine-text)', borderRadius: 18, padding: 22, fontSize: 13.5, lineHeight: 1.55 }}
      {...rest}
    >
      {children}
    </Tag>
  );
};

/** Ticked bullet list. */
export const CheckList = ({ items }) => (
  <ul className="m-0 p-0 list-none flex flex-col gap-2.5 font-body" style={{ fontSize: 13.5, color: 'var(--color-text-secondary)' }}>
    {items.map((it) => (
      <li key={it} className="flex gap-2.5 items-start">
        <Tick />
        <span>{it}</span>
      </li>
    ))}
  </ul>
);

/** Two-column "main + aside" grid; stacks below lg. */
export const MainAsideGrid = ({ children, reverse = false }) => (
  <div
    className={[
      'grid gap-5 items-start grid-cols-1',
      reverse ? 'lg:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)]' : 'lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]',
    ].join(' ')}
  >
    {children}
  </div>
);

/** Placeholder cards while a tab loads. */
export const SettingsSkeleton = ({ cards = 2, height = 220, label }) => (
  <div role="status" aria-live="polite" className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
    {label && <span className="sr-only">{label}</span>}
    {Array.from({ length: cards }).map((_, i) => (
      <SkeletonBlock key={i} height={height} borderRadius={18} />
    ))}
  </div>
);

/** Error / retry line inside a card. */
export const InlineError = ({ children }) =>
  children ? (
    <p role="alert" className="font-body" style={{ margin: 0, fontSize: 13, color: 'var(--color-status-stuck)' }}>
      {children}
    </p>
  ) : null;
