import { useTranslation } from 'react-i18next';
import { Check, Globe } from 'lucide-react';
import LANGUAGES from '../../i18n/languages';

/**
 * Language picker. Renders one row per registered language (see i18n/languages.js)
 * — so it grows automatically as languages are added, supporting any language.
 * The choice is persisted to localStorage by the i18n LanguageDetector.
 *
 * Designed to sit inside the avatar dropdown menu; styling matches MenuItem.
 */
const LanguageSwitcher = () => {
  const { t, i18n } = useTranslation();
  const active = i18n.resolvedLanguage;

  return (
    <div className="py-1" role="group" aria-label={t('language.choose')}>
      <div
        className="px-4 pt-2 pb-1 flex items-center gap-2 font-body font-semibold uppercase"
        style={{
          fontSize: 10,
          letterSpacing: '0.06em',
          color: 'var(--color-text-muted)',
        }}
      >
        <Globe size={12} aria-hidden="true" />
        {t('language.label')}
      </div>
      {LANGUAGES.map((lang) => {
        const isActive = lang.code === active;
        return (
          <button
            key={lang.code}
            type="button"
            onClick={() => i18n.changeLanguage(lang.code)}
            aria-current={isActive ? 'true' : undefined}
            className="w-full flex items-center gap-3 px-4 py-2 text-left font-body text-[13px] transition-colors hover:bg-[color:var(--color-bg-subtle)] focus:outline-none focus:bg-[color:var(--color-bg-subtle)]"
            style={{
              color: 'var(--color-text-primary)',
              fontWeight: isActive ? 600 : 400,
            }}
          >
            <span className="flex-1 truncate">{lang.nativeLabel}</span>
            {isActive && (
              <Check size={14} color="var(--color-accent)" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default LanguageSwitcher;
