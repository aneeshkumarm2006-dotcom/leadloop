/**
 * webhookDispatcher.test.js — unit tests for the F7.4 outbound retry logic.
 *
 * Exercises the pure backoff schedule and the `attemptDelivery` state machine
 * with a stubbed global `fetch` and a fake delivery doc (no DB / no network).
 * Run from the server directory:
 *     node --test src/services/webhookDispatcher.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attemptDelivery,
  nextBackoffMs,
  BACKOFF_MS,
} = require('./webhookDispatcher');

const ENDPOINT = { _id: 'ep1', direction: 'out', url: 'https://example.com/hook', secret: 's3cr3t' };

const fakeDelivery = (overrides = {}) => ({
  payload: { event: 'STATUS_BECAME', taskId: 't1' },
  status: 'pending',
  attempt: 0,
  nextRetryAt: null,
  response: null,
  _saves: 0,
  async save() { this._saves += 1; return this; },
  ...overrides,
});

// Swap the global fetch for the duration of a callback.
const withFetch = async (impl, fn) => {
  const original = global.fetch;
  global.fetch = impl;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
};

test('nextBackoffMs: 1m / 5m / 30m / 2h then null', () => {
  assert.equal(nextBackoffMs(0), 60_000);
  assert.equal(nextBackoffMs(1), 5 * 60_000);
  assert.equal(nextBackoffMs(2), 30 * 60_000);
  assert.equal(nextBackoffMs(3), 2 * 60 * 60_000);
  assert.equal(nextBackoffMs(4), null); // exhausted → fail
  assert.equal(BACKOFF_MS.length, 4);
});

test('attemptDelivery: 2xx → delivered, stores response, no retry', async () => {
  const delivery = fakeDelivery();
  await withFetch(
    async () => ({ status: 200, text: async () => 'ok' }),
    () => attemptDelivery(delivery, ENDPOINT)
  );
  assert.equal(delivery.status, 'delivered');
  assert.equal(delivery.response.status, 200);
  assert.equal(delivery.response.body, 'ok');
  assert.equal(delivery.nextRetryAt, null);
  assert.equal(delivery.attempt, 0); // not advanced on success
});

test('attemptDelivery: 500 → pending, schedules first retry at +1m, bumps attempt', async () => {
  const delivery = fakeDelivery();
  const now = new Date('2026-06-04T00:00:00.000Z');
  await withFetch(
    async () => ({ status: 500, text: async () => 'boom' }),
    () => attemptDelivery(delivery, ENDPOINT, now)
  );
  assert.equal(delivery.status, 'pending');
  assert.equal(delivery.attempt, 1);
  assert.equal(delivery.nextRetryAt.getTime(), now.getTime() + 60_000);
});

test('attemptDelivery: network throw → pending with retry', async () => {
  const delivery = fakeDelivery();
  const now = new Date('2026-06-04T00:00:00.000Z');
  await withFetch(
    async () => { throw new Error('ECONNREFUSED'); },
    () => attemptDelivery(delivery, ENDPOINT, now)
  );
  assert.equal(delivery.status, 'pending');
  assert.equal(delivery.response.status, 0);
  assert.match(delivery.response.body, /ECONNREFUSED/);
  assert.equal(delivery.attempt, 1);
});

test('attemptDelivery: failing after 4 attempts marks failed', async () => {
  // Start at attempt=3 (already three failures recorded → 4th is the last).
  const delivery = fakeDelivery({ attempt: 3 });
  const now = new Date('2026-06-04T00:00:00.000Z');
  await withFetch(
    async () => ({ status: 503, text: async () => 'down' }),
    () => attemptDelivery(delivery, ENDPOINT, now)
  );
  // attempt was 3 → nextBackoffMs(3)=2h schedules one more retry, attempt→4.
  assert.equal(delivery.status, 'pending');
  assert.equal(delivery.attempt, 4);
  assert.equal(delivery.nextRetryAt.getTime(), now.getTime() + 2 * 60 * 60_000);

  // The next failure (attempt=4) exhausts the schedule → failed.
  const final = await withFetch(
    async () => ({ status: 503, text: async () => 'down' }),
    () => attemptDelivery(delivery, ENDPOINT, now)
  );
  assert.equal(final.status, 'failed');
  assert.equal(final.nextRetryAt, null);
});

test('attemptDelivery: signs the body with the endpoint secret (X-CRM-Signature)', async () => {
  const { sign } = require('../utils/hmacSigner');
  const delivery = fakeDelivery();
  let sentHeaders = null;
  let sentBody = null;
  await withFetch(
    async (url, opts) => { sentHeaders = opts.headers; sentBody = opts.body; return { status: 200, text: async () => '' }; },
    () => attemptDelivery(delivery, ENDPOINT)
  );
  const expected = sign(sentBody, ENDPOINT.secret);
  assert.equal(sentHeaders['X-CRM-Signature'], expected);
  assert.equal(sentHeaders['Content-Type'], 'application/json');
});
