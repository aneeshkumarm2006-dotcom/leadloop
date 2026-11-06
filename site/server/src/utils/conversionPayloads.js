/**
 * conversionPayloads.js — build the conversion events LeadLoop sends back to
 * ad platforms when a lead reaches a pipeline stage (Qualified, Customer…).
 *
 * PURE: no DB, no network, injectable clock. Everything that decides WHAT is
 * sent lives here so it can be tested exhaustively; the services only POST it.
 *
 *   leadIdentity(task, board)   → { email, phone, firstName, lastName }
 *   metaEvent(...)              → one Meta Conversions API event (CRM-style)
 *   googleClickConversion(...)  → one Google Ads ClickConversion
 *   eligibility(...)            → { ok } | { ok:false, reason } per platform
 *
 * Hashing follows each platform's normalisation rules (SHA-256, lowercase hex):
 *   - email: trimmed + lowercased. Google additionally strips dots from the
 *     local part of gmail.com / googlemail.com addresses.
 *   - phone: Meta wants digits only incl. country code; Google wants E.164
 *     (`+15551234567`). A 10-digit number gets the workspace's default country
 *     code (North America by default).
 *   - names (Meta only): lowercased, trimmed, punctuation removed.
 * Click IDs, Meta's fbc/fbp, IP and user agent are sent as-is (never hashed).
 */

const crypto = require('crypto');

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const DAY_MS = 24 * 60 * 60 * 1000;
const GOOGLE_CLICK_WINDOW_DAYS = 90;

const readCell = (task, columnId) => {
  const cv = task && task.columnValues;
  if (!cv || columnId == null) return undefined;
  const key = String(columnId);
  return typeof cv.get === 'function' ? cv.get(key) : cv[key];
};

const asText = (v) => (v == null ? '' : String(v).trim());

const FIRST_NAME_RE = /^(first[\s_-]?name|firstname|given[\s_-]?name|prenom|prénom)$/i;
const LAST_NAME_RE = /^(last[\s_-]?name|lastname|surname|family[\s_-]?name|nom)$/i;

/**
 * Pull the lead's contact details out of its board columns: the first email /
 * phone column with a value, and first/last name from columns named that way —
 * falling back to splitting the lead's own name.
 */
const leadIdentity = (task, board) => {
  const columns = (board && Array.isArray(board.columns) ? board.columns : []).slice();
  columns.sort((a, b) => (a.order || 0) - (b.order || 0));
  const out = { email: '', phone: '', firstName: '', lastName: '' };
  for (const col of columns) {
    const value = asText(readCell(task, col._id));
    if (!value) continue;
    if (col.type === 'email' && !out.email) out.email = value;
    else if (col.type === 'phone' && !out.phone) out.phone = value;
    else if (!out.firstName && (FIRST_NAME_RE.test(asText(col.key)) || FIRST_NAME_RE.test(asText(col.name)))) {
      out.firstName = value;
    } else if (!out.lastName && (LAST_NAME_RE.test(asText(col.key)) || LAST_NAME_RE.test(asText(col.name)))) {
      out.lastName = value;
    }
  }
  if (!out.firstName && !out.lastName && task && task.name) {
    const parts = asText(task.name).split(/\s+/);
    out.firstName = parts[0] || '';
    out.lastName = parts.slice(1).join(' ');
  }
  return out;
};

// --- normalisation ---------------------------------------------------------

const normEmail = (email) => {
  const e = asText(email).toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : '';
};

/** Google's extra rule: dots in a gmail local part are not significant. */
const normEmailForGoogle = (email) => {
  const e = normEmail(email);
  if (!e) return '';
  const [local, domain] = e.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') return `${local.replace(/\./g, '')}@${domain}`;
  return e;
};

/** Digits with country code, or '' when it can't be made plausible. */
const phoneDigits = (phone, defaultCountryCode = '1') => {
  let raw = asText(phone);
  if (!raw) return '';
  const hadPlus = raw.startsWith('+');
  raw = raw.replace(/^00/, '+');
  let digits = raw.replace(/\D/g, '');
  if (!hadPlus && !raw.startsWith('+')) {
    digits = digits.replace(/^0+/, '');
    if (digits.length === 10 && defaultCountryCode) digits = `${defaultCountryCode}${digits}`;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
};

const normName = (name) =>
  asText(name)
    .toLowerCase()
    .replace(/[\s.,'"!?()[\]{}<>:;/\\|@#$%^&*+=~`-]+/g, ' ')
    .trim();

// --- eligibility -------------------------------------------------------------

const clickIdFor = (attribution, now) => {
  const a = attribution || {};
  const fresh =
    !a.clickedAt || new Date(now).getTime() - new Date(a.clickedAt).getTime() <= GOOGLE_CLICK_WINDOW_DAYS * DAY_MS;
  if (!fresh) return null;
  if (a.gclid) return { field: 'gclid', value: a.gclid };
  if (a.gbraid) return { field: 'gbraid', value: a.gbraid };
  if (a.wbraid) return { field: 'wbraid', value: a.wbraid };
  return null;
};

/**
 * May this lead be sent to `platform`? Consent first (no consent → never sent),
 * then "is there anything the platform could match it with".
 */
const eligibility = ({ platform, attribution, identity, now = new Date(), requireConsent = true }) => {
  if (requireConsent && !(attribution && attribution.adConsent && attribution.adConsent.granted === true)) {
    return { ok: false, reason: 'no_ad_consent' };
  }
  const email = normEmail(identity && identity.email);
  const phone = phoneDigits(identity && identity.phone);
  if (platform === 'meta') {
    if (!email && !phone && !(attribution && attribution.fbc)) return { ok: false, reason: 'no_match_keys' };
    return { ok: true };
  }
  if (platform === 'google') {
    if (!clickIdFor(attribution, now) && !email && !phone) return { ok: false, reason: 'no_match_keys' };
    return { ok: true };
  }
  return { ok: false, reason: 'unknown_platform' };
};

// --- payload builders ---------------------------------------------------------

/**
 * One Meta Conversions API event for a CRM stage change. Uses Meta's CRM shape
 * (`action_source: system_generated`, `custom_data.event_source: crm`) so the
 * dataset can be used for conversion-lead optimisation.
 *
 * `eventId` makes the send idempotent on Meta's side (same lead + stage → one
 * event even if we retry).
 */
const metaEvent = ({ eventName, eventTime, eventId, taskId, identity, attribution, defaultCountryCode = '1' }) => {
  const a = attribution || {};
  const userData = {};
  const email = normEmail(identity.email);
  const phone = phoneDigits(identity.phone, defaultCountryCode);
  const fn = normName(identity.firstName);
  const ln = normName(identity.lastName);
  if (email) userData.em = [sha256(email)];
  if (phone) userData.ph = [sha256(phone)];
  if (fn) userData.fn = [sha256(fn)];
  if (ln) userData.ln = [sha256(ln)];
  if (taskId) userData.external_id = [sha256(String(taskId))];
  if (a.fbc) userData.fbc = a.fbc;
  if (a.fbp) userData.fbp = a.fbp;
  if (a.clientIp) userData.client_ip_address = a.clientIp;
  if (a.clientUserAgent) userData.client_user_agent = a.clientUserAgent;
  return {
    event_name: eventName,
    event_time: Math.floor(new Date(eventTime).getTime() / 1000),
    event_id: eventId,
    action_source: 'system_generated',
    user_data: userData,
    custom_data: { event_source: 'crm', lead_event_source: 'LeadLoop' },
  };
};

/** `2026-11-06 14:03:09+00:00` — the only datetime shape Google accepts here. */
const googleDateTime = (d) => {
  const iso = new Date(d).toISOString(); // 2026-11-06T14:03:09.123Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00:00`;
};

const conversionActionResource = (customerId, action) => {
  const s = asText(action);
  if (!s) return '';
  if (s.startsWith('customers/')) return s;
  return `customers/${String(customerId).replace(/\D/g, '')}/conversionActions/${s.replace(/\D/g, '')}`;
};

/**
 * One Google Ads ClickConversion (REST/JSON field names). Click ID when there
 * is a fresh one, plus hashed email/phone ("enhanced conversions for leads") —
 * except with gbraid/wbraid, which Google does not allow to carry identifiers.
 */
const googleClickConversion = ({
  customerId,
  conversionAction,
  eventTime,
  eventId,
  identity,
  attribution,
  defaultCountryCode = '1',
  now = new Date(),
}) => {
  const conv = {
    conversionAction: conversionActionResource(customerId, conversionAction),
    conversionDateTime: googleDateTime(eventTime),
    orderId: eventId, // de-duplicates retries on Google's side
    consent: { adUserData: 'GRANTED' },
  };
  const click = clickIdFor(attribution, now);
  if (click) conv[click.field] = click.value;
  if (!click || click.field === 'gclid') {
    const ids = [];
    const email = normEmailForGoogle(identity.email);
    const phone = phoneDigits(identity.phone, defaultCountryCode);
    if (email) ids.push({ hashedEmail: sha256(email) });
    if (phone) ids.push({ hashedPhoneNumber: sha256(`+${phone}`) });
    if (ids.length) conv.userIdentifiers = ids;
  }
  return conv;
};

module.exports = {
  sha256,
  leadIdentity,
  normEmail,
  normEmailForGoogle,
  phoneDigits,
  normName,
  eligibility,
  metaEvent,
  googleClickConversion,
  googleDateTime,
  conversionActionResource,
  clickIdFor,
};
