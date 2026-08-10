/**
 * consentService.js — may we send this message?
 *
 * LeadLoop sends email, SMS and WhatsApp into the United States and Canada,
 * which are governed by different regimes:
 *
 *   • US TCPA — automated marketing calls and texts require prior express
 *     consent, and damages are assessed PER MESSAGE.
 *   • Canada CASL — commercial electronic messages require express or implied
 *     consent, implied consent EXPIRES, and every message must carry a working
 *     unsubscribe.
 *
 * This module is the single gate every outbound channel asks. It is PURE and
 * exhaustively tested: it takes a consent snapshot and returns a decision, with
 * a machine-readable reason so the UI can explain a block and the audit log can
 * record why something was or wasn't sent.
 *
 * Design rules, in priority order:
 *   1. SUPPRESSION IS ABSOLUTE. Someone who replied STOP, unsubscribed, or is
 *      on a do-not-call list is never messaged again — no consent record, no
 *      "but it's transactional", overrides it. This is the one that generates
 *      lawsuits.
 *   2. Transactional messages a person asked for (a booking confirmation they
 *      just requested) are not marketing and don't require marketing consent.
 *   3. Otherwise: express consent, or unexpired implied consent, or no send.
 *   4. Quiet hours apply to marketing only, in the RECIPIENT's timezone.
 *
 * This encodes a defensible default, not legal advice — the windows are
 * configurable per workspace, and counsel should confirm them for your market.
 */

/** Channels that carry consent obligations. */
const CHANNELS = ['email', 'sms', 'whatsapp', 'call'];

/** Consent states we record per lead, per channel. */
const STATES = {
  EXPRESS: 'express', // they explicitly opted in — strongest
  IMPLIED: 'implied', // e.g. CASL: they enquired; time-limited
  NONE: 'none',
  WITHDRAWN: 'withdrawn', // they opted out; treat as a hard no
};

/**
 * CASL implied-consent windows, in days. An enquiry gives implied consent for
 * six months; an existing business relationship (a transaction) for two years.
 */
const IMPLIED_WINDOW_DAYS = { enquiry: 180, transaction: 730 };

/** Why a send was refused — stable keys the UI and audit log both use. */
const BLOCKED = {
  SUPPRESSED: 'suppressed',
  WITHDRAWN: 'consent_withdrawn',
  NO_CONSENT: 'no_consent',
  IMPLIED_EXPIRED: 'implied_consent_expired',
  QUIET_HOURS: 'quiet_hours',
};

/** Default quiet hours (local to the recipient) for marketing messages. */
const DEFAULT_QUIET = { startHour: 21, endHour: 9 }; // 9pm–9am

const asDate = (v) => (v ? new Date(v) : null);

/**
 * When does an implied consent lapse? Returns a Date, or null when the record
 * carries no basis for implied consent.
 */
const impliedExpiryFor = (consent) => {
  if (!consent || consent.state !== STATES.IMPLIED) return null;
  if (consent.expiresAt) return asDate(consent.expiresAt);
  const start = asDate(consent.capturedAt);
  if (!start || Number.isNaN(start.getTime())) return null;
  const days = IMPLIED_WINDOW_DAYS[consent.basis] || IMPLIED_WINDOW_DAYS.enquiry;
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
};

/** Is an implied consent still valid at `now`? */
const isImpliedValid = (consent, now = new Date()) => {
  const expiry = impliedExpiryFor(consent);
  return !!expiry && expiry.getTime() > new Date(now).getTime();
};

/**
 * Local hour for a timezone, falling back to the server's own hour when the
 * zone is missing or invalid — never throw inside a send decision.
 */
const localHour = (now, timezone) => {
  const d = new Date(now);
  if (!timezone) return d.getHours();
  try {
    const s = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(d);
    const h = parseInt(s, 10);
    return Number.isFinite(h) ? h % 24 : d.getHours();
  } catch {
    return d.getHours();
  }
};

/**
 * Is `now` inside quiet hours? Handles windows that wrap midnight
 * (21:00 → 09:00 is the normal case).
 */
const inQuietHours = (now, timezone, quiet = DEFAULT_QUIET) => {
  const { startHour, endHour } = { ...DEFAULT_QUIET, ...(quiet || {}) };
  if (startHour === endHour) return false; // no quiet window configured
  const hour = localHour(now, timezone);
  return startHour > endHour
    ? hour >= startHour || hour < endHour // wraps midnight
    : hour >= startHour && hour < endHour;
};

/**
 * The decision.
 *
 * @param {Object} args
 * @param {string} args.channel          'email' | 'sms' | 'whatsapp' | 'call'
 * @param {Object} [args.consent]        the lead's consent record for that channel
 * @param {boolean} [args.suppressed]    is this address/number on the suppression list
 * @param {string} [args.messageType]    'marketing' (default) | 'transactional'
 * @param {Date}   [args.now]
 * @param {string} [args.timezone]       recipient's IANA timezone
 * @param {Object} [args.quietHours]     { startHour, endHour } override
 * @returns {{ allowed:boolean, reason:string|null, expiresAt:Date|null }}
 */
const canSend = ({
  channel,
  consent = null,
  suppressed = false,
  messageType = 'marketing',
  now = new Date(),
  timezone = null,
  quietHours = DEFAULT_QUIET,
} = {}) => {
  const deny = (reason) => ({ allowed: false, reason, expiresAt: null });

  // 1. Suppression beats everything, including transactional sends. If someone
  //    said STOP, we stop — completely.
  if (suppressed) return deny(BLOCKED.SUPPRESSED);

  // 2. An explicit withdrawal is a hard no, even before message type.
  if (consent && consent.state === STATES.WITHDRAWN) return deny(BLOCKED.WITHDRAWN);

  // 3. Transactional messages the person asked for are not marketing: a booking
  //    confirmation for a tour they just requested must go out.
  if (messageType === 'transactional') {
    return { allowed: true, reason: null, expiresAt: null };
  }

  // 4. Marketing needs a live consent.
  if (!consent || consent.state === STATES.NONE || !consent.state) return deny(BLOCKED.NO_CONSENT);

  if (consent.state === STATES.IMPLIED && !isImpliedValid(consent, now)) {
    return deny(BLOCKED.IMPLIED_EXPIRED);
  }

  if (consent.state !== STATES.EXPRESS && consent.state !== STATES.IMPLIED) {
    return deny(BLOCKED.NO_CONSENT);
  }

  // 5. Respect quiet hours for marketing, in the recipient's own timezone.
  if (inQuietHours(now, timezone, quietHours)) return deny(BLOCKED.QUIET_HOURS);

  return {
    allowed: true,
    reason: null,
    expiresAt: consent.state === STATES.IMPLIED ? impliedExpiryFor(consent) : null,
  };
};

/**
 * Does an inbound reply mean "stop messaging me"? Covers the keywords carriers
 * require plus the common French equivalents, since this is a bilingual product
 * operating in Québec.
 */
const OPT_OUT_WORDS = new Set([
  'stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'stopper', 'arret', 'arreter', 'desabonner',
]);

const isOptOutMessage = (body) => {
  if (!body) return false;
  const cleaned = String(body)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim();
  if (!cleaned) return false;
  // Carriers treat the keyword as the WHOLE message; "please don't stop" is not
  // an opt-out. Allow at most two words so "stop all" still counts.
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 2) return false;
  return words.every((w) => OPT_OUT_WORDS.has(w)) || OPT_OUT_WORDS.has(words.join(''));
};

module.exports = {
  CHANNELS,
  STATES,
  BLOCKED,
  IMPLIED_WINDOW_DAYS,
  DEFAULT_QUIET,
  impliedExpiryFor,
  isImpliedValid,
  inQuietHours,
  localHour,
  canSend,
  isOptOutMessage,
};
