/**
 * rateLimit.test.js — unit tests for the F7.1 token-bucket limiter.
 *
 * Exercises the pure `take()` decision function with an injected clock so the
 * 60-pass / 61st-429 / per-key isolation / refill-after-window behaviour is
 * deterministic (no real timers). Run from the server directory:
 *     node --test src/middleware/rateLimit.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const rateLimit = require('./rateLimit');
const { take, _reset, DEFAULT_CAPACITY, DEFAULT_WINDOW_MS } = rateLimit;

test('60 requests pass, the 61st is denied within the same window', () => {
  _reset();
  const now = 1_000_000;
  for (let i = 0; i < DEFAULT_CAPACITY; i += 1) {
    const r = take('k1', now);
    assert.equal(r.allowed, true, `request ${i + 1} should pass`);
  }
  const overflow = take('k1', now);
  assert.equal(overflow.allowed, false, '61st request denied');
  assert.ok(overflow.retryAfterMs > 0, 'reports a retry-after delay');
});

test('per-key isolation — one key exhausting does not affect another', () => {
  _reset();
  const now = 2_000_000;
  for (let i = 0; i < DEFAULT_CAPACITY; i += 1) take('a', now);
  assert.equal(take('a', now).allowed, false, 'key a exhausted');
  assert.equal(take('b', now).allowed, true, 'key b is independent');
});

test('bucket refills after the window elapses', () => {
  _reset();
  const start = 3_000_000;
  for (let i = 0; i < DEFAULT_CAPACITY; i += 1) take('k', start);
  assert.equal(take('k', start).allowed, false);
  // A full window later, the bucket is back to capacity.
  const later = start + DEFAULT_WINDOW_MS;
  assert.equal(take('k', later).allowed, true, 'refilled after one window');
});

test('partial refill — one token returns after window/capacity ms', () => {
  _reset();
  const start = 4_000_000;
  for (let i = 0; i < DEFAULT_CAPACITY; i += 1) take('k', start);
  assert.equal(take('k', start).allowed, false);
  // One token refills every windowMs/capacity ms (= 1s for 60/min).
  const oneTokenLater = start + Math.ceil(DEFAULT_WINDOW_MS / DEFAULT_CAPACITY);
  assert.equal(take('k', oneTokenLater).allowed, true, 'one token back after the slice');
});

test('middleware: returns 429 with Retry-After once the bucket is empty', () => {
  _reset();
  const mw = rateLimit({ capacity: 2, windowMs: 60_000 });
  const makeReq = () => ({ params: { token: 't1' }, ip: '1.2.3.4' });
  const makeRes = () => {
    const res = {
      headers: {},
      statusCode: 200,
      body: null,
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
    return res;
  };

  let nextCalls = 0;
  const next = () => { nextCalls += 1; };

  mw(makeReq(), makeRes(), next); // 1
  mw(makeReq(), makeRes(), next); // 2
  const res = makeRes();
  mw(makeReq(), res, next); // 3 — denied
  assert.equal(nextCalls, 2, 'first two pass through to next()');
  assert.equal(res.statusCode, 429);
  assert.ok(res.headers['Retry-After'] != null);
});

test('keyFn override changes the bucket key (form-submit reuse)', () => {
  _reset();
  const mw = rateLimit({ capacity: 1, windowMs: 60_000, keyFn: (req) => req.body.formId });
  const res = () => ({ setHeader() {}, status() { return this; }, json() { return this; } });
  let passed = 0;
  const next = () => { passed += 1; };
  mw({ body: { formId: 'f1' } }, res(), next); // passes
  mw({ body: { formId: 'f2' } }, res(), next); // different key → passes
  assert.equal(passed, 2, 'distinct formIds get independent buckets');
});
