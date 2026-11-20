/**
 * capture.test.js — the public website-snippet endpoints, exercised over real
 * HTTP against the real Express app (route order, CORS, body parsing, domain
 * lock, bot checks, rate limits). DB lookups and lead creation are stubbed.
 * Run: node --test src/routes/capture.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

require('../models');
const LeadConnection = require('../models/LeadConnection');
const ingestService = require('../services/leadIngestService');

// Stub lead creation BEFORE the controller is loaded (it destructures it).
const ingested = [];
ingestService.ingestForConnection = async (id, payload, meta) => {
  ingested.push({ id: String(id), payload, meta });
  return { status: 'created' };
};

const SITE = 'site_abcdef234567';
const connection = {
  _id: 'conn1',
  siteKey: SITE,
  sourceType: 'website_snippet',
  enabled: true,
  allowedDomains: ['bopayments.com'],
  snippet: { consentWording: 'I agree.', formSelector: '', accent: '#C1A6B0' },
};
LeadConnection.findOne = async (q) => (q.siteKey === SITE ? connection : null);
const updates = [];
LeadConnection.updateOne = async (filter, update) => {
  updates.push({ filter, update });
  return { modifiedCount: 1 };
};

// passport's Google strategy needs these at load time (same as the other route tests).
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-secret';
process.env.GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/auth/google/callback';
const app = require('../app');

let server;
let base;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const post = (body, headers = {}, site = SITE) =>
  fetch(`${base}/api/capture/${site}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const human = (extra = {}) => ({ name: 'Jane', email: 'jane@acme.com', _ll_hp: '', _ll_elapsed: '8000', ...extra });

test('GET /capture.js serves the script to any site', async () => {
  const r = await fetch(`${base}/capture.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(await r.text(), /LeadLoopCapture/);
});

test('config: allowed domain gets settings + exact CORS origin; others refused', async () => {
  const ok = await fetch(`${base}/api/capture/${SITE}/config`, { headers: { Origin: 'https://www.bopayments.com' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://www.bopayments.com');
  // No board on this stub → no workspace → no pixels (and no DB lookup).
  assert.deepEqual(await ok.json(), {
    formSelector: '',
    consentWording: 'I agree.',
    accent: '#C1A6B0',
    pixels: { meta: null, google: null, tiktok: null },
  });

  const bad = await fetch(`${base}/api/capture/${SITE}/config`, { headers: { Origin: 'https://evilbopayments.com' } });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);

  const unknown = await fetch(`${base}/api/capture/site_doesnotexist1/config`, { headers: { Origin: 'https://bopayments.com' } });
  assert.equal(unknown.status, 404);
});

test('submit from the allowed domain creates a lead with visitor IP/UA; control fields stripped', async () => {
  ingested.length = 0;
  const r = await post(human({ gclid: 'Cj0test' }), {
    Origin: 'https://bopayments.com',
    'User-Agent': 'Mozilla/5.0 (iPhone)',
    'X-Forwarded-For': '203.0.113.9, 10.0.0.1',
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://bopayments.com');
  assert.equal(ingested.length, 1);
  const { payload, meta } = ingested[0];
  assert.equal(payload.email, 'jane@acme.com');
  assert.equal(payload.gclid, 'Cj0test');
  assert.equal(payload.client_ip, '203.0.113.9');
  assert.equal(payload.client_user_agent, 'Mozilla/5.0 (iPhone)');
  assert.ok(!Object.keys(payload).some((k) => k.startsWith('_ll_')));
  assert.equal(meta.ip, '203.0.113.9');
});

test('submit from another domain is refused and nothing is created', async () => {
  ingested.length = 0;
  const r = await post(human(), { Origin: 'https://spam.example' });
  assert.equal(r.status, 403);
  assert.equal(ingested.length, 0);
});

test('bots: honeypot filled or submitted too fast → silent 204, no lead', async () => {
  ingested.length = 0;
  const hp = await post(human({ _ll_hp: 'http://spam' }), { Origin: 'https://bopayments.com', 'X-Forwarded-For': '198.51.100.1' });
  const fast = await post(human({ _ll_elapsed: '300' }), { Origin: 'https://bopayments.com', 'X-Forwarded-For': '198.51.100.2' });
  const missing = await post({ name: 'x', email: 'x@y.co' }, { Origin: 'https://bopayments.com', 'X-Forwarded-For': '198.51.100.3' });
  assert.deepEqual([hp.status, fast.status, missing.status], [204, 204, 204]);
  assert.equal(ingested.length, 0);
});

test('garbage body → 400', async () => {
  const r = await post('not json', { Origin: 'https://bopayments.com', 'X-Forwarded-For': '198.51.100.4' });
  assert.equal(r.status, 400);
});

test('per-visitor rate limit: 11th submission in a minute → 429', async () => {
  const headers = { Origin: 'https://bopayments.com', 'X-Forwarded-For': '192.0.2.77' };
  const statuses = [];
  for (let i = 0; i < 11; i += 1) statuses.push((await post(human(), headers)).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(204));
  assert.equal(statuses[10], 429);
});

// ─── install beacon ─────────────────────────────────────────────────────────
const postSeen = (body, headers = {}) =>
  fetch(`${base}/api/capture/${SITE}/seen`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('seen: allowed domain records lastSeenAt + path; never creates a lead', async () => {
  updates.length = 0;
  ingested.length = 0;
  connection.snippet.lastSeenAt = null;
  connection.snippet.pagesSeen = [];
  const r = await postSeen({ path: '/pricing?utm_source=x#top' }, { Origin: 'https://www.bopayments.com', 'X-Forwarded-For': '203.0.113.50' });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://www.bopayments.com');
  assert.equal(ingested.length, 0);
  assert.equal(updates.length, 2);
  assert.ok(updates[0].update.$set['snippet.lastSeenAt'] instanceof Date);
  assert.equal(updates[1].update.$push['snippet.pagesSeen'], '/pricing');
  assert.deepEqual(updates[1].filter['snippet.pagesSeen.49'], { $exists: false });
});

test('seen: known path seen a moment ago → no writes', async () => {
  updates.length = 0;
  connection.snippet.lastSeenAt = new Date();
  connection.snippet.pagesSeen = ['/pricing'];
  const r = await postSeen({ path: '/pricing' }, { Origin: 'https://bopayments.com', 'X-Forwarded-For': '203.0.113.51' });
  assert.equal(r.status, 204);
  assert.equal(updates.length, 0);
});

test('seen: other domain refused; bad body 400', async () => {
  updates.length = 0;
  const bad = await postSeen({ path: '/' }, { Origin: 'https://evil.example', 'X-Forwarded-For': '203.0.113.52' });
  assert.equal(bad.status, 403);
  const garbage = await postSeen('nope', { Origin: 'https://bopayments.com', 'X-Forwarded-For': '203.0.113.53' });
  assert.equal(garbage.status, 400);
  const abs = await postSeen({ path: 'https://evil/x' }, { Origin: 'https://bopayments.com', 'X-Forwarded-For': '203.0.113.54' });
  assert.equal(abs.status, 400);
  assert.equal(updates.length, 0);
});

test('seen: per-visitor rate limit (31st in a minute → 429)', async () => {
  const headers = { Origin: 'https://bopayments.com', 'X-Forwarded-For': '192.0.2.88' };
  const statuses = [];
  for (let i = 0; i < 31; i += 1) statuses.push((await postSeen({ path: '/' }, headers)).status);
  assert.ok(statuses.slice(0, 30).every((s) => s === 204));
  assert.equal(statuses[30], 429);
});

// ─── pure helpers ──────────────────────────────────────────────────────────
const { pixelsFromConfig, normalizeSeenPath } = require('../controllers/captureController');

test('pixelsFromConfig: only enabled platforms with well-formed ids', () => {
  assert.deepEqual(pixelsFromConfig(null), { meta: null, google: null, tiktok: null });
  assert.deepEqual(
    pixelsFromConfig({
      meta: { enabled: true, datasetId: '1234567890123' },
      google: { enabled: true, connection: { conversionTrackingId: 'AW-123456789' } },
      tiktok: { enabled: true, pixelCode: 'cabcdefghij1234567' },
    }),
    { meta: '1234567890123', google: 'AW-123456789', tiktok: 'CABCDEFGHIJ1234567' }
  );
  // disabled, missing (Worker A fields absent), or injection-shaped ids → null
  assert.deepEqual(
    pixelsFromConfig({
      meta: { enabled: false, datasetId: '1234567890123' },
      google: { enabled: true },
      tiktok: { enabled: true, pixelCode: "X');alert(1);//" },
    }),
    { meta: null, google: null, tiktok: null }
  );
  assert.equal(pixelsFromConfig({ meta: { enabled: true, datasetId: "1'+alert(1)+'" } }).meta, null);
});

test('normalizeSeenPath', () => {
  assert.equal(normalizeSeenPath('/'), '/');
  assert.equal(normalizeSeenPath('/a/b/?x=1'), '/a/b');
  assert.equal(normalizeSeenPath('/caf%C3%A9'), '/caf%C3%A9');
  for (const bad of ['', 'a', '//evil.com/x', 'https://x/', '/<script>', '/a b', null, 42]) {
    assert.equal(normalizeSeenPath(bad), '', String(bad));
  }
  assert.equal(normalizeSeenPath(`/${'a'.repeat(300)}`).length, 200);
});
