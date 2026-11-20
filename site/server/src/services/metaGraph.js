/**
 * metaGraph.js — the Meta (Facebook) Graph API calls behind "Continue with
 * Facebook": OAuth, asset listing, pixel create/read, Page Lead Ads
 * subscription, lead retrieval, and webhook signature checks.
 *
 * Every call carries `appsecret_proof` (HMAC-SHA256 of the token with the app
 * secret) so a leaked token is useless without our app secret. Tokens go in
 * the Authorization header, never in logged URLs.
 *
 * Env: META_APP_ID, META_APP_SECRET, META_LOGIN_CONFIG_ID (optional — Facebook
 * Login for Business configuration), META_WEBHOOK_VERIFY_TOKEN,
 * META_API_VERSION (default v24.0).
 *
 * `fetchImpl` is injectable everywhere so tests never touch the network.
 */

const crypto = require('crypto');
const { requestJson, PlatformError } = require('./adConnectHttp');
const { API_VERSION } = require('./metaCapi');

const GRAPH = () => `https://graph.facebook.com/${API_VERSION()}`;

// Classic Facebook Login scopes (used when no Login for Business config id is set).
const SCOPES = [
  'ads_management',
  'ads_read',
  'business_management',
  'leads_retrieval',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
];

const env = () => ({
  appId: String(process.env.META_APP_ID || '').trim(),
  appSecret: String(process.env.META_APP_SECRET || '').trim(),
  configId: String(process.env.META_LOGIN_CONFIG_ID || '').trim(),
  verifyToken: String(process.env.META_WEBHOOK_VERIFY_TOKEN || '').trim(),
});

const isConfigured = () => {
  const e = env();
  return !!(e.appId && e.appSecret);
};

const appSecretProof = (token, appSecret = env().appSecret) =>
  crypto.createHmac('sha256', appSecret).update(String(token)).digest('hex');

/** GET/POST a Graph path with a user/page token. */
const graph = async (path, token, { method = 'GET', params = {}, fetchImpl } = {}) => {
  const qs = new URLSearchParams({ ...params, appsecret_proof: appSecretProof(token) });
  const url = `${GRAPH()}/${path.replace(/^\//, '')}`;
  if (method === 'GET' || method === 'DELETE') {
    const { json } = await requestJson(`${url}?${qs}`, { method, headers: { Authorization: `Bearer ${token}` }, fetchImpl, label: 'meta' });
    return json;
  }
  const { json } = await requestJson(url, { method, headers: { Authorization: `Bearer ${token}` }, body: qs, fetchImpl, label: 'meta' });
  return json;
};

/** Follow Graph cursor pagination up to `max` items. */
const graphList = async (path, token, { params = {}, fetchImpl, max = 200 } = {}) => {
  const out = [];
  let after = null;
  for (let page = 0; page < 10 && out.length < max; page += 1) {
    const json = await graph(path, token, { params: { limit: '100', ...params, ...(after ? { after } : {}) }, fetchImpl });
    for (const item of (json && json.data) || []) out.push(item);
    after = json && json.paging && json.paging.next && json.paging.cursors ? json.paging.cursors.after : null;
    if (!after) break;
  }
  return out.slice(0, max);
};

// --- OAuth --------------------------------------------------------------------

/**
 * Consent dialog URL. With META_LOGIN_CONFIG_ID set we use Facebook Login for
 * Business (`config_id`, permissions come from the configuration); otherwise
 * classic `scope=`.
 * VERIFY once the developer app is approved: whether the Login for Business
 * configuration should be a "User access token" or "System-user access token"
 * config, and the exact permission list it grants.
 */
const authUrl = ({ state, redirectUri }) => {
  const e = env();
  const params = new URLSearchParams({ client_id: e.appId, redirect_uri: redirectUri, state, response_type: 'code' });
  if (e.configId) {
    params.set('config_id', e.configId);
    params.set('override_default_response_type', 'true');
  } else {
    params.set('scope', SCOPES.join(','));
  }
  return `https://www.facebook.com/${API_VERSION()}/dialog/oauth?${params}`;
};

/**
 * code → short-lived token → long-lived token (~60 days). A system-user token
 * from Login for Business comes back without `expires_in` (non-expiring).
 * @returns {{ accessToken, expiresAt: Date|null }}
 */
const exchangeCode = async ({ code, redirectUri, fetchImpl }) => {
  const e = env();
  const short = await requestJson(
    `${GRAPH()}/oauth/access_token?${new URLSearchParams({ client_id: e.appId, client_secret: e.appSecret, redirect_uri: redirectUri, code })}`,
    { fetchImpl, label: 'meta' }
  );
  const shortToken = short.json && short.json.access_token;
  if (!shortToken) throw new PlatformError('meta: no access token in code exchange', { code: 'exchange_failed' });
  let token = shortToken;
  let expiresIn = short.json.expires_in || null;
  try {
    const long = await requestJson(
      `${GRAPH()}/oauth/access_token?${new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: e.appId,
        client_secret: e.appSecret,
        fb_exchange_token: shortToken,
      })}`,
      { fetchImpl, label: 'meta' }
    );
    if (long.json && long.json.access_token) {
      token = long.json.access_token;
      expiresIn = long.json.expires_in || null;
    }
  } catch (err) {
    // System-user tokens can't be exchanged; keep the one we have.
    console.warn('[meta] long-lived token exchange skipped:', err.message);
  }
  return { accessToken: token, expiresAt: expiresIn ? new Date(Date.now() + Number(expiresIn) * 1000) : null };
};

const me = (token, { fetchImpl } = {}) => graph('me', token, { params: { fields: 'id,name' }, fetchImpl });

// --- assets -------------------------------------------------------------------

const listBusinesses = async (token, { fetchImpl } = {}) =>
  (await graphList('me/businesses', token, { params: { fields: 'id,name' }, fetchImpl })).map((b) => ({ id: String(b.id), name: b.name || '' }));

const listAdAccounts = async (token, { fetchImpl } = {}) =>
  (await graphList('me/adaccounts', token, { params: { fields: 'id,account_id,name,currency,business{id,name}' }, fetchImpl })).map((a) => ({
    id: String(a.id), // act_…
    accountId: String(a.account_id || String(a.id).replace(/^act_/, '')),
    name: a.name || '',
    businessId: a.business && a.business.id ? String(a.business.id) : '',
    currency: a.currency || '',
  }));

/** Pages the user manages, WITH page tokens (server-side only — never returned). */
const listPagesWithTokens = async (token, { fetchImpl } = {}) =>
  (await graphList('me/accounts', token, { params: { fields: 'id,name,access_token,instagram_business_account{id}' }, fetchImpl })).map((p) => ({
    id: String(p.id),
    name: p.name || '',
    accessToken: p.access_token || null,
    instagramId: p.instagram_business_account && p.instagram_business_account.id ? String(p.instagram_business_account.id) : '',
  }));

const listPixels = async (token, adAccountId, { fetchImpl } = {}) =>
  (await graphList(`${encodeURIComponent(adAccountId)}/adspixels`, token, { params: { fields: 'id,name,last_fired_time' }, fetchImpl })).map((p) => ({
    id: String(p.id),
    name: p.name || '',
    lastFiredAt: p.last_fired_time || null,
  }));

const createPixel = async (token, adAccountId, name, { fetchImpl } = {}) => {
  const json = await graph(`${encodeURIComponent(adAccountId)}/adspixels`, token, { method: 'POST', params: { name }, fetchImpl });
  if (!json || !json.id) throw new PlatformError('meta: pixel create returned no id', { code: 'pixel_create_failed' });
  return { id: String(json.id), name };
};

/** Token + pixel read check — proves the token can reach the dataset. */
const readPixel = async (token, pixelId, { fetchImpl } = {}) => {
  const json = await graph(encodeURIComponent(pixelId), token, { params: { fields: 'id,name' }, fetchImpl });
  return { id: String(json.id), name: json.name || '' };
};

// --- Lead Ads -----------------------------------------------------------------

const subscribePage = (pageId, pageToken, { fetchImpl } = {}) =>
  graph(`${encodeURIComponent(pageId)}/subscribed_apps`, pageToken, { method: 'POST', params: { subscribed_fields: 'leadgen' }, fetchImpl });

const unsubscribePage = (pageId, pageToken, { fetchImpl } = {}) =>
  graph(`${encodeURIComponent(pageId)}/subscribed_apps`, pageToken, { method: 'DELETE', fetchImpl });

const LEAD_FIELDS = 'field_data,created_time,ad_id,adset_id,campaign_id,campaign_name,form_id,platform';

const getLead = (leadgenId, pageToken, { fetchImpl } = {}) =>
  graph(encodeURIComponent(leadgenId), pageToken, { params: { fields: LEAD_FIELDS }, fetchImpl });

// --- webhook ------------------------------------------------------------------

/**
 * `X-Hub-Signature-256: sha256=<hex HMAC of the RAW body with the app secret>`.
 * Constant-time compare; false on any malformed input.
 */
const verifySignature = (rawBody, header, appSecret = env().appSecret) => {
  if (!appSecret || !Buffer.isBuffer(rawBody) || typeof header !== 'string') return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  const got = Buffer.from(m[1], 'hex');
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
};

/** Pull `{ pageId, leadgenId, formId, adId, createdTime }` out of a webhook body. Pure. */
const parseLeadgenChanges = (body) => {
  const out = [];
  if (!body || body.object !== 'page' || !Array.isArray(body.entry)) return out;
  for (const entry of body.entry.slice(0, 100)) {
    for (const change of (entry && Array.isArray(entry.changes) ? entry.changes : []).slice(0, 100)) {
      if (!change || change.field !== 'leadgen' || !change.value) continue;
      const v = change.value;
      const leadgenId = v.leadgen_id != null ? String(v.leadgen_id) : '';
      const pageId = v.page_id != null ? String(v.page_id) : entry.id != null ? String(entry.id) : '';
      if (!/^\d{1,30}$/.test(leadgenId) || !/^\d{1,30}$/.test(pageId)) continue;
      out.push({
        pageId,
        leadgenId,
        formId: v.form_id != null ? String(v.form_id) : '',
        adId: v.ad_id != null ? String(v.ad_id) : '',
        createdTime: v.created_time || null,
      });
    }
  }
  return out;
};

/** GET verification handshake → the challenge string, or null to refuse. */
const verifyChallenge = (query, verifyToken = env().verifyToken) => {
  if (!verifyToken || !query) return null;
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string') return null;
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return /^[A-Za-z0-9_.-]{1,200}$/.test(challenge) ? challenge : null;
};

module.exports = {
  isConfigured,
  authUrl,
  exchangeCode,
  me,
  listBusinesses,
  listAdAccounts,
  listPagesWithTokens,
  listPixels,
  createPixel,
  readPixel,
  subscribePage,
  unsubscribePage,
  getLead,
  verifySignature,
  parseLeadgenChanges,
  verifyChallenge,
  appSecretProof,
  SCOPES,
};
