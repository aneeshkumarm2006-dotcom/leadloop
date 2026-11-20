import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { SETTINGS_GROUPS, SETTINGS_TABS } from './settingsTabs';

/**
 * SettingsSidebar — the Settings menu: a full-height white column (264px)
 * flush against the app's pine sidebar, grouped WORKSPACE / CHANNELS / GROWTH /
 * YOU, with a search box that filters the items. Desktop only (md+); phones
 * get <SettingsTabBar> instead.
 *
 * Props:
 *   activeTab      — current tab key
 *   onTabChange    — (key) => void
 *   showAdminTabs  — false hides admin-only tabs
 *   workspaceName  — shown under the "Settings" title
 */

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]';

const NavItem = ({ tab, label, isActive, onSelect }) => {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(tab.key)}
      aria-current={isActive ? 'page' : undefined}
      className={`w-full flex items-center text-left font-body transition-colors duration-150 ${
        isActive ? '' : 'hover:bg-[color:var(--color-bg-subtle)] hover:text-[color:var(--color-text-primary)]'
      } ${focusRing}`}
      style={{
        gap: 11,
        padding: '9px 10px',
        borderRadius: 10,
        fontSize: 14,
        border: 'none',
        cursor: 'pointer',
        background: isActive ? 'var(--color-accent-light)' : 'transparent',
        color: isActive ? '#2C5138' : 'var(--color-text-secondary)',
        fontWeight: isActive ? 700 : 500,
      }}
    >
      <Icon size={17} strokeWidth={1.8} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span className="flex-1 min-w-0 truncate">{label}</span>
    </button>
  );
};

const SettingsSidebar = ({ activeTab, onTabChange, showAdminTabs = true, workspaceName }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const searchId = useId();
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const visible = SETTINGS_TABS.filter((tab) => showAdminTabs || !tab.adminOnly);
    return SETTINGS_GROUPS.map((g) => {
      const groupLabel = t(`settings.groups.${g}`);
      const items = visible.filter((tab) => {
        if (tab.group !== g) return false;
        if (!q) return true;
        const hay = `${t(`settings.tabs.${tab.key}`)} ${groupLabel} ${tab.keywords}`.toLowerCase();
        return hay.includes(q);
      });
      return { id: g, label: groupLabel, items };
    }).filter((g) => g.items.length > 0);
  }, [showAdminTabs, q, t]);

  return (
    <aside
      className="hidden md:block shrink-0 bg-surface"
      style={{ width: 264, borderRight: '1px solid var(--color-border)' }}
    >
      <nav
        aria-label={t('settings.nav.sectionsAria')}
        className="sticky flex flex-col overflow-y-auto font-body"
        style={{ top: 56, maxHeight: 'calc(100vh - 56px)', padding: '24px 14px', color: 'var(--color-text-primary)' }}
      >
        <div style={{ padding: '0 8px 16px' }}>
          <h2 className="font-display" style={{ margin: 0, fontSize: 22, fontWeight: 750, letterSpacing: '-0.01em' }}>
            {t('settings.nav.title')}
          </h2>
          {workspaceName ? (
            <div className="truncate" style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 2 }}>
              {t('settings.nav.workspaceSub', { name: workspaceName })}
            </div>
          ) : null}
        </div>

        <div
          className="flex items-center has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--color-accent)]"
          style={{
            gap: 8,
            margin: '0 4px 18px',
            height: 38,
            padding: '0 11px',
            borderRadius: 10,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-input)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Search size={14} strokeWidth={2.2} aria-hidden="true" style={{ flexShrink: 0 }} />
          <label htmlFor={searchId} className="sr-only">{t('settings.nav.searchLabel')}</label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              }
            }}
            placeholder={t('settings.nav.searchLabel')}
            autoComplete="off"
            className="w-full bg-transparent font-body focus:outline-none"
            style={{ border: 'none', fontSize: 13.5, color: 'var(--color-text-primary)' }}
          />
        </div>

        {groups.map((g) => (
          <div key={g.id} role="group" aria-labelledby={`${searchId}-${g.id}`} style={{ marginBottom: 14 }}>
            <div
              id={`${searchId}-${g.id}`}
              className="uppercase"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.12em', color: '#7A7166', padding: '0 10px 6px' }}
            >
              {g.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {g.items.map((tab) => (
                <NavItem
                  key={tab.key}
                  tab={tab}
                  label={t(`settings.tabs.${tab.key}`)}
                  isActive={activeTab === tab.key}
                  onSelect={onTabChange}
                />
              ))}
            </div>
          </div>
        ))}

        <p aria-live="polite" className="font-body" style={{ margin: 0, padding: '0 10px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {groups.length === 0 ? t('settings.nav.noMatch', { query: query.trim() }) : ''}
        </p>
      </nav>
    </aside>
  );
};

/**
 * Horizontal tab bar for phones (<768px), stuck under the top bar.
 */
export const SettingsTabBar = ({ activeTab, onTabChange, showAdminTabs = true }) => {
  const { t } = useTranslation();
  const tabs = SETTINGS_TABS.filter((tab) => showAdminTabs || !tab.adminOnly);
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [activeTab]);

  return (
    <nav
      aria-label={t('settings.nav.sectionsAria')}
      className="md:hidden sticky z-30 flex items-center gap-1 overflow-x-auto"
      style={{
        top: 56,
        padding: 8,
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg-surface)',
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            ref={isActive ? activeRef : undefined}
            type="button"
            onClick={() => onTabChange(tab.key)}
            aria-current={isActive ? 'page' : undefined}
            className={`shrink-0 font-body transition-colors duration-150 ${focusRing}`}
            style={{
              height: 36,
              padding: '0 14px',
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              background: isActive ? 'var(--color-accent-light)' : 'transparent',
              color: isActive ? '#2C5138' : 'var(--color-text-secondary)',
              fontWeight: isActive ? 700 : 500,
              fontSize: 13,
            }}
          >
            {t(`settings.tabs.${tab.key}`)}
          </button>
        );
      })}
    </nav>
  );
};

export default SettingsSidebar;
