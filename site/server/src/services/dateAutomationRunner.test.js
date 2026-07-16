/**
 * dateAutomationRunner.test.js — unit tests for the DATE_ARRIVED fire-instant
 * math (F4.5 / AC#2) and region→timezone mapping. No DB / cron needed.
 *
 * Run from the server directory:
 *     node --test src/services/dateAutomationRunner.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeFireInstant,
  timezoneForRegion,
} = require('./dateAutomationRunner');

// ---------------------------------------------------------------------------
// timezoneForRegion
// ---------------------------------------------------------------------------
test('timezoneForRegion: maps F3 regions, defaults to Edmonton', () => {
  assert.equal(timezoneForRegion('Edmonton'), 'America/Edmonton');
  assert.equal(timezoneForRegion('Saskatoon'), 'America/Regina');
  assert.equal(timezoneForRegion('Regina'), 'America/Regina');
  assert.equal(timezoneForRegion('Montreal'), 'America/Toronto');
  assert.equal(timezoneForRegion('Other'), 'America/Edmonton');
  assert.equal(timezoneForRegion(undefined), 'America/Edmonton');
  assert.equal(timezoneForRegion('Atlantis'), 'America/Edmonton');
});

// ---------------------------------------------------------------------------
// computeFireInstant — AC#2: Move-in 2026-06-15, offset -7, fires at
// 2026-06-08 00:00 *workspace-local*.
// ---------------------------------------------------------------------------
test('computeFireInstant: AC#2 — Edmonton midnight (MDT = UTC-6 in June)', () => {
  const instant = computeFireInstant('2026-06-15T00:00:00.000Z', -7, 'America/Edmonton');
  assert.equal(instant.toISOString(), '2026-06-08T06:00:00.000Z');
});

test('computeFireInstant: Saskatchewan has no DST (CST = UTC-6 year-round)', () => {
  const instant = computeFireInstant('2026-06-15T00:00:00.000Z', -7, 'America/Regina');
  assert.equal(instant.toISOString(), '2026-06-08T06:00:00.000Z');
});

test('computeFireInstant: Montreal midnight (EDT = UTC-4 in June)', () => {
  const instant = computeFireInstant('2026-06-15T00:00:00.000Z', -7, 'America/Toronto');
  assert.equal(instant.toISOString(), '2026-06-08T04:00:00.000Z');
});

test('computeFireInstant: zero offset resolves the date itself at local midnight', () => {
  const instant = computeFireInstant('2026-06-15T00:00:00.000Z', 0, 'America/Edmonton');
  assert.equal(instant.toISOString(), '2026-06-15T06:00:00.000Z');
});

test('computeFireInstant: positive offset shifts forward across a month boundary', () => {
  // 2026-06-28 + 7 = 2026-07-05 local midnight (still MDT).
  const instant = computeFireInstant('2026-06-28T00:00:00.000Z', 7, 'America/Edmonton');
  assert.equal(instant.toISOString(), '2026-07-05T06:00:00.000Z');
});

test('computeFireInstant: winter date uses MST = UTC-7 (DST-aware)', () => {
  // January → Edmonton on MST (UTC-7) → midnight local = 07:00 UTC.
  const instant = computeFireInstant('2026-01-15T00:00:00.000Z', 0, 'America/Edmonton');
  assert.equal(instant.toISOString(), '2026-01-15T07:00:00.000Z');
});

test('computeFireInstant: null / empty value → null', () => {
  assert.equal(computeFireInstant(null, -7, 'America/Edmonton'), null);
  assert.equal(computeFireInstant('', -7, 'America/Edmonton'), null);
  assert.equal(computeFireInstant('not-a-date', -7, 'America/Edmonton'), null);
});
