/**
 * dedupeService.js — deciding whether two leads are the same person.
 *
 * The one-click connectors made this urgent: a serious buyer enquires on
 * Zillow, on a Facebook ad, and through the website, and we ingest three
 * separate leads. Three agents call the same person and every conversion
 * number in the Production report is wrong.
 *
 * Everything here is PURE and heavily unit-tested, because the cost of getting
 * it wrong is asymmetric:
 *
 *   • a MISSED duplicate is an annoyance — the pair stays visible and can be
 *     merged by hand later;
 *   • a WRONG merge destroys two real people's records.
 *
 * So the bar for "definitely the same" is deliberately high, we NEVER merge
 * automatically, and a name match on its own is never enough — "John Smith"
 * is not evidence. Contact details are; names only ever act as corroboration.
 */

// Score thresholds. `REVIEW` is the floor for recording a candidate at all.
const SCORE = {
  EXACT_CONTACT: 70, // one contact identifier matches exactly
  BOTH_CONTACTS: 100, // phone AND email both match
  NAME_BOOST: 20, // corroborating name similarity
  REVIEW: 70, // record a candidate at or above this
  STRONG: 90, // "very likely the same person" in the UI
};

/**
 * Normalise a phone number to a comparable key: digits only, North-American
 * country code dropped, last 10 digits kept. Returns null when there aren't
 * enough digits to be meaningful — a 4-digit extension must never match.
 *
 * "+1 (514) 555-0142" and "514 555 0142" → "5145550142"
 */
const normalizePhone = (raw) => {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D+/g, '');
  if (digits.length < 7) return null;
  // North-American numbers: drop a leading country code.
  const trimmed = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return trimmed.length > 10 ? trimmed.slice(-10) : trimmed;
};

/**
 * Normalise an email for comparison:
 *   • lowercase + trim
 *   • strip a `+tag` subaddress (RFC 5233) — dana+zillow@ is dana@
 *   • strip dots in the local part for Gmail only, where they're ignored
 *
 * Dot-stripping is deliberately NOT applied to other providers: plenty of hosts
 * treat `j.smith@` and `jsmith@` as different mailboxes, and merging two real
 * people would be far worse than missing a duplicate.
 */
const normalizeEmail = (raw) => {
  if (raw == null) return null;
  const value = String(raw).trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;
  let local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!domain.includes('.')) return null;
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replace(/\./g, '');
  return local ? `${local}@${domain}` : null;
};

/** Strip accents/punctuation and lowercase — "Marie-Claude Roy" → "marie claude roy". */
const normalizeName = (raw) => {
  if (raw == null) return '';
  return String(raw)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining accents
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * How alike two names are, 0..1, by token overlap (Jaccard). Order-insensitive
 * so "Roy Marie-Claude" matches "Marie Claude Roy". Single-initial tokens are
 * dropped: "D. Whitfield" and "Dana Whitfield" should corroborate on the
 * surname rather than be penalised for the initial.
 */
const nameSimilarity = (a, b) => {
  const tokens = (s) => new Set(normalizeName(s).split(' ').filter((tk) => tk.length > 1));
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const tk of A) if (B.has(tk)) shared += 1;
  return shared / (A.size + B.size - shared);
};

/**
 * Score how likely two leads are the same person.
 *
 * @param {{name?, email?, phone?}} a
 * @param {{name?, email?, phone?}} b
 * @returns {{ score:number, reasons:string[], isDuplicate:boolean, isStrong:boolean }}
 */
const scoreMatch = (a = {}, b = {}) => {
  const reasons = [];

  const aPhone = normalizePhone(a.phone);
  const bPhone = normalizePhone(b.phone);
  const phoneMatch = !!aPhone && aPhone === bPhone;

  const aEmail = normalizeEmail(a.email);
  const bEmail = normalizeEmail(b.email);
  const emailMatch = !!aEmail && aEmail === bEmail;

  const nameScore = nameSimilarity(a.name, b.name);

  let score = 0;
  if (phoneMatch && emailMatch) {
    score = SCORE.BOTH_CONTACTS;
    reasons.push('phone', 'email');
  } else if (phoneMatch) {
    score = SCORE.EXACT_CONTACT;
    reasons.push('phone');
  } else if (emailMatch) {
    score = SCORE.EXACT_CONTACT;
    reasons.push('email');
  }

  // Names only ever corroborate an existing contact match. On their own they
  // prove nothing — two different John Smiths are common, and merging them
  // would destroy both records.
  if (score > 0 && nameScore >= 0.5) {
    score = Math.min(100, score + SCORE.NAME_BOOST);
    reasons.push('name');
  }

  return {
    score,
    reasons,
    isDuplicate: score >= SCORE.REVIEW,
    isStrong: score >= SCORE.STRONG,
  };
};

/**
 * Pick the best duplicate for `candidate` from `existing`. Returns null when
 * nothing clears the review threshold. Ties break toward the higher score, then
 * the older record (the original is more likely the one to keep).
 *
 * @param {Object} candidate      { id, name, email, phone, createdAt }
 * @param {Array}  existing       same shape
 */
const findBestMatch = (candidate, existing = []) => {
  let best = null;
  for (const other of existing) {
    if (!other || String(other.id) === String(candidate.id)) continue;
    const result = scoreMatch(candidate, other);
    if (!result.isDuplicate) continue;
    if (
      !best ||
      result.score > best.score ||
      (result.score === best.score && new Date(other.createdAt || 0) < new Date(best.match.createdAt || 0))
    ) {
      best = { ...result, match: other };
    }
  }
  return best;
};

/**
 * Merge two leads' field values. `choices` maps a field to 'primary' or
 * 'duplicate'; anything unspecified prefers the primary, then falls back to the
 * duplicate when the primary is empty — so merging never LOSES information the
 * user didn't explicitly discard.
 */
const mergeValues = (primary = {}, duplicate = {}, choices = {}) => {
  const out = {};
  const keys = new Set([...Object.keys(primary), ...Object.keys(duplicate)]);
  const isEmpty = (v) => v === undefined || v === null || v === '';
  for (const key of keys) {
    const pick = choices[key];
    if (pick === 'duplicate') {
      out[key] = isEmpty(duplicate[key]) ? primary[key] : duplicate[key];
    } else if (pick === 'primary') {
      out[key] = isEmpty(primary[key]) ? duplicate[key] : primary[key];
    } else {
      out[key] = isEmpty(primary[key]) ? duplicate[key] : primary[key];
    }
  }
  return out;
};

module.exports = {
  SCORE,
  normalizePhone,
  normalizeEmail,
  normalizeName,
  nameSimilarity,
  scoreMatch,
  findBestMatch,
  mergeValues,
};
