/**
 * siteCheck.js — "Check my website": fetch a client's homepage server-side and
 * report whether the LeadLoop tag, ad pixels, lead forms and a consent banner
 * are present.
 *
 * ─── SSRF model ─────────────────────────────────────────────────────────────
 * The URL is admin-supplied, so the fetch is locked down:
 *   - http(s) only, ports 80/443 only, no userinfo (`user:pass@`);
 *   - the FIRST URL's host must be one of the connection's allowedDomains
 *     (checked by the caller, see adConnectWebsiteController);
 *   - every hostname is resolved and EVERY resolved address must be public —
 *     loopback, private, link-local (incl. 169.254.169.254 metadata), CGNAT,
 *     multicast, reserved, documentation, and v4-mapped/NAT64/6to4 forms of
 *     those are refused. The check runs inside the socket's `lookup` hook, so
 *     the address we validated is the address we connect to (no DNS-rebinding
 *     gap between check and connect);
 *   - redirects are followed manually (max 3) and each hop is re-validated;
 *   - 8 s overall deadline, 2 MB body cap, no cookies / credentials sent.
 * The fetched HTML is only pattern-matched; nothing from it is executed or
 * returned to the client verbatim.
 */

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const zlib = require('zlib');

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8000;
const MAX_BYTES = 2 * 1024 * 1024;
const BEACON_FRESH_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = 'Mozilla/5.0 (compatible; LeadLoopSiteCheck/1.0)';

// ─── IP guard (pure) ──────────────────────────────────────────────────────────

const blocked = new net.BlockList();
[
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local + cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
].forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv4'));
[
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::', 96], // IPv4-compatible (deprecated)
  ['64:ff9b::', 96], // NAT64 (embeds an IPv4)
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID, …)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds an IPv4)
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
].forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv6'));

/** IPv4-mapped IPv6 (`::ffff:1.2.3.4`, any spelling) → '1.2.3.4', else ''. */
const mappedV4 = (ip) => {
  let canon;
  try {
    canon = new URL(`http://[${ip}]/`).hostname.slice(1, -1); // WHATWG canonical form
  } catch {
    return '';
  }
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canon);
  if (!hex) return '';
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
};

/**
 * Is this an address we must never connect to? Fails CLOSED: anything that
 * isn't a parseable IP counts as blocked.
 */
const isBlockedIp = (ip) => {
  const raw = String(ip || '').replace(/^\[|\]$/g, '').split('%')[0];
  const family = net.isIP(raw);
  if (family === 4) return blocked.check(raw, 'ipv4');
  if (family === 6) {
    const v4 = mappedV4(raw);
    if (v4) return blocked.check(v4, 'ipv4');
    return blocked.check(raw, 'ipv6');
  }
  return true;
};

class SiteCheckError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Pure: validate a URL for fetching. Returns a URL object or throws
 * SiteCheckError('bad_url'|'blocked'). (DNS is checked later, at connect.)
 */
const assertFetchableUrl = (input) => {
  let u;
  try {
    u = input instanceof URL ? input : new URL(String(input));
  } catch {
    throw new SiteCheckError('bad_url', 'That is not a valid web address');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new SiteCheckError('bad_url', 'Only http and https addresses can be checked');
  if (u.username || u.password) throw new SiteCheckError('bad_url', 'Addresses with a username or password cannot be checked');
  if (u.port && !['80', '443'].includes(u.port)) throw new SiteCheckError('bad_url', 'Only standard web ports can be checked');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new SiteCheckError('bad_url', 'That is not a valid web address');
  if (net.isIP(host) && isBlockedIp(host)) throw new SiteCheckError('blocked', 'That address is not reachable from the internet');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa)$/i.test(host)) {
    throw new SiteCheckError('blocked', 'That address is not reachable from the internet');
  }
  return u;
};

/**
 * `lookup` hook for http(s).request: resolve, refuse if ANY address is
 * blocked, hand the socket only vetted addresses. Supports `options.all`
 * (used by Node's happy-eyeballs autoSelectFamily).
 */
const makeSafeLookup = (resolver = dns.lookup) => (hostname, options, callback) => {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'object' && options ? options : {};
  resolver(hostname, { all: true, family: opts.family || 0 }, (err, addresses) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }];
    if (list.length === 0 || list.some((a) => isBlockedIp(a.address))) {
      return cb(new SiteCheckError('blocked', 'That address is not reachable from the internet'));
    }
    if (opts.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
};

const decoderFor = (encoding) => {
  const e = String(encoding || '').toLowerCase().trim();
  if (e === 'gzip' || e === 'x-gzip') return zlib.createGunzip();
  if (e === 'deflate') return zlib.createInflate();
  if (e === 'br') return zlib.createBrotliDecompress();
  return null;
};

/** One GET, no redirect following. Resolves { status, location, body }. */
const requestOnce = (u, { deadline, lookup }) =>
  new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new SiteCheckError('timeout', 'Your website took too long to respond'));
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      {
        method: 'GET',
        lookup,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        timeout: remaining,
        agent: false, // fresh socket each hop → the lookup hook always runs
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          clearTimeout(timer);
          res.resume();
          return resolve({ status, location: String(res.headers.location), body: '' });
        }
        let stream = res;
        const dec = decoderFor(res.headers['content-encoding']);
        if (dec) {
          stream = res.pipe(dec);
          dec.on('error', () => finish());
        }
        const chunks = [];
        let size = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ status, location: '', body: Buffer.concat(chunks).toString('utf8') });
        };
        stream.on('data', (chunk) => {
          if (done) return;
          const room = MAX_BYTES - size;
          chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
          size += Math.min(chunk.length, room);
          if (size >= MAX_BYTES) {
            finish();
            req.destroy();
          }
        });
        stream.on('end', finish);
        stream.on('error', finish);
        res.on('aborted', finish);
      }
    );
    const timer = setTimeout(() => {
      req.destroy(new SiteCheckError('timeout', 'Your website took too long to respond'));
    }, remaining);
    req.on('timeout', () => req.destroy(new SiteCheckError('timeout', 'Your website took too long to respond')));
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err instanceof SiteCheckError ? err : new SiteCheckError('unreachable', "We couldn't reach your website"));
    });
    req.end();
  });

/**
 * Fetch a page with the SSRF guard. Resolves { url, status, html } where `url`
 * is the final URL after redirects. Throws SiteCheckError on any refusal.
 */
const safeFetchHtml = async (startUrl, { resolver, timeoutMs = TIMEOUT_MS, request = requestOnce } = {}) => {
  const deadline = Date.now() + timeoutMs;
  const lookup = makeSafeLookup(resolver);
  let u = assertFetchableUrl(startUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // `request` is injectable for tests only; every URL still passes
    // assertFetchableUrl and the real one connects through `lookup`.
    // eslint-disable-next-line no-await-in-loop
    const r = await request(u, { deadline, lookup });
    if (!r.location) return { url: u.toString(), status: r.status, html: r.body };
    if (hop === MAX_REDIRECTS) throw new SiteCheckError('too_many_redirects', 'Your website redirected too many times');
    u = assertFetchableUrl(new URL(r.location, u));
  }
  throw new SiteCheckError('too_many_redirects', 'Your website redirected too many times');
};

// ─── HTML detection (pure) ───────────────────────────────────────────────────

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CMP_SIGNATURES = [
  ['Cookiebot', /cookiebot/i],
  ['OneTrust', /onetrust|optanon|cookielaw\.org/i],
  ['CookieYes', /cookieyes|cookie-law-info/i],
  ['Termly', /termly/i],
  ['iubenda', /iubenda/i],
  ['Complianz', /complianz|cmplz/i],
  ['Osano', /osano/i],
  ['Usercentrics', /usercentrics/i],
  ['Quantcast Choice', /quantcast/i],
];

/** Does the HTML include our snippet for this site key? */
const hasOurTag = (html, siteKey) => {
  if (!html || !siteKey) return false;
  const key = escapeRe(siteKey);
  if (new RegExp(`/capture\\.js[^>]*data-site\\s*=\\s*["']?${key}`, 'i').test(html)) return true;
  if (new RegExp(`data-site\\s*=\\s*["']?${key}["'\\s>][^>]*/capture\\.js`, 'i').test(html)) return true;
  return html.includes(siteKey);
};

const pagePixel = {
  meta: (html, id) =>
    !!id && (new RegExp(`fbq\\(\\s*['"]init['"]\\s*,\\s*['"]?${escapeRe(id)}`).test(html) || new RegExp(`facebook\\.com/tr\\?id=${escapeRe(id)}`).test(html)),
  google: (html, id) => !!id && new RegExp(`${escapeRe(id)}(?![0-9])`).test(html),
  tiktok: (html, id) => !!id && new RegExp(`${escapeRe(id)}`, 'i').test(html),
};

const otherPixel = {
  meta: (html) => /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*['"]init/i.test(html),
  google: (html) => /googletagmanager\.com\/gtag\/js\?id=AW-|['"]AW-\d+/i.test(html),
  tiktok: (html) => /analytics\.tiktok\.com|ttq\.load\(/i.test(html),
};

const PIXEL_META = {
  meta: { id: 'meta_pixel', name: 'Meta Pixel' },
  google: { id: 'google_tag', name: 'Google tag' },
  tiktok: { id: 'tiktok_pixel', name: 'TikTok Pixel' },
};

/**
 * Pure: turn a fetched page (or a failed fetch) into the check list.
 *
 * @param {object} p
 * @param {string|null} p.html          page HTML, or null when the fetch failed
 * @param {string} [p.fetchError]       user-safe reason when html is null
 * @param {string} p.siteKey
 * @param {{meta,google,tiktok}} p.pixels  ids the workspace has connected (null = not connected)
 * @param {boolean} [p.loadPixels=true] the tag loads connected pixels
 * @param {Date|null} [p.lastSeenAt]    last beacon
 * @param {number} [p.now]
 */
const analyzeHtml = ({ html, fetchError = '', siteKey, pixels = {}, loadPixels = true, lastSeenAt = null, now = Date.now() }) => {
  const checks = [];
  const fetched = typeof html === 'string';
  const page = fetched ? html : '';
  const seenAt = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
  const beaconFresh = seenAt > 0 && now - seenAt < BEACON_FRESH_MS;
  const inHtml = fetched && hasOurTag(page, siteKey);
  const tagOk = inHtml || beaconFresh;
  const viaGtm = fetched && /googletagmanager\.com\/gtm\.js/i.test(page);

  if (inHtml) {
    checks.push({ id: 'tag', status: 'ok', title: 'LeadLoop tag installed', detail: 'Found on your homepage.' });
  } else if (beaconFresh) {
    checks.push({
      id: 'tag',
      status: 'ok',
      title: 'LeadLoop tag installed',
      detail: viaGtm
        ? 'Running through Google Tag Manager — seen on your site in the last 24 hours.'
        : 'Seen on your site in the last 24 hours.',
    });
  } else {
    checks.push({
      id: 'tag',
      status: 'missing',
      title: 'LeadLoop tag not found',
      detail: fetched
        ? viaGtm
          ? 'Your homepage uses Google Tag Manager but the LeadLoop tag has not run yet. Publish the container, then visit your site once.'
          : 'Add the tag to your site header, publish, then visit your site once.'
        : `${fetchError || "We couldn't load your homepage"}, and the tag hasn't reported in yet.`,
    });
  }

  for (const platform of ['meta', 'google', 'tiktok']) {
    const { id, name } = PIXEL_META[platform];
    const pixelId = pixels[platform] || null;
    if (!pixelId) {
      checks.push({ id, status: 'skip', title: name, detail: 'Not connected — nothing to load.' });
    } else if (tagOk && loadPixels) {
      checks.push({ id, status: 'ok', title: name, detail: `Loaded by the LeadLoop tag (${pixelId}).` });
    } else if (fetched && pagePixel[platform](page, pixelId)) {
      checks.push({ id, status: 'ok', title: name, detail: `Already on your page (${pixelId}).` });
    } else if (fetched && otherPixel[platform](page)) {
      checks.push({ id, status: 'warn', title: name, detail: `Your page has a ${name}, but not the connected one (${pixelId}).` });
    } else if (!fetched) {
      checks.push({ id, status: 'warn', title: name, detail: "Couldn't confirm — your homepage didn't load." });
    } else {
      checks.push({
        id,
        status: 'missing',
        title: name,
        detail: loadPixels ? 'Install the LeadLoop tag and it loads automatically.' : 'Pixel loading is turned off for this site.',
      });
    }
  }

  if (!fetched) {
    checks.push({ id: 'forms', status: 'warn', title: 'Lead forms', detail: "Couldn't check — your homepage didn't load." });
  } else {
    const forms = (page.match(/<form[\s>]/gi) || []).length;
    checks.push(
      forms > 0
        ? { id: 'forms', status: 'ok', title: 'Lead forms', detail: `${forms} form${forms === 1 ? '' : 's'} on your homepage.` }
        : {
            id: 'forms',
            status: 'warn',
            title: 'Lead forms',
            detail: 'No form in the homepage HTML. Forms on other pages, or drawn by JavaScript, are still captured.',
          }
    );
  }

  const cmp = fetched ? CMP_SIGNATURES.find(([, re]) => re.test(page)) : null;
  checks.push(
    cmp
      ? { id: 'consent', status: 'ok', title: 'Cookie consent', detail: `${cmp[0]} detected.` }
      : {
          id: 'consent',
          status: 'warn',
          title: 'Cookie consent',
          detail: fetched
            ? 'No consent banner detected. If you have visitors from the EU/UK, add one before loading ad pixels.'
            : "Couldn't check — your homepage didn't load.",
        }
  );

  return checks;
};

module.exports = {
  isBlockedIp,
  assertFetchableUrl,
  makeSafeLookup,
  safeFetchHtml,
  analyzeHtml,
  hasOurTag,
  SiteCheckError,
  MAX_REDIRECTS,
  TIMEOUT_MS,
  MAX_BYTES,
  BEACON_FRESH_MS,
};
