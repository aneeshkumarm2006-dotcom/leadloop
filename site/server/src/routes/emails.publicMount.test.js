/**
 * emails.publicMount.test.js — F8.5 (QA): assert the F8 public surfaces carry
 * NO auth middleware and expose the expected routes, and that the authed
 * task-email router gates with auth first (Risks §Public route mount order).
 *
 * Structural test — inspects the router layer stacks directly (no DB / server).
 * Run from the server directory:
 *     node --test src/routes/emails.publicMount.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

require('../models');
const authMiddleware = require('../middleware/auth');
const { publicEmailRouter, emailRouter } = require('./emails');
const { publicEmailAccountRouter, emailAccountRouter } = require('./emailAccounts');

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

const hasRoute = (router, path, method) =>
  (router.stack || []).some(
    (l) => l.route && l.route.path === path && l.route.methods && l.route.methods[method]
  );

test('public email router has NO auth anywhere', () => {
  assert.equal(allHandles(publicEmailRouter).includes(authMiddleware), false);
});

test('public email-account (OAuth callback) router has NO auth anywhere', () => {
  assert.equal(allHandles(publicEmailAccountRouter).includes(authMiddleware), false);
});

test('public router exposes the tracking + inbound + callback routes', () => {
  assert.ok(hasRoute(publicEmailRouter, '/api/email/track/:messageId/open.gif', 'get'));
  assert.ok(hasRoute(publicEmailRouter, '/api/email/track/:messageId/click', 'get'));
  assert.ok(hasRoute(publicEmailRouter, '/api/email/inbound/gmail', 'post'));
  assert.ok(hasRoute(publicEmailRouter, '/api/email/inbound/microsoft', 'post'));
  assert.ok(
    hasRoute(publicEmailAccountRouter, '/api/email-accounts/oauth/callback/:provider', 'get')
  );
});

test('authed task-email + account routers apply auth as their first layer', () => {
  assert.equal(emailRouter.stack[0].handle, authMiddleware);
  assert.equal(emailAccountRouter.stack[0].handle, authMiddleware);
});
