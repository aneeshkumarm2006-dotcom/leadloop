/**
 * sourceAdapters.js — normalise a lead source's raw webhook body into the flat
 * `{ field: value }` object the ingest spine (schemaInference + leadIngest)
 * expects.
 *
 * A LeadConnection stores a `sourceType`. Different platforms POST wildly
 * different body shapes for what is conceptually the same lead:
 *
 *   • a plain website form / Zapier  →  already flat `{ full_name, email }`
 *   • Google Ads Lead Form           →  `{ user_column_data: [{ column_name,
 *                                         string_value }], lead_id, … }`
 *   • Facebook / Instagram Lead Ads  →  `{ field_data: [{ name, values:[…] }] }`
 *
 * `normalizeSourcePayload(sourceType, rawBody)` collapses each into flat keys so
 * everything downstream (inference → column provisioning → task creation) stays
 * source-agnostic. Adapters are PURE and total: an unknown/passthrough source or
 * a body that doesn't match the expected shape falls back to the body as-is, so
 * a mislabelled connection degrades to "generic" rather than dropping the lead.
 */

/**
 * The lead sources the hub can wire up. `delivery` tells the UI how leads
 * arrive so it can render the right setup steps:
 *   - 'webhook' : platform POSTs to our URL-keyed ingest endpoint
 *   - 'email'   : portal emails ADF/XML leads (parsed in a later phase)
 *   - 'poll'    : we pull on a schedule (Google Forms → Sheets, later phase)
 * `adapter` names the normaliser below; sources without a special shape use
 * 'passthrough'. `ready` gates which cards are live vs "coming soon" in the UI.
 */
const SOURCE_TYPES = {
  website: { delivery: 'webhook', adapter: 'passthrough', ready: true },
  zapier: { delivery: 'webhook', adapter: 'passthrough', ready: true },
  generic: { delivery: 'webhook', adapter: 'passthrough', ready: true },
  google_ads: { delivery: 'webhook', adapter: 'google_ads', ready: true },
  facebook_lead_ads: { delivery: 'webhook', adapter: 'facebook', ready: true },
  instagram_lead_ads: { delivery: 'webhook', adapter: 'facebook', ready: true },
  meta_ads: { delivery: 'webhook', adapter: 'facebook', ready: true },
  google_forms: { delivery: 'poll', adapter: 'passthrough', ready: false },
  zillow: { delivery: 'email', adapter: 'passthrough', ready: false },
  realtor_com: { delivery: 'email', adapter: 'passthrough', ready: false },
  realtor_ca: { delivery: 'email', adapter: 'passthrough', ready: false },
  redfin: { delivery: 'email', adapter: 'passthrough', ready: false },
  google_lsa: { delivery: 'webhook', adapter: 'passthrough', ready: false },
};

const DEFAULT_SOURCE = 'website';

/** True if `type` is a source the hub knows about. */
const isValidSourceType = (type) =>
  typeof type === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_TYPES, type);

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Google Ads Lead Form webhook. The lead's fields live in `user_column_data`,
 * an array of `{ column_id, column_name, string_value }`. We key by the human
 * `column_name` when present (nicer board columns) and fall back to `column_id`.
 * The envelope's attribution ids (campaign / gcl / form) are surfaced as flat
 * fields too so source ROI reporting can join on them later; the shared
 * `google_key` verification secret is dropped (never a lead field).
 */
const adaptGoogleAds = (body) => {
  if (!isPlainObject(body) || !Array.isArray(body.user_column_data)) return body;
  const out = {};
  for (const col of body.user_column_data) {
    if (!isPlainObject(col)) continue;
    const key = col.column_name || col.column_id;
    if (!key) continue;
    const value = col.string_value != null ? col.string_value : '';
    out[String(key)] = value;
  }
  // Attribution passthrough — helpful, non-secret envelope fields only.
  for (const k of ['campaign_id', 'form_id', 'gcl_id', 'lead_id']) {
    if (body[k] != null && body[k] !== '') out[k] = body[k];
  }
  return Object.keys(out).length ? out : body;
};

/**
 * Facebook / Instagram Lead Ads. Meta's leadgen data (and most bridges that
 * forward it) carry `field_data`, an array of `{ name, values: [string] }`.
 * Flatten to `{ name: values[0] }`.
 */
const adaptFacebook = (body) => {
  if (!isPlainObject(body) || !Array.isArray(body.field_data)) return body;
  const out = {};
  for (const f of body.field_data) {
    if (!isPlainObject(f) || !f.name) continue;
    const value = Array.isArray(f.values) ? f.values[0] : f.value;
    out[String(f.name)] = value != null ? value : '';
  }
  // Keep useful envelope ids if present.
  for (const k of ['campaign_name', 'ad_id', 'form_id', 'leadgen_id', 'created_time']) {
    if (body[k] != null && body[k] !== '') out[k] = body[k];
  }
  return Object.keys(out).length ? out : body;
};

const ADAPTERS = {
  passthrough: (body) => body,
  google_ads: adaptGoogleAds,
  facebook: adaptFacebook,
};

/**
 * Normalise a raw ingest body for the given source type. Never throws: an
 * unknown source, a null body, or a shape mismatch all fall back to the body
 * unchanged, so ingest still runs the generic inference path.
 *
 * @param {string} sourceType  a key of SOURCE_TYPES (else treated as passthrough)
 * @param {Object} rawBody     the parsed request body
 * @returns {Object} flat `{ field: value }`
 */
const normalizeSourcePayload = (sourceType, rawBody) => {
  if (!isPlainObject(rawBody)) return rawBody;
  const spec = SOURCE_TYPES[sourceType];
  const adapter = (spec && ADAPTERS[spec.adapter]) || ADAPTERS.passthrough;
  try {
    return adapter(rawBody);
  } catch {
    return rawBody; // an adapter bug must never lose a lead
  }
};

module.exports = {
  SOURCE_TYPES,
  DEFAULT_SOURCE,
  isValidSourceType,
  normalizeSourcePayload,
};
