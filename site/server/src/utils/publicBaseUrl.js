/**
 * publicBaseUrl.js — the public origin of THIS server.
 *
 * Used for URLs we hand to a customer to paste somewhere else: the F14 lead
 * ingest endpoint (Facebook / Zapier / their website form) and the F7 inbound
 * webhook URL. Those must be reachable from the public internet, so
 * `http://localhost:5000` is never a usable answer off a developer's machine —
 * a deployed server that hands one out produces a webhook that silently never
 * fires.
 *
 * Resolution order:
 *   1. WEBHOOK_PUBLIC_BASE_URL — the canonical answer; set it on every deployed
 *      environment (it is also what OAuth callbacks and unsubscribe links use,
 *      and those cannot be derived per-request).
 *   2. The origin the request actually arrived on, read from the proxy headers
 *      a platform host (Render, Railway, Fly, Heroku) sets. This is a safety
 *      net for a deploy that forgot step 1, not a replacement for it.
 *   3. localhost:PORT — for callers with no request at all (jobs, scripts).
 *
 * On (2) we read `x-forwarded-*` directly rather than relying on `req.protocol`
 * because the app does not set `trust proxy` (that would also change `req.ip`,
 * which the rate limiters key on). These headers are caller-controllable when a
 * request reaches the server without a proxy in front, so the worst case is an
 * admin seeing a wrong origin echoed back in their own dashboard — no secret is
 * sent to it, and setting the env var takes priority regardless.
 */

const stripTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

/** First entry of a possibly comma-joined proxy header value. */
const firstHop = (value) => String(value || '').split(',')[0].trim();

/** Origin the request arrived on, or '' when there is no usable request. */
const originFromRequest = (req) => {
  if (!req || typeof req.get !== 'function') return '';
  const host = firstHop(req.get('x-forwarded-host')) || firstHop(req.get('host'));
  if (!host) return '';
  const proto = firstHop(req.get('x-forwarded-proto')) || req.protocol || 'http';
  return `${proto}://${host}`;
};

/**
 * @param {import('express').Request} [req] omit for non-HTTP callers
 * @returns {string} origin with no trailing slash, e.g. `https://api.example.com`
 */
const publicBaseUrl = (req) =>
  stripTrailingSlash(process.env.WEBHOOK_PUBLIC_BASE_URL) ||
  stripTrailingSlash(originFromRequest(req)) ||
  `http://localhost:${process.env.PORT || 5000}`;

module.exports = { publicBaseUrl };
