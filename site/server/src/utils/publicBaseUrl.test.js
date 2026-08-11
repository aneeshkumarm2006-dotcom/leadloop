/**
 * publicBaseUrl.test.js — unit tests for the public-origin resolver.
 * Run: node --test src/utils/publicBaseUrl.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { publicBaseUrl } = require('./publicBaseUrl');

/** Minimal express-request stand-in: only `get` + `protocol` are read. */
const fakeReq = (headers = {}, protocol = 'http') => ({
  protocol,
  get: (name) => headers[name.toLowerCase()],
});

const withEnv = (value, fn) => {
  const prev = process.env.WEBHOOK_PUBLIC_BASE_URL;
  if (value === undefined) delete process.env.WEBHOOK_PUBLIC_BASE_URL;
  else process.env.WEBHOOK_PUBLIC_BASE_URL = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.WEBHOOK_PUBLIC_BASE_URL;
    else process.env.WEBHOOK_PUBLIC_BASE_URL = prev;
  }
};

test('env var wins over the request origin', () => {
  withEnv('https://api.example.com', () => {
    assert.equal(publicBaseUrl(fakeReq({ host: 'evil.test' })), 'https://api.example.com');
  });
});

test('trailing slash is stripped from the env var', () => {
  withEnv('https://api.example.com/', () => {
    assert.equal(publicBaseUrl(), 'https://api.example.com');
  });
});

test('falls back to the deployed origin from proxy headers', () => {
  withEnv(undefined, () => {
    const req = fakeReq({ host: 'leadloop.onrender.com', 'x-forwarded-proto': 'https' });
    assert.equal(publicBaseUrl(req), 'https://leadloop.onrender.com');
  });
});

test('x-forwarded-host takes precedence over host', () => {
  withEnv(undefined, () => {
    const req = fakeReq({
      host: 'internal:5000',
      'x-forwarded-host': 'api.example.com',
      'x-forwarded-proto': 'https',
    });
    assert.equal(publicBaseUrl(req), 'https://api.example.com');
  });
});

test('comma-joined proxy chains use the first hop', () => {
  withEnv(undefined, () => {
    const req = fakeReq({
      'x-forwarded-host': 'api.example.com, internal.lan',
      'x-forwarded-proto': 'https, http',
    });
    assert.equal(publicBaseUrl(req), 'https://api.example.com');
  });
});

test('no proxy headers → req.protocol + host (local dev)', () => {
  withEnv(undefined, () => {
    assert.equal(publicBaseUrl(fakeReq({ host: 'localhost:5000' })), 'http://localhost:5000');
  });
});

test('no request at all → localhost:PORT (jobs, scripts)', () => {
  withEnv(undefined, () => {
    const prevPort = process.env.PORT;
    process.env.PORT = '5000';
    assert.equal(publicBaseUrl(), 'http://localhost:5000');
    assert.equal(publicBaseUrl({}), 'http://localhost:5000');
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
  });
});
