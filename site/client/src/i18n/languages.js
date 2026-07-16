/**
 * Supported-language registry.
 *
 * To add a new language:
 *   1. Create `client/src/i18n/locales/<code>/translation.json` (copy en as a base).
 *   2. Add one entry to the array below.
 * Nothing else needs to change — the i18n config and the language switcher both
 * read from this list, so the app supports any language you register here.
 */
const LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', dir: 'ltr' },
  { code: 'fr', label: 'French', nativeLabel: 'Français', dir: 'ltr' },
];

export const SUPPORTED_LANG_CODES = LANGUAGES.map((l) => l.code);
export const DEFAULT_LANG = 'en';
export const FALLBACK_LANG = 'en';

export default LANGUAGES;
