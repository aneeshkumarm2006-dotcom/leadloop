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
 * Result shape matches metaCapi.sendEvents: { ok, retryable, error, response }.
 */

const API_VERSION = () => process.env.GOOGLE_ADS_API_VERSION || 'v21';
const digits = (s) => String(s || '').replace(/\D/g, '');

const missingConfig = () =>
  ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'].filter(
    (k) => !String(process.env[k] || '').trim()
  );

const isConfigured = () => missingConfig().length === 0;

// Access tokens live ~1h; cache one per process.
let cached = { token: null, expiresAt: 0 };

const accessToken = async (fetchImpl) => {
  if (cached.token && Date.now() < cached.expiresAt - 60000) return cached.token;
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const err = new Error(`oauth: ${json.error || res.status} ${json.error_description || ''}`.trim());
    err.retryable = res.status >= 500;
    throw err;
  }
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 };
  return cached.token;
};

/** Google reports per-conversion problems as a partial failure, not an HTTP error. */
const RETRYABLE_PARTIAL = /TOO_RECENT|CLICK_NOT_FOUND|too recent|INTERNAL_ERROR|DEADLINE/i;

const uploadClickConversions = async ({ customerId, conversions, validateOnly = false, fetchImpl = fetch }) => {
  const missing = missingConfig();
  if (missing.length) return { ok: false, retryable: false, error: `google_not_configured: missing ${missing.join(', ')}` };
  const cid = digits(customerId);
  if (cid.length !== 10) return { ok: false, retryable: false, error: 'google_customer_id_invalid' };

  let token;
  try {
    token = await accessToken(fetchImpl);
  } catch (err) {
    return { ok: false, retryable: err.retryable !== false, error: err.message };
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  };
  const login = digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
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
    if (res.status === 401) cached = { token: null, expiresAt: 0 };
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

module.exports = { uploadClickConversions, isConfigured, missingConfig, API_VERSION };
