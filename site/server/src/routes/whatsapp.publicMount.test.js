/**
 * whatsapp.publicMount.test.js — F11.4 (QA): assert no auth middleware sits
 * before the public Twilio WhatsApp callbacks, and that the authed WhatsApp
 * router DOES gate its routes with auth (Risks §Public route mount order).
 *
 * Structural test — inspects the Express router layer stacks directly so it runs
 * without a DB connection or a live HTTP server. Run from the server directory:
 *     node --test src/routes/whatsapp.publicMount.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

require('../models'); // register models (controllers require them transitively)
const authMiddleware = require('../middleware/auth');
const { publicWhatsAppRouter, whatsappRouter } = require('./whatsapp');

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

test('public WhatsApp router has NO auth middleware anywhere in its stack', () => {
  const handles = allHandles(publicWhatsAppRouter);
  assert.ok(handles.length > 0, 'public router has layers');
  assert.equal(
    handles.includes(authMiddleware),
    false,
    'authMiddleware must not appear on the public WhatsApp router'
  );
});

test('public WhatsApp router exposes POST /api/whatsapp/inbound and /api/whatsapp/status', () => {
  const paths = (publicWhatsAppRouter.stack || [])
    .filter((layer) => layer.route && layer.route.methods && layer.route.methods.post)
    .map((layer) => layer.route.path);
  assert.ok(paths.includes('/api/whatsapp/inbound'), 'inbound POST route is registered');
  assert.ok(paths.includes('/api/whatsapp/status'), 'status POST route is registered');
});

test('authed WhatsApp router applies auth middleware first', () => {
  const topLevel = layerHandles(whatsappRouter);
  assert.equal(
    topLevel[0],
    authMiddleware,
    'authMiddleware must be the first layer on the authed WhatsApp router'
  );
});

test('app mounts the public WhatsApp router before any auth-gated /api router', () => {
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-secret';
  process.env.GOOGLE_CALLBACK_URL =
    process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/auth/google/callback';

  const app = require('../app');
  const stack = app._router ? app._router.stack : (app.router && app.router.stack) || [];

  const indexOfPublicWhatsApp = stack.findIndex((layer) => layer.handle === publicWhatsAppRouter);
  const indexOfBoards = stack.findIndex(
    (layer) => layer.regexp && layer.regexp.toString().includes('boards')
  );

  assert.ok(indexOfPublicWhatsApp >= 0, 'public WhatsApp router is mounted on the app');
  if (indexOfBoards >= 0) {
    assert.ok(
      indexOfPublicWhatsApp < indexOfBoards,
      'public WhatsApp router must mount before the authed /api/boards router'
    );
  }
});
