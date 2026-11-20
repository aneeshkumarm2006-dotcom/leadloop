/**
 * siteCheck.test.js — SSRF guard + HTML detection. No real network.
 * Run: node --test src/services/siteCheck.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const sc = require('./siteCheck');

test('isBlockedIp: private, loopback, link-local, metadata, mapped and reserved are blocked', () => {
  const blocked = [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1',
    '2001:db8::1', 'ff02::1', 'fe80::1%en0', 'not-an-ip', '',
  ];
  for (const ip of blocked) assert.equal(sc.isBlockedIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '151.101.1.69', '2606:4700:4700::1111', '::ffff:8.8.8.8', '172.32.0.1']) {
    assert.equal(sc.isBlockedIp(ip), false, ip);
  }
});

test('assertFetchableUrl: only http(s) on 80/443, no credentials, no internal hosts', () => {
  assert.equal(sc.assertFetchableUrl('https://example.com/').hostname, 'example.com');
  assert.equal(sc.assertFetchableUrl('http://example.com:80/x').pathname, '/x');
  const bad = [
    'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'gopher://x', 'https://user:pw@example.com/',
    'https://example.com:8080/', 'http://127.0.0.1/', 'http://0x7f.1/', 'http://2130706433/', 'http://[::1]/',
    'http://[::ffff:169.254.169.254]/', 'http://169.254.169.254/latest/meta-data', 'http://localhost/', 'http://foo.internal/',
    'not a url',
  ];
  for (const u of bad) assert.throws(() => sc.assertFetchableUrl(u), sc.SiteCheckError, u);
});

const fakeResolver = (map) => (host, opts, cb) => {
  const addrs = map[host];
  if (!addrs) return cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
  return cb(null, addrs.map((a) => ({ address: a, family: a.includes(':') ? 6 : 4 })));
};

test('safe lookup: refuses if ANY resolved address is internal; returns vetted address otherwise', async () => {
  const lookup = sc.makeSafeLookup(
    fakeResolver({ 'ok.test': ['93.184.215.14'], 'rebind.test': ['93.184.215.14', '10.0.0.5'], 'meta.test': ['169.254.169.254'] })
  );
  const call = (host, opts) => new Promise((resolve) => lookup(host, opts, (err, a, f) => resolve({ err, a, f })));
  const ok = await call('ok.test', {});
  assert.equal(ok.err, null);
  assert.equal(ok.a, '93.184.215.14');
  assert.equal(ok.f, 4);
  const all = await call('ok.test', { all: true });
  assert.deepEqual(all.a, [{ address: '93.184.215.14', family: 4 }]);
  assert.equal((await call('rebind.test', {})).err.code, 'blocked');
  assert.equal((await call('meta.test', {})).err.code, 'blocked');
  assert.equal((await call('nx.test', {})).err.code, 'ENOTFOUND');
});

test('safeFetchHtml: the real socket path refuses a host that resolves to loopback', async () => {
  await assert.rejects(
    sc.safeFetchHtml('http://evil.test/', { resolver: fakeResolver({ 'evil.test': ['127.0.0.1'] }) }),
    (err) => err instanceof sc.SiteCheckError && err.code === 'blocked'
  );
});

test('safeFetchHtml: redirects are followed (max 3) and every hop is re-validated', async () => {
  const fake = (routes) => {
    const seen = [];
    const request = async (u) => {
      seen.push(u.toString());
      const r = routes[u.toString()];
      if (!r) throw new Error(`unexpected ${u}`);
      return r;
    };
    return { request, seen };
  };

  const ok = fake({
    'http://site.test/': { status: 301, location: 'https://site.test/', body: '' },
    'https://site.test/': { status: 302, location: '/home', body: '' },
    'https://site.test/home': { status: 200, location: '', body: '<html>hi</html>' },
  });
  const r = await sc.safeFetchHtml('http://site.test/', { request: ok.request });
  assert.equal(r.url, 'https://site.test/home');
  assert.equal(r.html, '<html>hi</html>');

  const toMetadata = fake({ 'https://site.test/': { status: 302, location: 'http://169.254.169.254/latest/', body: '' } });
  await assert.rejects(sc.safeFetchHtml('https://site.test/', { request: toMetadata.request }), (e) => e.code === 'blocked');
  assert.deepEqual(toMetadata.seen, ['https://site.test/']);

  const toFile = fake({ 'https://site.test/': { status: 302, location: 'file:///etc/passwd', body: '' } });
  await assert.rejects(sc.safeFetchHtml('https://site.test/', { request: toFile.request }), (e) => e.code === 'bad_url');

  const toPort = fake({ 'https://site.test/': { status: 302, location: 'http://site.test:6379/', body: '' } });
  await assert.rejects(sc.safeFetchHtml('https://site.test/', { request: toPort.request }), (e) => e.code === 'bad_url');

  const loop = fake({
    'https://a.test/': { status: 302, location: 'https://a.test/1', body: '' },
    'https://a.test/1': { status: 302, location: 'https://a.test/2', body: '' },
    'https://a.test/2': { status: 302, location: 'https://a.test/3', body: '' },
    'https://a.test/3': { status: 302, location: 'https://a.test/4', body: '' },
  });
  await assert.rejects(sc.safeFetchHtml('https://a.test/', { request: loop.request }), (e) => e.code === 'too_many_redirects');
  assert.equal(loop.seen.length, 4); // the start + 3 redirects
});

// ─── analyzeHtml ──────────────────────────────────────────────────────────────
const KEY = 'site_abcdef234567';
const byId = (checks) => Object.fromEntries(checks.map((c) => [c.id, c]));
const NOW = Date.UTC(2026, 10, 18);

test('analyzeHtml: our tag + connected pixels + forms + CMP → all ok', () => {
  const html = `<html><head><script src="https://api.leadloop.test/capture.js" data-site="${KEY}" defer></script>
    <script src="https://consent.cookiebot.com/uc.js"></script></head><body><form id=a></form><FORM class="b"></FORM></body></html>`;
  const c = byId(sc.analyzeHtml({ html, siteKey: KEY, pixels: { meta: '1234567890', google: 'AW-123456789', tiktok: null }, now: NOW }));
  assert.equal(c.tag.status, 'ok');
  assert.equal(c.meta_pixel.status, 'ok');
  assert.match(c.meta_pixel.detail, /Loaded by the LeadLoop tag/);
  assert.equal(c.google_tag.status, 'ok');
  assert.equal(c.tiktok_pixel.status, 'skip');
  assert.equal(c.forms.status, 'ok');
  assert.match(c.forms.detail, /^2 forms/);
  assert.equal(c.consent.status, 'ok');
  assert.match(c.consent.detail, /Cookiebot/);
  assert.deepEqual(Object.keys(c), ['tag', 'meta_pixel', 'google_tag', 'tiktok_pixel', 'forms', 'consent']);
});

test('analyzeHtml: tag via recent beacon (GTM install) counts; stale beacon does not', () => {
  const html = '<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC"></script>';
  const fresh = byId(sc.analyzeHtml({ html, siteKey: KEY, pixels: {}, lastSeenAt: new Date(NOW - 3600e3), now: NOW }));
  assert.equal(fresh.tag.status, 'ok');
  assert.match(fresh.tag.detail, /Google Tag Manager/);
  const stale = byId(sc.analyzeHtml({ html, siteKey: KEY, pixels: {}, lastSeenAt: new Date(NOW - 25 * 3600e3), now: NOW }));
  assert.equal(stale.tag.status, 'missing');
  assert.match(stale.tag.detail, /Publish the container/);
});

test('analyzeHtml: without our tag, pixels are ok only if the page has that exact id', () => {
  const html = `<script>fbq('init', '1234567890');</script><script>gtag('config','AW-999999999')</script>
    <script>ttq.load('CABCDEFGHIJ1234567')</script>`;
  const c = byId(sc.analyzeHtml({ html, siteKey: KEY, pixels: { meta: '1234567890', google: 'AW-123456789', tiktok: 'CXYZXYZXYZ12345678' }, now: NOW }));
  assert.equal(c.tag.status, 'missing');
  assert.equal(c.meta_pixel.status, 'ok');
  assert.equal(c.google_tag.status, 'warn'); // a different AW id
  assert.equal(c.tiktok_pixel.status, 'warn');
  assert.equal(c.consent.status, 'warn');
  assert.equal(c.forms.status, 'warn');
});

test('analyzeHtml: AW id prefix does not match a longer id', () => {
  const html = "gtag('config','AW-1234567890')";
  const c = byId(sc.analyzeHtml({ html, siteKey: KEY, pixels: { google: 'AW-123456789' }, now: NOW }));
  assert.equal(c.google_tag.status, 'warn');
});

test('analyzeHtml: loadPixels off → our tag alone does not satisfy pixels', () => {
  const html = `<script src="/capture.js" data-site="${KEY}"></script>`;
  const c = byId(sc.analyzeHtml({ html, siteKey: KEY, pixels: { meta: '1234567890' }, loadPixels: false, now: NOW }));
  assert.equal(c.tag.status, 'ok');
  assert.equal(c.meta_pixel.status, 'missing');
  assert.match(c.meta_pixel.detail, /turned off/);
});

test('analyzeHtml: failed fetch → tag missing (no beacon), others warn, reason surfaced', () => {
  const c = byId(sc.analyzeHtml({ html: null, fetchError: 'Your website took too long to respond', siteKey: KEY, pixels: { meta: '1234567890' }, now: NOW }));
  assert.equal(c.tag.status, 'missing');
  assert.match(c.tag.detail, /too long/);
  assert.equal(c.meta_pixel.status, 'warn');
  assert.equal(c.forms.status, 'warn');
  assert.equal(c.consent.status, 'warn');
});

test('hasOurTag: other site keys do not match', () => {
  assert.equal(sc.hasOurTag('<script src="/capture.js" data-site="site_zzzzzzzz9999"></script>', KEY), false);
  assert.equal(sc.hasOurTag(`<script data-site='${KEY}' src="https://x/capture.js"></script>`, KEY), true);
});
