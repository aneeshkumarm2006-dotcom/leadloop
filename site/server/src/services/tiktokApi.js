/**
 * tiktokApi.js — TikTok for Business (Marketing API) calls behind "Continue
 * with TikTok": OAuth, advertiser / Business Center / pixel listing, pixel
 * creation, Instant Form (lead) subscriptions and lead webhook checks.
 *
 * TikTok returns HTTP 200 for most failures with `code !== 0` in the body;
 * `call()` turns that into a PlatformError.
 *
 * Env: TIKTOK_APP_ID, TIKTOK_APP_SECRET, TIKTOK_API_VERSION (default v1.3).
 *
 * Several endpoint/field names below could not be confirmed against the docs
 * while the developer app is pending approval — each is isolated in its own
 * function and marked "VERIFY".
 */

const crypto = require('crypto');
const { requestJson, PlatformError } = require('./adConnectHttp');
const { API_VERSION } = require('./tiktokEvents');

const BASE = () => `https://business-api.tiktok.com/open_api/${API_VERSION()}`;

const env = () => ({
  appId: String(process.env.TIKTOK_APP_ID || '').trim(),
  secret: String(process.env.TIKTOK_APP_SECRET || '').trim(),
});

const isConfigured = () => {
  const e = env();
  return !!(e.appId && e.secret);
};

/** Call a Business API path; throws PlatformError when `code !== 0`. Returns `data`. */
const call = async (path, { token, method = 'GET', query, body, fetchImpl } = {}) => {
  const qs = query
    ? `?${new URLSearchParams(
      Object.fromEntries(Object.entries(query).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]))
    )}`
    : '';
  const headers = token ? { 'Access-Token': token } : {};
  const { json } = await requestJson(`${BASE()}/${path.replace(/^\//, '')}${qs}`, { method, headers, body, fetchImpl, label: 'tiktok' });
  if (!json || json.code !== 0) {
    const code = json && json.code;
    throw new PlatformError(`tiktok: ${(json && json.message) || 'request failed'}${code != null ? ` (code ${code})` : ''}`, {
      status: code === 40105 || code === 40104 || code === 40001 ? 401 : 502,
      code: code === 40105 || code === 40104 || code === 40001 ? 'platform_auth' : 'platform_error',
      platformMessage: String((json && json.message) || '').slice(0, 300),
    });
  }
  return json.data || {};
};

// --- OAuth --------------------------------------------------------------------

const authUrl = ({ state, redirectUri }) =>
  `https://business-api.tiktok.com/portal/auth?${new URLSearchParams({ app_id: env().appId, state, redirect_uri: redirectUri })}`;

/** auth_code → long-lived advertiser access token + the advertiser ids it covers. */
const exchangeCode = async ({ code, fetchImpl }) => {
  const e = env();
  const data = await call('oauth2/access_token/', { method: 'POST', body: { app_id: e.appId, secret: e.secret, auth_code: code }, fetchImpl });
  if (!data.access_token) throw new PlatformError('tiktok: no access token returned', { code: 'exchange_failed' });
  return {
    accessToken: data.access_token,
    advertiserIds: (data.advertiser_ids || []).map(String),
    scope: data.scope || [],
  };
};

/** VERIFY: `/user/info/` field names (display_name vs. email). */
const userInfo = async (token, { fetchImpl } = {}) => {
  const data = await call('user/info/', { token, fetchImpl });
  return { name: data.display_name || data.email || '' };
};

// --- assets -------------------------------------------------------------------

/** Advertisers this token was authorised for (names). */
const listAdvertisers = async (token, { fetchImpl } = {}) => {
  const e = env();
  const data = await call('oauth2/advertiser/get/', { token, query: { app_id: e.appId, secret: e.secret }, fetchImpl });
  const list = (data.list || []).map((a) => ({ id: String(a.advertiser_id), name: a.advertiser_name || '', currency: '' }));
  // Currency comes from /advertiser/info/ (best effort, max 100 ids per call).
  try {
    const ids = list.map((a) => a.id).slice(0, 100);
    if (ids.length) {
      const info = await call('advertiser/info/', { token, query: { advertiser_ids: ids, fields: ['advertiser_id', 'currency', 'name'] }, fetchImpl });
      const byId = new Map((info.list || []).map((i) => [String(i.advertiser_id), i]));
      for (const a of list) a.currency = (byId.get(a.id) && byId.get(a.id).currency) || '';
    }
  } catch (err) {
    console.warn('[tiktok] advertiser info lookup skipped:', err.message);
  }
  return list;
};

/** VERIFY: `/bc/get/` response shape (`list[].bc_info.{bc_id,name}`). Optional — empty on failure. */
const listBusinessCenters = async (token, { fetchImpl } = {}) => {
  try {
    const data = await call('bc/get/', { token, fetchImpl });
    return (data.list || []).map((b) => {
      const info = b.bc_info || b;
      return { id: String(info.bc_id || ''), name: info.name || '' };
    }).filter((b) => b.id);
  } catch (err) {
    console.warn('[tiktok] business center list skipped:', err.message);
    return [];
  }
};

const listPixels = async (token, advertiserId, { fetchImpl } = {}) => {
  const data = await call('pixel/list/', { token, query: { advertiser_id: advertiserId, page_size: 20 }, fetchImpl });
  return (data.pixels || []).map((p) => ({ code: p.pixel_code || '', id: String(p.pixel_id || ''), name: p.pixel_name || '' })).filter((p) => p.code);
};

/**
 * VERIFY: `/pixel/create/` required fields. Believed to be
 * `{ advertiser_id, pixel_name, pixel_category? }` → `{ pixel_code, pixel_id }`.
 */
const createPixel = async (token, advertiserId, name, { fetchImpl } = {}) => {
  const data = await call('pixel/create/', { token, method: 'POST', body: { advertiser_id: advertiserId, pixel_name: name }, fetchImpl });
  if (!data.pixel_code) throw new PlatformError('tiktok: pixel create returned no code', { code: 'pixel_create_failed' });
  return { code: data.pixel_code, id: String(data.pixel_id || ''), name };
};

// --- Instant Forms (lead) subscription -------------------------------------------

/**
 * Subscribe an advertiser's Instant Form leads to our webhook.
 * VERIFY once the developer app is approved: path `subscription/subscribe/`,
 * `subscribe_entity: 'LEAD'`, and the `subscription_detail` field names.
 * @returns {{ subscriptionId: string }}
 */
const subscribeLeads = async ({ token, advertiserId, callbackUrl, fetchImpl }) => {
  const e = env();
  const data = await call('subscription/subscribe/', {
    token,
    method: 'POST',
    body: {
      app_id: e.appId,
      secret: e.secret,
      subscribe_entity: 'LEAD',
      callback_url: callbackUrl,
      subscription_detail: { access_token: token, advertiser_id: advertiserId },
    },
    fetchImpl,
  });
  return { subscriptionId: String(data.subscription_id || '') };
};

/** VERIFY: path `subscription/unsubscribe/` + body field names. Best effort. */
const unsubscribeLeads = async ({ token, subscriptionId, fetchImpl }) => {
  if (!subscriptionId) return null;
  const e = env();
  return call('subscription/unsubscribe/', {
    token,
    method: 'POST',
    body: { app_id: e.appId, secret: e.secret, subscription_id: subscriptionId },
    fetchImpl,
  });
};

/**
 * TikTok lead webhook signature check.
 * VERIFY: header name and scheme. Assumed `TikTok-Signature: t=<unix>,s=<hex
 * HMAC-SHA256(app secret, "<t>.<raw body>")>`. Our webhook is ALSO
 * authenticated by a per-workspace secret in its URL, so when no signature
 * header is present we rely on that (returns null = "not provided"); a present
 * but wrong signature is rejected (false).
 * @returns {true|false|null}
 */
const verifyWebhookSignature = (rawBody, header, { secret = env().secret, now = Date.now(), toleranceSec = 300 } = {}) => {
  if (!header) return null;
  if (!secret || !Buffer.isBuffer(rawBody)) return false;
  const parts = Object.fromEntries(
    String(header).split(',').map((kv) => kv.trim().split('=')).filter((p) => p.length === 2)
  );
  const t = Number(parts.t);
  const sig = parts.s || parts.v1 || '';
  if (!Number.isFinite(t) || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  if (Math.abs(now / 1000 - t) > toleranceSec) return false; // replay window
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  const got = Buffer.from(sig, 'hex');
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
};

/**
 * Split a webhook body into individual leads. Tolerant of shapes:
 * `{ leads:[…] }`, `{ data:{ leads:[…] } }`, `{ data:[{lead_id…}] }`, or one
 * lead object. Each lead keeps its id + advertiser id for idempotency/routing.
 * VERIFY: actual envelope once a test lead can be sent.
 */
const extractLeads = (body) => {
  if (!body || typeof body !== 'object') return [];
  const candidates =
    (Array.isArray(body.leads) && body.leads) ||
    (body.data && Array.isArray(body.data.leads) && body.data.leads) ||
    (Array.isArray(body.data) && body.data.some((x) => x && (x.lead_id || x.leadId)) && body.data) ||
    (body.lead && typeof body.lead === 'object' && [body.lead]) ||
    [body];
  return candidates
    .filter((l) => l && typeof l === 'object')
    .slice(0, 100)
    .map((l) => {
      const leadId = l.lead_id || l.leadId || l.id || '';
      const advertiserId = l.advertiser_id || l.advertiserId || body.advertiser_id || (body.data && body.data.advertiser_id) || '';
      return { leadId: String(leadId), advertiserId: String(advertiserId), lead: l };
    })
    .filter((l) => /^[A-Za-z0-9_-]{1,64}$/.test(l.leadId));
};

module.exports = {
  isConfigured,
  authUrl,
  exchangeCode,
  userInfo,
  listAdvertisers,
  listBusinessCenters,
  listPixels,
  createPixel,
  subscribeLeads,
  unsubscribeLeads,
  verifyWebhookSignature,
  extractLeads,
};
