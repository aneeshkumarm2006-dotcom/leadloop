/**
 * siteDomains.js — the domain lock for website-snippet lead capture.
 *
 * A snippet connection lists the domains its form lives on (`bopayments.com`).
 * The public capture endpoints accept a request only when its Origin (or, when
 * a browser omits Origin, its Referer) is one of those domains or a subdomain
 * of one. That is what makes the public site key safe to expose: copied onto
 * another site, it does nothing.
 *
 * PURE — no I/O.
 */

const MAX_DOMAINS = 10;

/**
 * `https://www.BoPayments.com/contact?x=1` → `bopayments.com`. Accepts bare
 * hosts too. Returns '' for anything that isn't a plausible public hostname
 * (IPs, localhost and single-label hosts are rejected — a lead form on a
 * production site always has a real domain).
 */
const normalizeDomain = (input) => {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  let host;
  try {
    host = new URL(s).hostname;
  } catch {
    return '';
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return '';
  return host;
};

/** De-duplicated, validated list from a comma/space/newline separated string or array. */
const parseDomainList = (value) => {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
  const out = [];
  for (const item of raw) {
    const d = normalizeDomain(item);
    if (d && !out.includes(d)) out.push(d);
    if (out.length >= MAX_DOMAINS) break;
  }
  return out;
};

/** Hostname of an Origin / Referer header value, or ''. */
const hostOf = (headerValue) => {
  const v = String(headerValue || '').trim();
  if (!v || v === 'null') return '';
  try {
    return new URL(v).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
};

/**
 * Is `host` one of `allowed` or a subdomain of one? `www.` is treated as the
 * bare domain. A look-alike such as `evilbopayments.com` does NOT match
 * `bopayments.com` — only an exact match or a `.bopayments.com` suffix does.
 */
const hostAllowed = (host, allowed) => {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!h) return false;
  return (allowed || []).some((d) => h === d || h.endsWith(`.${d}`));
};

/**
 * Resolve the calling site from request headers. Origin is what browsers send
 * on cross-site POSTs/fetches; Referer is a fallback for the rare request
 * without one. Returns { host, allowed, origin } — `origin` is the exact value
 * to echo in Access-Control-Allow-Origin when allowed.
 */
const checkRequestSite = (originHeader, refererHeader, allowed) => {
  const fromOrigin = hostOf(originHeader);
  const host = fromOrigin || hostOf(refererHeader);
  const ok = hostAllowed(host, allowed);
  let origin = '';
  if (ok) {
    try {
      origin = fromOrigin ? new URL(originHeader).origin : new URL(refererHeader).origin;
    } catch {
      origin = '';
    }
  }
  return { host, allowed: ok, origin };
};

module.exports = { normalizeDomain, parseDomainList, hostOf, hostAllowed, checkRequestSite, MAX_DOMAINS };
