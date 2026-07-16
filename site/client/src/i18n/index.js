/**
 * i18n bootstrap (react-i18next).
 *
 * Language detection order: explicit localStorage choice → browser language →
 * fallback (English). The user's choice is persisted to localStorage under
 * `i18nextLng`. Translation resources are loaded statically per registered
 * language (see ./languages.js). Import this module once, in main.jsx.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import LANGUAGES, { SUPPORTED_LANG_CODES, FALLBACK_LANG } from './languages';

// Eagerly import every registered language's translation bundle. Vite resolves
// these at build time; adding a language to languages.js + dropping its JSON in
// locales/<code>/ is all that's needed.
import en from './locales/en/translation.json';
import fr from './locales/fr/translation.json';

const BUNDLES = { en, fr };

const resources = LANGUAGES.reduce((acc, { code }) => {
  if (BUNDLES[code]) acc[code] = { translation: BUNDLES[code] };
  return acc;
}, {});

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: SUPPORTED_LANG_CODES,
    fallbackLng: FALLBACK_LANG,
    nonExplicitSupportedLngs: true, // map fr-CA → fr, en-US → en, etc.
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
  });

// Keep <html lang> and dir in sync with the active language (a11y + RTL-ready).
const applyHtmlLang = (lng) => {
  const meta = LANGUAGES.find((l) => l.code === lng) || LANGUAGES[0];
  if (typeof document !== 'undefined') {
    document.documentElement.lang = meta.code;
    document.documentElement.dir = meta.dir || 'ltr';
  }
};
applyHtmlLang(i18n.resolvedLanguage);
i18n.on('languageChanged', applyHtmlLang);

export default i18n;
