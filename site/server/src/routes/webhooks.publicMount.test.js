/**
 * webhooks.publicMount.test.js — F7.6 (QA): assert no auth middleware sits
 * before the public inbound webhook route, and that the admin router DOES gate
 * its routes with auth (Risks §Public route mount order).
 *
 * Structural test — inspects the Express router layer stacks directly so it runs
 * without a DB connection or a live HTTP server. Run from the server directory:
 *     node --test src/routes/webhooks.publicMount.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

require('../models'); // register models (controllers require them transitively)
const authMiddleware = require('../middleware/auth');
const { publicWebhookRouter, boardWebhookRouter } = require('./webhooks');

/** Collect the handler functions on a router's layers in order. */
const layerHandles = (router) =>
  (router.stack || []).map((layer) => layer.handle).filter(Boolean);

/** Recursively collect every handler reachable from a router (incl. route subs). */
const allHandles = (router) => {
  const out = [];
  for (const layer of router.stack || []) {
    if (layer.handle) out.push(layer.handle);
    if (layer.route && Array.isArray(layer.route.stack)) {
      for (const s of layer.route.stack) if (s.handle) out.push(s.handle);
    }
  }
  return out;
};

test('public inbound router has NO auth middleware anywhere in its stack', () => {
  const handles = allHandles(publicWebhookRouter);
  assert.ok(handles.length > 0, 'public router has layers');
  assert.equal(
    handles.includes(authMiddleware),
    false,
    'authMiddleware must not appear on the public inbound router'
  );
});

test('public inbound router exposes POST /api/webhooks/in/:token', () => {
  const found = (publicWebhookRouter.stack || []).some(
    (layer) =>
      layer.route &&
      layer.route.path === '/api/webhooks/in/:token' &&
      layer.route.methods &&
      layer.route.methods.post
  );
  assert.ok(found, 'inbound POST route is registered');
});

test('admin board webhook router DOES apply auth middleware first', () => {
  const topLevel = layerHandles(boardWebhookRouter);
  assert.equal(
    topLevel[0],
    authMiddleware,
    'authMiddleware must be the first layer on the admin router'
  );
});

test('app mounts the public webhook router before any auth-gated /api router', () => {
  // Loading the app wires the full middleware stack. Stub the OAuth creds the
  // passport strategy demands so requiring the app doesn't throw in CI/local.
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-secret';
  process.env.GOOGLE_CALLBACK_URL =
    process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/auth/google/callback';

  // We assert the public inbound route is reachable on the app router and
  // precedes the authed /api routers in registration order.
  const app = require('../app');
  const stack = app._router ? app._router.stack : (app.router && app.router.stack) || [];

  const indexOfPublicInbound = stack.findIndex(
    (layer) =>
      layer.handle === publicWebhookRouter ||
      (layer.regexp && typeof layer.handle === 'function' && layer.handle === publicWebhookRouter)
  );
  const indexOfBoards = stack.findIndex((layer) => layer.regexp && layer.regexp.toString().includes('boards'));

  assert.ok(indexOfPublicInbound >= 0, 'public webhook router is mounted on the app');
  if (indexOfBoards >= 0) {
    assert.ok(
      indexOfPublicInbound < indexOfBoards,
      'public inbound router must mount before the authed /api/boards router'
    );
  }
});
