/**
 * importService.js — bring an existing CRM's contacts into LeadLoop.
 *
 * This is the feature that decides whether a brokerage can switch at all: they
 * have thousands of contacts elsewhere, and if those can't come across in a few
 * minutes the trial ends there.
 *
 * The mapping half is pure and tested here. It guesses which board column each
 * CSV header belongs to so the user confirms a filled-in screen rather than
 * building one from scratch.
 */

const { normalizeEmail, normalizePhone } = require('./dedupeService');

/**
 * Header patterns → the board column TYPE they most likely belong to. Ordered:
 * the first pattern that matches wins, so put the specific ones first.
 */
const HEADER_HINTS = [
  { re: /^(full\s*name|name|lead\s*name|contact(\s*name)?|client)$/i, role: 'name' },
  { re: /^(first\s*name|given\s*name|firstname)$/i, role: 'firstName' },
  { re: /^(last\s*name|surname|family\s*name|lastname)$/i, role: 'lastName' },
  { re: /e-?mail/i, role: 'email' },
  { re: /(mobile|cell|phone|tel|contact\s*number)/i, role: 'phone' },
  { re: /(budget|price|amount|value|max\s*price)/i, role: 'number' },
  { re: /(source|channel|origin|referr)/i, role: 'source' },
  { re: /(note|comment|remark|description|detail)/i, role: 'notes' },
  { re: /(date|created|added|move.?in|closing)/i, role: 'date' },
  { re: /(city|town|area|neighbou?rhood|location)/i, role: 'text' },
  { re: /(status|stage|pipeline)/i, role: 'status' },
];

/** The board column type each role prefers. */
const TYPE_FOR_ROLE = {
  email: 'email',
  phone: 'phone',
  number: 'number',
  date: 'date',
  notes: 'long_text',
  source: 'text',
  text: 'text',
  status: 'status',
};

/** Classify a CSV header into a role, or null when we have no idea. */
const roleForHeader = (header) => {
  const h = String(header || '').trim();
  if (!h) return null;
  const hit = HEADER_HINTS.find((x) => x.re.test(h));
  return hit ? hit.role : null;
};

/**
 * Suggest a mapping from CSV headers to board columns.
 *
 * Strategy, in order of confidence:
 *   1. exact (case-insensitive) match on a column's name or key;
 *   2. the header's inferred role matched against a column of that type;
 *   3. unmapped — the user picks, or skips the column.
 *
 * `name` is special: it targets the board's primary column rather than a
 * regular one, because that is what a lead is titled by.
 *
 * @returns {Array<{ header, columnId, columnName, role, confidence }>}
 */
const suggestMapping = (headers = [], columns = []) => {
  const regular = columns.filter((c) => !c.isPrimary);
  const primary = columns.find((c) => c.isPrimary) || null;
  const taken = new Set();
  const out = [];

  for (const header of headers) {
    const role = roleForHeader(header);
    const h = String(header || '').trim().toLowerCase();

    // 1. exact name/key match
    const exact = regular.find(
      (c) => !taken.has(String(c._id)) && (String(c.name).toLowerCase() === h || String(c.key || '').toLowerCase() === h)
    );
    if (exact) {
      taken.add(String(exact._id));
      out.push({ header, columnId: String(exact._id), columnName: exact.name, role, confidence: 'exact' });
      continue;
    }

    // The lead's title maps to the primary column, not a normal one.
    if (role === 'name' && primary) {
      out.push({ header, columnId: 'primary', columnName: primary.name, role, confidence: 'name' });
      continue;
    }

    // 2. type match from the inferred role
    const wantType = TYPE_FOR_ROLE[role];
    const byType = wantType
      ? regular.find((c) => !taken.has(String(c._id)) && c.type === wantType)
      : null;
    if (byType) {
      taken.add(String(byType._id));
      out.push({ header, columnId: String(byType._id), columnName: byType.name, role, confidence: 'type' });
      continue;
    }

    // 3. no idea — the import screen shows this as "Skip this column".
    out.push({ header, columnId: null, columnName: null, role, confidence: 'none' });
  }

  return out;
};

/**
 * Build the values for one lead from a CSV row and a confirmed mapping.
 * Returns `{ name, columnValues, email, phone }` — the last two are lifted out
 * for duplicate matching.
 */
const buildLead = (row = {}, mapping = []) => {
  const columnValues = {};
  let name = '';
  let first = '';
  let last = '';
  let email = null;
  let phone = null;

  for (const map of mapping) {
    const raw = row[map.header];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const value = String(raw).trim();

    if (map.role === 'firstName') first = value;
    if (map.role === 'lastName') last = value;
    if (map.role === 'email' && !email) email = value;
    if (map.role === 'phone' && !phone) phone = value;

    if (map.columnId === 'primary') {
      name = value;
      continue;
    }
    if (!map.columnId) continue; // skipped column
    columnValues[map.columnId] = value;
  }

  // Many exports carry first/last rather than a single name column.
  if (!name) name = [first, last].filter(Boolean).join(' ').trim();
  if (!name && email) name = email; // never create an untitled lead

  return {
    name,
    columnValues,
    email: normalizeEmail(email),
    phone: normalizePhone(phone),
  };
};

/**
 * Split incoming rows into new leads and ones that already exist, by matching
 * normalised email/phone against an index of what is already on the board.
 * Pure — the caller supplies the index.
 *
 * @param {Array} leads     output of buildLead
 * @param {Object} existing { emails:Set, phones:Set }
 */
const splitExisting = (leads = [], existing = { emails: new Set(), phones: new Set() }) => {
  const fresh = [];
  const duplicates = [];
  // Also de-duplicate WITHIN the file: exports routinely contain the same
  // person twice, and importing both just recreates the problem we solved.
  const seenEmails = new Set();
  const seenPhones = new Set();

  for (const lead of leads) {
    const dupInFile =
      (lead.email && seenEmails.has(lead.email)) || (lead.phone && seenPhones.has(lead.phone));
    const dupOnBoard =
      (lead.email && existing.emails.has(lead.email)) || (lead.phone && existing.phones.has(lead.phone));

    if (dupInFile || dupOnBoard) {
      duplicates.push({ ...lead, reason: dupOnBoard ? 'exists' : 'duplicate_in_file' });
    } else {
      fresh.push(lead);
    }
    if (lead.email) seenEmails.add(lead.email);
    if (lead.phone) seenPhones.add(lead.phone);
  }

  return { fresh, duplicates };
};

module.exports = {
  HEADER_HINTS,
  roleForHeader,
  suggestMapping,
  buildLead,
  splitExisting,
};
