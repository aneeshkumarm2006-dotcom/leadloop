/**
 * googleAdsConversions.js — upload offline click conversions to Google Ads.
 *
 *   POST https://googleads.googleapis.com/{version}/customers/{cid}:uploadClickConversions
 *
 * Uses the AGENCY's credentials from env (the client's Ads account must be
 * linked under the manager account in GOOGLE_ADS_LOGIN_CUSTOMER_ID):
 *   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
 *   GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID,
 *   GOOGLE_ADS_API_VERSION (optional; defaults below — bump when Google sunsets it).
 *
 * Workspaces that connected with "Sign in with Google" pass their own
 * (decrypted) refresh token + login customer id instead; the OAuth client is
 * GOOGLE_ADS_OAUTH_CLIENT_ID/SECRET (falls back to GOOGLE_ADS_CLIENT_ID/SECRET).
 *
 * Result shape matches metaCapi.sendEvents: { ok, retryable, error, response }.
 */

const API_VERSION = () => process.env.GOOGLE_ADS_API_VERSION || 'v21';
const digits = (s) => String(s || '').replace(/\D/g, '');

const missingConfig = () =>
  ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'].filter(
    (k) => !String(process.env[k] || '').trim()
  );

const isConfigured = () => missingConfig().length === 0;

/**
 * OAuth client used for per-workspace ("Sign in with Google") connections:
 * GOOGLE_ADS_OAUTH_CLIENT_ID/SECRET, falling back to the agency client.
 */
const oauthClient = () => ({
  clientId: String(process.env.GOOGLE_ADS_OAUTH_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID || '').trim(),
  clientSecret: String(process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || '').trim(),
});

/** Can workspaces connect their own Google Ads account with OAuth? */
const isOAuthConfigured = () => {
  const c = oauthClient();
  return !!(c.clientId && c.clientSecret && String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim());
};

// Access tokens live ~1h; cache one per refresh token (keyed by its hash so a
// plaintext refresh token never sits in a Map key / heap dump index).
const tokenCache = new Map();
const cacheKey = (refreshToken) => require('crypto').createHash('sha256').update(String(refreshToken)).digest('hex');

/**
 * Exchange a refresh token for an access token (cached). Without arguments,
 * uses the agency's env credentials.
 */
const accessToken = async (fetchImpl = fetch, creds = null) => {
  const c = creds && creds.refreshToken
    ? { ...oauthClient(), refreshToken: creds.refreshToken }
    : {
      clientId: process.env.GOOGLE_ADS_CLIENT_ID,
      clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    };
  const key = cacheKey(c.refreshToken);
  const hit = tokenCache.get(key);
  if (hit && Date.now() < hit.expiresAt - 60000) return hit.token;
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const err = new Error(`oauth: ${json.error || res.status} ${json.error_description || ''}`.trim());
    // invalid_grant = revoked / expired consent — retrying won't help.
    err.retryable = res.status >= 500;
    err.oauthError = json.error || '';
    throw err;
  }
  if (tokenCache.size > 1000) tokenCache.clear();
  tokenCache.set(key, { token: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 });
  return json.access_token;
};

const forgetAccessToken = (refreshToken) => tokenCache.delete(cacheKey(refreshToken));

/** Google reports per-conversion problems as a partial failure, not an HTTP error. */
const RETRYABLE_PARTIAL = /TOO_RECENT|CLICK_NOT_FOUND|too recent|INTERNAL_ERROR|DEADLINE/i;

/**
 * @param {Object} args
 * @param {string} args.customerId
 * @param {Object[]} args.conversions
 * @param {string} [args.refreshToken]     per-workspace OAuth refresh token (decrypted);
 *                                         omit to use the agency env credentials
 * @param {string} [args.loginCustomerId]  manager id for OAuth connections reached via an MCC
 */
const uploadClickConversions = async ({
  customerId,
  conversions,
  refreshToken = null,
  loginCustomerId = '',
  validateOnly = false,
  fetchImpl = fetch,
}) => {
  const workspaceCreds = !!refreshToken;
  if (workspaceCreds) {
    if (!isOAuthConfigured()) return { ok: false, retryable: false, error: 'google_not_configured: missing OAuth client / developer token' };
  } else {
    const missing = missingConfig();
    if (missing.length) return { ok: false, retryable: false, error: `google_not_configured: missing ${missing.join(', ')}` };
  }
  const cid = digits(customerId);
  if (cid.length !== 10) return { ok: false, retryable: false, error: 'google_customer_id_invalid' };

  let token;
  try {
    token = await accessToken(fetchImpl, workspaceCreds ? { refreshToken } : null);
  } catch (err) {
    return { ok: false, retryable: err.retryable !== false, error: err.message };
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  };
  const login = workspaceCreds ? digits(loginCustomerId) : digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  if (login) headers['login-customer-id'] = login;

  let res;
  let json = null;
  try {
    res = await fetchImpl(`https://googleads.googleapis.com/${API_VERSION()}/customers/${cid}:uploadClickConversions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conversions, partialFailure: true, validateOnly }),
      signal: AbortSignal.timeout(30000),
    });
    json = await res.json().catch(() => null);
  } catch (err) {
    return { ok: false, retryable: true, error: `network: ${err.message}` };
  }

  if (!res.ok) {
    const e = (json && (json.error || (Array.isArray(json) && json[0] && json[0].error))) || {};
    if (res.status === 401) forgetAccessToken(workspaceCreds ? refreshToken : process.env.GOOGLE_ADS_REFRESH_TOKEN);
    return {
      ok: false,
      retryable: res.status >= 500 || res.status === 429 || res.status === 401,
      error: e.message || `HTTP ${res.status}`,
      response: e.status ? { status: e.status } : null,
    };
  }
  if (json && json.partialFailureError && json.partialFailureError.message) {
    const msg = json.partialFailureError.message;
    return { ok: false, retryable: RETRYABLE_PARTIAL.test(msg), error: msg, response: { partialFailure: true } };
  }
  return { ok: true, response: { results: (json && json.results) || [] } };
};

module.exports = {
  uploadClickConversions,
  isConfigured,
  missingConfig,
  isOAuthConfigured,
  oauthClient,
  accessToken,
  forgetAccessToken,
  API_VERSION,
};
