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
  assert.deepEqual(await ok.json(), { formSelector: '', consentWording: 'I agree.', accent: '#C1A6B0' });

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
