/**
 * adAttribution.js — pull ad-click attribution out of an inbound lead payload.
 *
 * A website form (fed by our capture script) posts the ad click identifiers and
 * UTMs alongside the lead's own fields. Those identifiers are NOT lead data a
 * salesperson edits — they are evidence we later hand back to Google Ads and
 * Meta when the lead qualifies (offline conversions / Conversions API). So
 * instead of letting schema inference turn `gclid` into a board column, the
 * ingest path calls `extractAttribution` first: attribution keys are removed
 * from the payload, validated, and returned as a structured record that is
 * stored on `Task.attribution`.
 *
 * What we capture, and why:
 *   - gclid            Google click ID (most Google Ads clicks)
 *   - gbraid / wbraid  Google's privacy-preserving IDs for iOS traffic, sent
 *                      when a gclid can't be (app→web / web→app on Apple)
 *   - fbclid           Meta click ID from the landing URL
 *   - fbc / fbp        Meta's `_fbc` / `_fbp` browser cookies. `fbc` is built
 *                      from fbclid when the Pixel isn't installed to set it.
 *   - msclkid, ttclid  Microsoft / TikTok, captured now so they're not lost
 *   - utm_*            campaign context for reporting
 *   - client IP + UA   the VISITOR's, forwarded by the site's server code (the
 *                      request reaching us comes from the site's server, not
 *                      the browser). Meta uses both for match quality.
 *   - ad consent       did the visitor agree to their data being used to
 *                      measure advertising. Nothing is ever sent back to an ad
 *                      platform without it.
 *
 * PURE: no DB, no clock except the injectable `now`. Invalid values are dropped
 * with a warning, never thrown — a malformed click ID must not cost us the lead.
 */

const net = require('net');

/** Lower-snake a key the same way schemaInference does (`_fbc` → `fbc`). */
const normalize = (key) =>
  String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

// Accepted wire keys (normalized) → attribution field. Aliases cover the common
// spellings a hand-built form or Zapier step might use.
const KEY_MAP = {
  gclid: 'gclid',
  gbraid: 'gbraid',
  wbraid: 'wbraid',
  fbclid: 'fbclid',
  fbc: 'fbc',
  fbp: 'fbp',
  msclkid: 'msclkid',
  ttclid: 'ttclid',

  utm_source: 'utmSource',
  utmsource: 'utmSource',
  utm_medium: 'utmMedium',
  utmmedium: 'utmMedium',
  utm_campaign: 'utmCampaign',
  utmcampaign: 'utmCampaign',
  utm_term: 'utmTerm',
  utmterm: 'utmTerm',
  utm_content: 'utmContent',
  utmcontent: 'utmContent',
  utm_id: 'utmId',
  utmid: 'utmId',

  landing_page: 'landingPage',
  landing_url: 'landingPage',
  referrer: 'referrer',
  page_url: 'pageUrl',

  click_ts: 'clickedAt',
  clicked_at: 'clickedAt',
  landed_at: 'clickedAt',

  client_ip: 'clientIp',
  client_ip_address: 'clientIp',
  client_user_agent: 'clientUserAgent',
  user_agent: 'clientUserAgent',
};

const CONSENT_KEYS = new Set(['ad_consent', 'ads_consent', 'marketing_consent', 'consent']);
const CONSENT_WORDING_KEYS = new Set(['consent_text', 'consent_wording', 'ad_consent_text']);

const CLICK_ID_FIELDS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid'];
const UTM_FIELDS = ['utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent', 'utmId'];
const URL_FIELDS = ['landingPage', 'referrer', 'pageUrl'];

// Click IDs are URL-safe tokens. Generous length cap; real ones are ~100 chars.
const CLICK_ID_RE = /^[A-Za-z0-9._~-]{1,512}$/;
// Meta cookie formats: fb.<subdomainIndex>.<creationTimeMs>.<fbclid | random>
const FBC_RE = /^fb\.\d+\.\d{10,13}\.[A-Za-z0-9._~-]{1,512}$/;
const FBP_RE = /^fb\.\d+\.\d{10,13}\.\d{1,32}$/;

const MAX_TEXT = 256;
const MAX_URL = 2048;
const MAX_UA = 512;
const DAY_MS = 24 * 60 * 60 * 1000;

const asText = (v) => (v == null ? '' : String(Array.isArray(v) ? v[0] : v).trim());

const isTruthy = (v) => {
  if (typeof v === 'boolean') return v;
  const s = asText(v).toLowerCase();
  return s === 'true' || s === 'on' || s === '1' || s === 'yes' || s === 'y' || s === 'granted';
};

const cleanUrl = (s) => {
  if (!s || s.length > MAX_URL) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
};

/**
 * Parse a click timestamp: epoch ms, epoch seconds, or ISO string. Rejected if
 * it's more than a day in the future or older than ~13 months (Google's longest
 * conversion window is 90 days; anything far older is a bad cookie).
 */
const parseClickTime = (raw, now) => {
  const s = asText(raw);
  if (!s) return null;
  let ms;
  if (/^\d{10}$/.test(s)) ms = Number(s) * 1000;
  else if (/^\d{13}$/.test(s)) ms = Number(s);
  else ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  const nowMs = now.getTime();
  if (ms > nowMs + DAY_MS || ms < nowMs - 400 * DAY_MS) return null;
  return new Date(ms);
};

/** Which ad platform drove this lead, from the strongest signal present. */
const deriveChannel = (a) => {
  if (a.gclid || a.gbraid || a.wbraid) return 'google_ads';
  if (a.fbclid || a.fbc) return 'meta_ads';
  if (a.msclkid) return 'microsoft_ads';
  if (a.ttclid) return 'tiktok_ads';
  if (a.utmSource || a.utmCampaign) return 'campaign';
  return null;
};

/**
 * Split a flat lead payload into attribution + the remaining lead fields.
 *
 * @param {Object} payload           flat `{ key: value }` (post source-adapter)
 * @param {Object} [opts]
 * @param {Date}   [opts.now]
 * @param {Set<string>} [opts.keepKeys] raw keys to ALSO leave in `remaining`
 * @param {string} [opts.requestIp]  the HTTP caller's IP, used for consent
 *                                   evidence only when no client_ip was sent
 * @param {string} [opts.requestUserAgent]
 * @returns {{ attribution: Object|null, remaining: Object, warnings: Array }}
 */
const extractAttribution = (payload, opts = {}) => {
  const now = opts.now || new Date();
  const keepKeys = opts.keepKeys || new Set();
  const remaining = {};
  const raw = {};
  const warnings = [];
  let consentRaw;
  let consentWording = '';

  for (const [key, value] of Object.entries(payload || {})) {
    const nkey = normalize(key);
    // A key a connection already maps onto a column keeps feeding it, so boards
    // built before attribution existed don't silently lose a column's data.
    if (keepKeys.has(key)) remaining[key] = value;
    if (KEY_MAP[nkey]) {
      // First non-empty value wins if a form sends an alias twice.
      if (raw[KEY_MAP[nkey]] === undefined || asText(raw[KEY_MAP[nkey]]) === '') raw[KEY_MAP[nkey]] = value;
      continue;
    }
    if (CONSENT_KEYS.has(nkey)) {
      consentRaw = value;
      continue;
    }
    if (CONSENT_WORDING_KEYS.has(nkey)) {
      consentWording = asText(value).slice(0, 2000);
      continue;
    }
    if (!keepKeys.has(key)) remaining[key] = value;
  }

  const a = {};

  for (const f of CLICK_ID_FIELDS) {
    const s = asText(raw[f]);
    if (!s) continue;
    if (CLICK_ID_RE.test(s)) a[f] = s;
    else warnings.push({ reason: 'invalid_click_id', key: f });
  }

  const fbc = asText(raw.fbc);
  if (fbc) {
    if (FBC_RE.test(fbc)) a.fbc = fbc;
    else warnings.push({ reason: 'invalid_click_id', key: 'fbc' });
  }
  const fbp = asText(raw.fbp);
  if (fbp) {
    if (FBP_RE.test(fbp)) a.fbp = fbp;
    else warnings.push({ reason: 'invalid_click_id', key: 'fbp' });
  }

  for (const f of UTM_FIELDS) {
    const s = asText(raw[f]);
    if (s) a[f] = s.slice(0, MAX_TEXT);
  }

  for (const f of URL_FIELDS) {
    const s = asText(raw[f]);
    if (!s) continue;
    const u = cleanUrl(s);
    if (u) a[f] = u;
    else warnings.push({ reason: 'invalid_url', key: f });
  }

  const clickedAt = parseClickTime(raw.clickedAt, now);
  if (clickedAt) a.clickedAt = clickedAt;
  else if (asText(raw.clickedAt)) warnings.push({ reason: 'invalid_click_time', key: 'clickedAt' });

  const ip = asText(raw.clientIp);
  if (ip) {
    if (net.isIP(ip)) a.clientIp = ip;
    else warnings.push({ reason: 'invalid_ip', key: 'clientIp' });
  }
  const ua = asText(raw.clientUserAgent);
  if (ua) a.clientUserAgent = ua.slice(0, MAX_UA);

  // No Pixel on the site → no `_fbc` cookie. Meta accepts an fbc we build from
  // the fbclid in its documented format, timestamped at the click.
  if (a.fbclid && !a.fbc) {
    a.fbc = `fb.1.${(a.clickedAt || now).getTime()}.${a.fbclid}`;
  }

  if (consentRaw !== undefined) {
    a.adConsent = {
      granted: isTruthy(consentRaw),
      wording: consentWording,
      capturedAt: now,
      ip: a.clientIp || asText(opts.requestIp),
      userAgent: a.clientUserAgent || asText(opts.requestUserAgent).slice(0, MAX_UA),
    };
  }

  const hasAny = Object.keys(a).length > 0;
  if (!hasAny) return { attribution: null, remaining, warnings };

  a.channel = deriveChannel(a);
  a.capturedAt = now;
  return { attribution: a, remaining, warnings };
};

module.exports = {
  extractAttribution,
  deriveChannel,
  parseClickTime,
  KEY_MAP,
  CONSENT_KEYS,
};
