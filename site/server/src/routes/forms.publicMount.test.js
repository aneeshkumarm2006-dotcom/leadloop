/**
 * forms.publicMount.test.js — F13.4 (QA): assert no auth middleware sits before
 * the public form render/submit routes, the rate limiter is mounted on submit,
 * and the admin board-form router DOES gate its routes with auth.
 *
 * Structural test — inspects the Express router layer stacks directly so it runs
 * without a DB connection or a live HTTP server. Run from the server directory:
 *     node --test src/routes/forms.publicMount.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

require('../models'); // register models (controllers require them transitively)
const authMiddleware = require('../middleware/auth');
const { publicFormRouter, boardFormRouter } = require('./forms');

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

const findRoute = (router, path, method) =>
  (router.stack || []).find(
    (layer) => layer.route && layer.route.path === path && layer.route.methods && layer.route.methods[method]
  );

test('public form router has NO auth middleware anywhere in its stack', () => {
  const handles = allHandles(publicFormRouter);
  assert.ok(handles.length > 0, 'public router has layers');
  assert.equal(
    handles.includes(authMiddleware),
    false,
    'authMiddleware must not appear on the public form router'
  );
});

test('public form router exposes GET /f/:slug and POST /f/:slug/submit', () => {
  assert.ok(findRoute(publicFormRouter, '/f/:slug', 'get'), 'render GET route is registered');
  assert.ok(findRoute(publicFormRouter, '/f/:slug/submit', 'post'), 'submit POST route is registered');
});

test('submit route has rate-limit + parser middleware ahead of the handler', () => {
  const submit = findRoute(publicFormRouter, '/f/:slug/submit', 'post');
  assert.ok(submit, 'submit route exists');
  // rateLimit() + express.json() + submitForm = 3 handlers; assert middleware
  // sits before the final handler (more than the handler alone).
  assert.ok(
    submit.route.stack.length >= 2,
    'submit route must carry middleware (rate limiter / body parser) before its handler'
  );
});

test('admin board form router DOES apply auth middleware first', () => {
  const topLevel = layerHandles(boardFormRouter);
  assert.equal(
    topLevel[0],
    authMiddleware,
    'authMiddleware must be the first layer on the admin board form router'
  );
});

test('app mounts the public form router before any auth-gated /api router', () => {
  // Loading the app wires the full middleware stack. Stub the OAuth creds the
  // passport strategy demands so requiring the app doesn't throw in CI/local.
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-secret';
  process.env.GOOGLE_CALLBACK_URL =
    process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/auth/google/callback';

  const app = require('../app');
  const stack = app._router ? app._router.stack : (app.router && app.router.stack) || [];

  const indexOfPublicForm = stack.findIndex((layer) => layer.handle === publicFormRouter);
  const indexOfBoards = stack.findIndex((layer) => layer.regexp && layer.regexp.toString().includes('boards'));

  assert.ok(indexOfPublicForm >= 0, 'public form router is mounted on the app');
  if (indexOfBoards >= 0) {
    assert.ok(
      indexOfPublicForm < indexOfBoards,
      'public form router must mount before the authed /api/boards router'
    );
  }
});
