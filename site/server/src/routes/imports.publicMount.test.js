/**
 * imports.publicMount.test.js — regression guard.
 *
 * The CSV-import router is mounted at the app ROOT (no path prefix) and BEFORE
 * the global body parser, because it needs a 12MB limit. That mount position
 * makes any `router.use(middleware)` inside it run for EVERY request in the
 * app.
 *
 * A `router.use(authMiddleware)` there once put the auth check in front of
 * `/auth/login` and `/auth/google`, so the entire sign-in flow answered
 * `{"error":"Missing or invalid authorization header"}` and nobody could log
 * in. This test fails if that ever comes back.
 *
 *     node --test src/routes/imports.publicMount.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const importsRouter = require('./imports');

/** Mount the router exactly as app.js does, ahead of a public route. */
const buildApp = () => {
  const app = express();
  app.use(importsRouter);
  app.get('/auth/google', (req, res) => res.status(302).set('location', 'https://accounts.google.com/o/oauth2/v2/auth').end());
  app.post('/auth/login', (req, res) => res.json({ ok: true }));
  app.get('/', (req, res) => res.json({ status: 'ok' }));
  return app;
};

const request = (app, path, method = 'GET') =>
  new Promise((resolve) => {
    const server = app.listen(0, async () => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method,
        redirect: 'manual',
      });
      const body = await res.text().catch(() => '');
      server.close();
      resolve({ status: res.status, body });
    });
  });

test('the import router does not gate /auth/google', async () => {
  const res = await request(buildApp(), '/auth/google');
  assert.equal(res.status, 302, 'sign-in must reach passport, not the auth middleware');
  assert.ok(!res.body.includes('authorization header'), 'must not be the auth-middleware 401');
});

test('the import router does not gate /auth/login', async () => {
  const res = await request(buildApp(), '/auth/login', 'POST');
  assert.equal(res.status, 200);
});

test('the import router does not gate the health check', async () => {
  const res = await request(buildApp(), '/');
  assert.equal(res.status, 200);
});

test('the import routes themselves DO still require auth', async () => {
  const res = await request(buildApp(), '/api/boards/123/import/preview', 'POST');
  assert.equal(res.status, 401, 'import must never be open');
  assert.ok(res.body.includes('authorization header'));
});
