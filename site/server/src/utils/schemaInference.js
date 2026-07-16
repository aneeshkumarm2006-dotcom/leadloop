/**
 * schemaInference.js — infer a board column schema from a lead payload (F14).
 *
 * The pure core of the "first call defines the table" behaviour: given the JSON
 * body of the FIRST submission to a `LeadConnection`, decide one column per key
 * and which key is the row title (primary). It is deliberately DB-free and
 * side-effect-free so it can be unit-tested in isolation; the service layer
 * ([leadIngestService.js](../services/leadIngestService.js)) turns the result
 * into real `Board.columns` and persists the mapping.
 *
 * Every inferred `type` is one of the scalar-friendly entries in
 * [columnTypes.js](./columnTypes.js) — we never guess `status`/`dropdown`/
 * `person`/etc., since those need option lists or ids we can't derive from a
 * raw value. Anything we can't classify falls back to `text`, so a column is
 * always created and later submissions with a real value still land — nothing
 * is silently dropped.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?$/;
// A plain integer/decimal with no leading zero — leading zeros usually mean a
// zip / id / phone fragment we must keep as text.
const PLAIN_NUMBER_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;

// Key-name hints. Matched against a normalised (lowercased, underscored) key.
const KEY_HINTS = {
  phone: /(phone|mobile|^tel$|_tel$|whatsapp|cell)/,
  number: /(budget|amount|price|cost|value|qty|quantity|count|revenue|salary|age|score|rating|num_|number_of)/,
  date: /(date|dob|birth|when|scheduled|deadline|start|end|_at$)/,
  longtext: /(message|notes?|comment|description|body|enquiry|inquiry|details|question|feedback|about|requirements?)/,
  url: /(url|website|link|site|linkedin|portfolio|domain)/,
};

// Keys we never turn into columns: framework meta, captcha tokens, honeypots.
const IGNORED_KEYS = new Set([
  'submit', 'button', 'formid', 'form_id', 'source', 'redirect',
  'g-recaptcha-response', 'g_recaptcha_response', 'recaptcha',
  'cf-turnstile-response', 'cf_turnstile_response', 'turnstile',
  'h-captcha-response', 'h_captcha_response', '_gotcha', 'honeypot',
]);

// Hard cap so a hostile / accidental payload can't provision hundreds of columns.
const MAX_FIELDS = 60;

/** Normalise a raw payload key to `lower_snake` for hinting + de-dup. */
const normalizeKey = (key) =>
  String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** `full_name` / `fullName` / `full-name` → `Full Name`. */
const humanizeLabel = (key) => {
  const spaced = String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return String(key || '');
  return spaced
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};

const digitCount = (s) => (s.match(/\d/g) || []).length;

/** Loose phone shape: optional +, then 7–20 digits with allowed separators. */
const looksLikePhone = (s) =>
  /^\+?[\d][\d\s().-]{5,}$/.test(s) &&
  digitCount(s) >= 7 &&
  (/[+\s().-]/.test(s) || s.length >= 9);

/**
 * Infer a single column type from one (key, value) pair.
 *
 * Value shape wins where it's unambiguous (an email string is an `email`
 * regardless of the key); key-name hints break ties for shapes that overlap
 * (a bare number could be a count or a postal code).
 *
 * @returns {string} a columnTypes.js type name
 */
const inferFieldType = (key, value) => {
  const nkey = normalizeKey(key);

  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'text';
  if (value && typeof value === 'object') return 'long_text'; // arrays/objects → JSON blob
  if (value == null) return KEY_HINTS.longtext.test(nkey) ? 'long_text' : 'text';

  const s = String(value).trim();
  if (s === '') return KEY_HINTS.longtext.test(nkey) ? 'long_text' : 'text';

  if (EMAIL_RE.test(s)) return 'email';
  if (URL_RE.test(s)) return 'link';
  // Strict ISO date shape is checked before the phone heuristic — `2024-05-01`
  // is all digits + dashes and would otherwise read as a phone number.
  if (ISO_DATE_RE.test(s)) return 'date';
  if (KEY_HINTS.phone.test(nkey) || looksLikePhone(s)) return 'phone';
  if (KEY_HINTS.number.test(nkey) && PLAIN_NUMBER_RE.test(s)) return 'number';
  if (KEY_HINTS.date.test(nkey) && !Number.isNaN(Date.parse(s))) return 'date';
  if (KEY_HINTS.url.test(nkey)) return 'link';
  if (KEY_HINTS.longtext.test(nkey) || s.length > 200) return 'long_text';
  return 'text';
};

/**
 * Choose the row-title key from the inferred fields. Prefers an explicit name,
 * then any name-ish field, then company, then email, else the first field.
 *
 * @param {Array<{sourceKey, normalizedKey, type}>} fields
 * @returns {string|null} the chosen sourceKey
 */
const pickPrimaryKey = (fields) => {
  if (!fields.length) return null;
  const find = (re) => fields.find((f) => re.test(f.normalizedKey));
  return (
    find(/^(name|full_name|fullname|your_name|contact_name|lead_name)$/) ||
    find(/name/) ||
    find(/(company|organi[sz]ation|business)/) ||
    fields.find((f) => f.type === 'email') ||
    fields[0]
  ).sourceKey;
};

/**
 * Infer a full board schema from a first-submission payload.
 *
 * @param {Object} payload  parsed JSON body `{ [sourceKey]: value }`
 * @returns {{ fields: Array<{sourceKey,label,type}>, primaryKey: string|null, skipped: string[] }}
 */
const inferSchema = (payload) => {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const fields = [];
  const skipped = [];

  for (const [rawKey, value] of Object.entries(body)) {
    const key = String(rawKey);
    const nkey = normalizeKey(key);
    // Skip framework meta, honeypots, empties, and `_`-prefixed control keys.
    if (!nkey || key.startsWith('_') || IGNORED_KEYS.has(nkey)) {
      skipped.push(key);
      continue;
    }
    if (fields.length >= MAX_FIELDS) {
      skipped.push(key);
      continue;
    }
    fields.push({
      sourceKey: key,
      normalizedKey: nkey,
      label: humanizeLabel(key),
      type: inferFieldType(key, value),
    });
  }

  const primaryKey = pickPrimaryKey(fields);
  // Drop the internal `normalizedKey` from the returned shape.
  return {
    fields: fields.map(({ sourceKey, label, type }) => ({ sourceKey, label, type })),
    primaryKey,
    skipped,
  };
};

module.exports = {
  inferSchema,
  inferFieldType,
  humanizeLabel,
  pickPrimaryKey,
  normalizeKey,
  looksLikePhone,
  MAX_FIELDS,
  IGNORED_KEYS,
};
