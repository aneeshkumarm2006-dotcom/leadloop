/**
 * adConnectHttp.js — the one JSON-over-HTTPS helper the ad-platform clients
 * (metaGraph, googleAdsApi, googleTagManager, tiktokApi) share.
 *
 * - Only calls fixed, hard-coded platform hosts (callers build URLs from
 *   constants + encoded ids; nothing user-supplied becomes a host).
 * - 20s timeout, JSON in / JSON out.
 * - Throws `PlatformError { status, code, platformMessage }` on HTTP errors.
 *   Its `message` is safe for server logs (no tokens: tokens travel in headers
 *   or bodies, never in the error). Controllers map it to a generic client
 *   message.
 */

class PlatformError extends Error {
  constructor(message, { status = 502, code = 'platform_error', platformMessage = '', details = null } = {}) {
    super(message);
    this.name = 'PlatformError';
    this.status = status;
    this.code = code;
    this.platformMessage = platformMessage;
    this.details = details;
  }
}

const ALLOWED_HOSTS = new Set([
  'graph.facebook.com',
  'oauth2.googleapis.com',
  'www.googleapis.com',
  'openidconnect.googleapis.com',
  'googleads.googleapis.com',
  'tagmanager.googleapis.com',
  'business-api.tiktok.com',
]);

/**
 * @param {string} url
 * @param {Object} [opts]
 * @param {string} [opts.method='GET']
 * @param {Object} [opts.headers]
 * @param {Object|URLSearchParams} [opts.body]   object → JSON; URLSearchParams → form
 * @param {Function} [opts.fetchImpl]
 * @param {string} [opts.label]                  for log/error text, e.g. 'meta'
 * @returns {Promise<{ status: number, json: any }>}  only for 2xx
 */
const requestJson = async (url, { method = 'GET', headers = {}, body, fetchImpl = fetch, label = 'platform', timeoutMs = 20000 } = {}) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new PlatformError(`${label}: refusing to call ${u.hostname}`, { status: 500, code: 'host_not_allowed' });
  }
  const init = { method, headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) };
  if (body instanceof URLSearchParams) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = body.toString();
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    throw new PlatformError(`${label}: network error (${err.message})`, { status: 502, code: 'network' });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (json && (json.error || (Array.isArray(json) && json[0] && json[0].error))) || {};
    const platformMessage = typeof e === 'string' ? e : e.message || (json && (json.error_description || json.message)) || '';
    throw new PlatformError(`${label}: HTTP ${res.status}${platformMessage ? ` ${String(platformMessage).slice(0, 300)}` : ''}`, {
      status: res.status,
      code: res.status === 401 || res.status === 403 ? 'platform_auth' : 'platform_error',
      platformMessage: String(platformMessage).slice(0, 300),
      details: e && typeof e === 'object' ? { code: e.code, status: e.status, subcode: e.error_subcode } : null,
    });
  }
  return { status: res.status, json };
};

module.exports = { requestJson, PlatformError, ALLOWED_HOSTS };
