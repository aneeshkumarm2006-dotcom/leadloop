/**
 * sms.publicMount.test.js — F10.4 (QA): assert no auth middleware sits before
 * the public Twilio SMS callbacks, and that the authed SMS router DOES gate its
 * routes with auth (Risks §Public route mount order).
 *
 * Structural test — inspects the Express router layer stacks directly so it runs
 * without a DB connection or a live HTTP server. Run from the server directory:
 *     node --test src/routes/sms.publicMount.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

require('../models'); // register models (controllers require them transitively)
const authMiddleware = require('../middleware/auth');
const { publicSmsRouter, smsRouter } = require('./sms');

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

test('public SMS router has NO auth middleware anywhere in its stack', () => {
  const handles = allHandles(publicSmsRouter);
  assert.ok(handles.length > 0, 'public router has layers');
  assert.equal(
    handles.includes(authMiddleware),
    false,
    'authMiddleware must not appear on the public SMS router'
  );
});

test('public SMS router exposes POST /api/sms/inbound and /api/sms/status', () => {
  const paths = (publicSmsRouter.stack || [])
    .filter((layer) => layer.route && layer.route.methods && layer.route.methods.post)
    .map((layer) => layer.route.path);
  assert.ok(paths.includes('/api/sms/inbound'), 'inbound POST route is registered');
  assert.ok(paths.includes('/api/sms/status'), 'status POST route is registered');
});

test('authed SMS router applies auth middleware first', () => {
  const topLevel = layerHandles(smsRouter);
  assert.equal(
    topLevel[0],
    authMiddleware,
    'authMiddleware must be the first layer on the authed SMS router'
  );
});

test('app mounts the public SMS router before any auth-gated /api router', () => {
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-secret';
  process.env.GOOGLE_CALLBACK_URL =
    process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/auth/google/callback';

  const app = require('../app');
  const stack = app._router ? app._router.stack : (app.router && app.router.stack) || [];

  const indexOfPublicSms = stack.findIndex((layer) => layer.handle === publicSmsRouter);
  const indexOfBoards = stack.findIndex(
    (layer) => layer.regexp && layer.regexp.toString().includes('boards')
  );

  assert.ok(indexOfPublicSms >= 0, 'public SMS router is mounted on the app');
  if (indexOfBoards >= 0) {
    assert.ok(
      indexOfPublicSms < indexOfBoards,
      'public SMS router must mount before the authed /api/boards router'
    );
  }
});
