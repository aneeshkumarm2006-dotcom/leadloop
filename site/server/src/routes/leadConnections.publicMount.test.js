/**
 * leadConnections.publicMount.test.js — F14.4 (QA): assert no auth middleware
 * sits before the public ingest route, and that the admin router DOES gate its
 * routes with auth (Risks §Public route mount order).
 *
 * Structural test — inspects the Express router layer stacks directly so it runs
 * without a DB connection or a live HTTP server. Run from the server directory:
 *     node --test src/routes/leadConnections.publicMount.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

require('../models'); // register models (controllers require them transitively)
const authMiddleware = require('../middleware/auth');
const { publicLeadRouter, boardLeadRouter } = require('./leadConnections');

/** Collect the handler functions on a router's top-level layers in order. */
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

test('public ingest router has NO auth middleware anywhere in its stack', () => {
  const handles = allHandles(publicLeadRouter);
  assert.ok(handles.length > 0, 'public router has layers');
  assert.equal(
    handles.includes(authMiddleware),
    false,
    'authMiddleware must not appear on the public ingest router'
  );
});

test('public ingest router exposes POST /api/leads/ingest', () => {
  const found = (publicLeadRouter.stack || []).some(
    (layer) =>
      layer.route &&
      layer.route.path === '/api/leads/ingest' &&
      layer.route.methods &&
      layer.route.methods.post
  );
  assert.ok(found, 'ingest POST route is registered');
});

test('admin lead-connection router DOES apply auth middleware first', () => {
  const topLevel = layerHandles(boardLeadRouter);
  assert.equal(
    topLevel[0],
    authMiddleware,
    'authMiddleware must be the first layer on the admin router'
  );
});

test('app mounts the public ingest router before any auth-gated /api router', () => {
  // Loading the app wires the full middleware stack. Stub the OAuth creds the
  // passport strategy demands so requiring the app doesn't throw in CI/local.
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-secret';
  process.env.GOOGLE_CALLBACK_URL =
    process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/auth/google/callback';

  const app = require('../app');
  const stack = app._router ? app._router.stack : (app.router && app.router.stack) || [];

  const indexOfPublicIngest = stack.findIndex((layer) => layer.handle === publicLeadRouter);
  const indexOfBoards = stack.findIndex(
    (layer) => layer.regexp && layer.regexp.toString().includes('boards')
  );

  assert.ok(indexOfPublicIngest >= 0, 'public ingest router is mounted on the app');
  if (indexOfBoards >= 0) {
    assert.ok(
      indexOfPublicIngest < indexOfBoards,
      'public ingest router must mount before the authed /api/boards router'
    );
  }
});

// --- CORS for external customer websites (browser calls) --------------------

test('app mounts the public ingest router BEFORE the global cors() layer', () => {
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-secret';
  process.env.GOOGLE_CALLBACK_URL =
    process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/auth/google/callback';

  const app = require('../app');
  const stack = app._router ? app._router.stack : (app.router && app.router.stack) || [];

  const indexOfPublicIngest = stack.findIndex((layer) => layer.handle === publicLeadRouter);
  // The `cors` package names its middleware `corsMiddleware`. The global,
  // origin-restricted layer must sit AFTER our router: it ends OPTIONS
  // preflights itself, so if it ran first, a customer website's preflight
  // would be answered with the CRM-only origin and the browser would block
  // the submission.
  const indexOfGlobalCors = stack.findIndex(
    (layer) => layer.name === 'corsMiddleware' || (layer.handle && layer.handle.name === 'corsMiddleware')
  );

  assert.ok(indexOfPublicIngest >= 0, 'public ingest router is mounted on the app');
  assert.ok(indexOfGlobalCors >= 0, 'global cors layer found on the app');
  assert.ok(
    indexOfPublicIngest < indexOfGlobalCors,
    'public ingest router must mount before the global origin-restricted cors()'
  );
});

test('ingest route answers OPTIONS preflights and carries its own CORS + parsers', () => {
  const optionsRoute = (publicLeadRouter.stack || []).find(
    (layer) =>
      layer.route &&
      layer.route.path === '/api/leads/ingest' &&
      layer.route.methods &&
      layer.route.methods.options
  );
  assert.ok(optionsRoute, 'OPTIONS /api/leads/ingest is registered (preflight)');

  const postRoute = (publicLeadRouter.stack || []).find(
    (layer) =>
      layer.route &&
      layer.route.path === '/api/leads/ingest' &&
      layer.route.methods &&
      layer.route.methods.post
  );
  assert.ok(postRoute, 'POST /api/leads/ingest is registered');
  const names = postRoute.route.stack.map((s) => s.handle && s.handle.name);
  assert.ok(names.includes('corsMiddleware'), 'route-level CORS sits on the POST route');
  assert.ok(names.includes('jsonParser'), 'JSON body parser on the POST route');
  assert.ok(names.includes('urlencodedParser'), 'urlencoded parser on the POST route (zero-JS <form> posts)');
  assert.equal(
    postRoute.route.stack.length >= 5,
    true,
    'cors + rate limit + json + urlencoded + handler are all present'
  );
});
