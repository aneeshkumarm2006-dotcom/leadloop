/**
 * rest.js — tiny authed JSON fetch helpers for the provider adapters (F8.3).
 *
 * Gmail + Microsoft Graph are reached over their REST APIs with the user's
 * OAuth bearer token (built-in `fetch`, Node 18+) instead of pulling the heavy
 * `googleapis` / `@microsoft/microsoft-graph-client` SDKs — mirroring F7's
 * "standalone helper over a big dep" choice. A non-2xx response throws an Error
 * carrying the status + provider body so callers can mark the account `error`.
 */

const REQUEST_TIMEOUT_MS = 15_000;

class ProviderHttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.body = body;
  }
}

const withTimeout = async (url, options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const parseBody = async (res) => {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const request = async (method, url, accessToken, { body, headers } = {}) => {
  const res = await withTimeout(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
    },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const parsed = await parseBody(res);
  if (!res.ok) {
    const detail =
      (parsed && parsed.error && (parsed.error.message || parsed.error)) ||
      (typeof parsed === 'string' ? parsed.slice(0, 300) : 'request failed');
    throw new ProviderHttpError(`${method} ${url} → ${res.status}: ${detail}`, res.status, parsed);
  }
  return parsed;
};

const getJson = (url, accessToken, opts) => request('GET', url, accessToken, opts);
const postJson = (url, accessToken, body, opts) => request('POST', url, accessToken, { ...opts, body });

module.exports = { getJson, postJson, request, ProviderHttpError };
