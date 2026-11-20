/**
 * adConnect.publicMount.test.js — the ad-connect public surfaces (OAuth
 * callback, Meta/TikTok webhooks) carry NO auth and verify callers by other
 * means; the admin router gates with auth + requireOrgAdmin on every route.
 * Also exercises the public handlers over real HTTP (no DB needed: every
 * request here is rejected or answered before a query would run).
 * Run: node --test src/routes/adConnect.publicMount.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');

process.env.JWT_SECRET = 'test-secret';
process.env.META_APP_SECRET = 'meta-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-me';
process.env.CLIENT_URL = 'https://app.example.com';

require('../models');
const authMiddleware = require('../middleware/auth');
const { requireOrgAdmin } = require('../middleware/roleCheck');
const { publicAdConnectRouter, adConnectRouter } = require('./adConnect');
const svc = require('../services/adConnectService');

const allHandles = (router) => {
  const out = [];
  for (const layer of router.stack || []) {
    if (layer.handle) out.push(layer.handle);
    if (layer.route) for (const s of layer.route.stack) out.push(s.handle);
  }
  return out;
};

test('public ad-connect router has NO auth and exposes callback + webhooks', () => {
  assert.equal(allHandles(publicAdConnectRouter).includes(authMiddleware), false);
  const routes = publicAdConnectRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
  assert.deepEqual(routes.sort(), [
    'get /api/ad-connect/callback/:platform',
    'get /api/ad-connect/webhooks/meta',
    'post /api/ad-connect/webhooks/meta',
    'post /api/ad-connect/webhooks/tiktok',
  ]);
});

test('admin router: auth first, requireOrgAdmin on every route', () => {
  assert.equal(adConnectRouter.stack[0].handle, authMiddleware);
  const routes = adConnectRouter.stack.filter((l) => l.route);
  assert.equal(routes.length, 18);
  for (const l of routes) {
    assert.match(l.route.path, /^\/workspaces\/:id\/ad-connect\//);
    assert.ok(l.route.stack.some((s) => s.handle === requireOrgAdmin), `${l.route.path} must require org admin`);
  }
});

// --- live HTTP ----------------------------------------------------------------------

const withServer = async (fn) => {
  const app = express();
  app.use(publicAdConnectRouter);
  app.use(express.json());
  app.use('/api', adConnectRouter);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
};

test('callback: bad / missing state → redirect back with a fixed reason, never provider text', async () => {
  await withServer(async (base) => {
    let r = await fetch(`${base}/api/ad-connect/callback/meta?code=abc&state=forged`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    let loc = new URL(r.headers.get('location'));
    assert.equal(loc.origin, 'https://app.example.com');
    assert.equal(loc.searchParams.get('tab'), 'ads');
    assert.equal(loc.searchParams.get('connect_error'), 'expired');

    r = await fetch(`${base}/api/ad-connect/callback/google?error=access_denied&error_description=<script>`, { redirect: 'manual' });
    loc = new URL(r.headers.get('location'));
    assert.equal(loc.searchParams.get('connect_error'), 'cancelled');
    assert.ok(!r.headers.get('location').includes('script'));

    r = await fetch(`${base}/api/ad-connect/callback/evil?code=1&state=2`, { redirect: 'manual' });
    loc = new URL(r.headers.get('location'));
    assert.equal(loc.searchParams.get('connect_error'), 'failed');
    assert.equal(loc.searchParams.get('connect'), null);
  });
});

test('meta webhook: verify handshake, signature required, valid → 200 + async processing', async () => {
  const seen = [];
  const orig = svc.processMetaWebhook;
  svc.processMetaWebhook = async (body) => {
    seen.push(body);
  };
  try {
    await withServer(async (base) => {
      let r = await fetch(`${base}/api/ad-connect/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=987`);
      assert.equal(r.status, 200);
      assert.equal(await r.text(), '987');
      r = await fetch(`${base}/api/ad-connect/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=987`);
      assert.equal(r.status, 403);

      const raw = JSON.stringify({ object: 'page', entry: [] });
      r = await fetch(`${base}/api/ad-connect/webhooks/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw });
      assert.equal(r.status, 401);
      r = await fetch(`${base}/api/ad-connect/webhooks/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + 'a'.repeat(64) },
        body: raw,
      });
      assert.equal(r.status, 401);
      const sig = `sha256=${crypto.createHmac('sha256', 'meta-secret').update(raw).digest('hex')}`;
      r = await fetch(`${base}/api/ad-connect/webhooks/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: raw });
      assert.equal(r.status, 200);
      await new Promise((res) => setTimeout(res, 20));
      assert.deepEqual(seen, [{ object: 'page', entry: [] }]);
    });
  } finally {
    svc.processMetaWebhook = orig;
  }
});

test('tiktok webhook: missing / malformed URL secret → 401 (no DB lookup)', async () => {
  await withServer(async (base) => {
    let r = await fetch(`${base}/api/ad-connect/webhooks/tiktok`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"lead_id":"1"}' });
    assert.equal(r.status, 401);
    r = await fetch(`${base}/api/ad-connect/webhooks/tiktok?k=not-a-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 401);
  });
});

test('admin routes reject unauthenticated callers', async () => {
  await withServer(async (base) => {
    const r = await fetch(`${base}/api/workspaces/6aece1bafafc81bd75d22e00/ad-connect/overview`);
    assert.equal(r.status, 401);
    const s = await fetch(`${base}/api/workspaces/6aece1bafafc81bd75d22e00/ad-connect/meta/start`, { method: 'POST' });
    assert.equal(s.status, 401);
  });
});
