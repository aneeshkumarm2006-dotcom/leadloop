/**
 * adConnectWebsite.test.js — authz on the Website routes over real HTTP:
 * auth required, workspace admin required, and a connection from ANOTHER
 * workspace is a 404 (IDOR). DB lookups are stubbed; nothing hits the network.
 * Run: node --test src/routes/adConnectWebsite.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-adconnect';
delete process.env.RESEND_API_KEY;

require('../models');
const Organisation = require('../models/Organisation');
const Board = require('../models/Board');
const LeadConnection = require('../models/LeadConnection');

const oid = () => new mongoose.Types.ObjectId().toString();
const ADMIN = oid();
const MEMBER = oid();
const WS = oid();
const OTHER_WS = oid();
const BOARD = oid();
const OTHER_BOARD = oid();
const CONN = oid();
const OTHER_CONN = oid();

Organisation.findById = async (id) =>
  String(id) === WS || String(id) === OTHER_WS ? { _id: id, name: 'Acme', admin: ADMIN, admins: [], members: [ADMIN, MEMBER] } : null;
const lean = (v) => ({ select: () => ({ lean: async () => v }) });
Board.findById = (id) => lean(String(id) === BOARD ? { organisation: WS } : String(id) === OTHER_BOARD ? { organisation: OTHER_WS } : null);
const conns = {
  [CONN]: { _id: CONN, boardId: BOARD, siteKey: 'site_abcdefgh2345', sourceType: 'website_snippet', allowedDomains: ['bopayments.com'], snippet: {} },
  [OTHER_CONN]: { _id: OTHER_CONN, boardId: OTHER_BOARD, siteKey: 'site_zzzzzzzz2345', sourceType: 'website_snippet', allowedDomains: ['other.com'], snippet: {} },
};
LeadConnection.findOne = async (q) => (q.sourceType === 'website_snippet' ? conns[String(q._id)] || null : null);

const app = express();
app.use(express.json());
app.use('/api', require('./adConnectWebsite'));
app.use('/api', (req, res) => res.status(418).json({ passthrough: true }));

let server;
let base;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const auth = (userId) => ({ Authorization: `Bearer ${jwt.sign({ userId, email: 'a@b.co', name: 'Ann' }, process.env.JWT_SECRET)}` });
const post = (p, body, headers = {}) =>
  fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('no token → 401; member (not admin) → 403', async () => {
  assert.equal((await post(`/api/workspaces/${WS}/ad-connect/website/check`, { connectionId: CONN })).status, 401);
  assert.equal((await fetch(`${base}/api/workspaces/${WS}/ad-connect/website/${CONN}/wordpress-plugin.zip`)).status, 401);
  assert.equal((await post(`/api/workspaces/${WS}/ad-connect/website/email-developer`, { connectionId: CONN, email: 'd@x.com', builder: 'wix' }, auth(MEMBER))).status, 403);
  assert.equal((await fetch(`${base}/api/workspaces/${WS}/ad-connect/website/${CONN}/wordpress-plugin.zip`, { headers: auth(MEMBER) })).status, 403);
});

test('malformed workspace id → 400', async () => {
  assert.equal((await post('/api/workspaces/nope/ad-connect/website/check', { connectionId: CONN }, auth(ADMIN))).status, 400);
});

test('IDOR: another workspace’s connection → 404 on every route', async () => {
  const h = auth(ADMIN);
  assert.equal((await post(`/api/workspaces/${WS}/ad-connect/website/check`, { connectionId: OTHER_CONN }, h)).status, 404);
  assert.equal((await fetch(`${base}/api/workspaces/${WS}/ad-connect/website/${OTHER_CONN}/wordpress-plugin.zip`, { headers: h })).status, 404);
  assert.equal(
    (await post(`/api/workspaces/${WS}/ad-connect/website/email-developer`, { connectionId: OTHER_CONN, email: 'd@x.com', builder: 'wix' }, h)).status,
    404
  );
  assert.equal((await post(`/api/workspaces/${WS}/ad-connect/website/check`, { connectionId: 'garbage' }, h)).status, 404);
});

test('admin downloads the plugin zip for their own site', async () => {
  const r = await fetch(`${base}/api/workspaces/${WS}/ad-connect/website/${CONN}/wordpress-plugin.zip`, { headers: auth(ADMIN) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  assert.match(r.headers.get('content-disposition'), /leadloop\.zip/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.ok(buf.includes('site_abcdefgh2345'));
});

test('check: URL off the site’s domains → 400 before any fetch', async () => {
  const r = await post(`/api/workspaces/${WS}/ad-connect/website/check`, { connectionId: CONN, url: 'http://169.254.169.254/' }, auth(ADMIN));
  assert.equal(r.status, 400);
});

test('email-developer: validation, then 503 when mail is not configured', async () => {
  const h = auth(ADMIN);
  const p = `/api/workspaces/${WS}/ad-connect/website/email-developer`;
  assert.equal((await post(p, { connectionId: CONN, email: 'bad', builder: 'wix' }, h)).status, 400);
  assert.equal((await post(p, { connectionId: CONN, email: 'd@x.com', builder: 'joomla' }, h)).status, 400);
  assert.equal((await post(p, { connectionId: CONN, email: 'd@x.com', builder: 'wix' }, h)).status, 503);
});

test('email-developer: 5/hour/workspace rate limit', async () => {
  const h = auth(ADMIN);
  const p = `/api/workspaces/${OTHER_WS}/ad-connect/website/email-developer`;
  const statuses = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await post(p, { connectionId: OTHER_CONN, email: 'd@x.com', builder: 'wix' }, h)).status);
  assert.deepEqual(statuses.slice(0, 5), Array(5).fill(503));
  assert.equal(statuses[5], 429);
});

test('router does not swallow unrelated /api routes', async () => {
  const r = await fetch(`${base}/api/workspaces/${WS}/something-else`);
  assert.equal(r.status, 418);
});
