/**
 * consentService.test.js — the send-permission rules. Pure, no DB.
 *     node --test src/services/consentService.test.js
 *
 * These tests encode legal obligations, not preferences. Treat a failure here
 * as "we are about to send an unlawful message", not as a broken unit test.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATES,
  BLOCKED,
  canSend,
  impliedExpiryFor,
  isImpliedValid,
  inQuietHours,
  isOptOutMessage,
} = require('./consentService');

const NOON_UTC = new Date('2026-06-15T16:00:00Z'); // 12:00 in America/Toronto
const express = { state: STATES.EXPRESS, capturedAt: '2026-01-01T00:00:00Z' };

// --- suppression: the rule that generates lawsuits -------------------------

test('suppression blocks EVERY channel, whatever the consent says', () => {
  for (const channel of ['email', 'sms', 'whatsapp', 'call']) {
    const r = canSend({ channel, consent: express, suppressed: true, now: NOON_UTC });
    assert.equal(r.allowed, false, channel);
    assert.equal(r.reason, BLOCKED.SUPPRESSED);
  }
});

test('suppression even blocks TRANSACTIONAL messages', () => {
  // Someone who said STOP gets nothing at all — not even a booking confirmation.
  const r = canSend({
    channel: 'sms',
    consent: express,
    suppressed: true,
    messageType: 'transactional',
    now: NOON_UTC,
  });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, BLOCKED.SUPPRESSED);
});

test('withdrawn consent is a hard no', () => {
  const r = canSend({ channel: 'email', consent: { state: STATES.WITHDRAWN }, now: NOON_UTC });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, BLOCKED.WITHDRAWN);
});

// --- marketing needs consent ----------------------------------------------

test('no consent record → marketing is blocked', () => {
  const r = canSend({ channel: 'sms', consent: null, now: NOON_UTC });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, BLOCKED.NO_CONSENT);
});

test('state "none" is not consent', () => {
  const r = canSend({ channel: 'sms', consent: { state: STATES.NONE }, now: NOON_UTC });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, BLOCKED.NO_CONSENT);
});

test('express consent allows marketing', () => {
  const r = canSend({ channel: 'sms', consent: express, now: NOON_UTC, timezone: 'America/Toronto' });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, null);
});

// --- CASL implied consent expires -----------------------------------------

test('implied consent from an enquiry lasts six months, then lapses', () => {
  const consent = { state: STATES.IMPLIED, basis: 'enquiry', capturedAt: '2026-01-01T00:00:00Z' };

  const within = canSend({ channel: 'email', consent, now: new Date('2026-05-01T16:00:00Z'), timezone: 'America/Toronto' });
  assert.equal(within.allowed, true);
  assert.ok(within.expiresAt instanceof Date, 'caller can show when it lapses');

  const after = canSend({ channel: 'email', consent, now: new Date('2026-09-01T16:00:00Z'), timezone: 'America/Toronto' });
  assert.equal(after.allowed, false);
  assert.equal(after.reason, BLOCKED.IMPLIED_EXPIRED);
});

test('implied consent from a transaction lasts two years', () => {
  const consent = { state: STATES.IMPLIED, basis: 'transaction', capturedAt: '2026-01-01T00:00:00Z' };
  assert.equal(isImpliedValid(consent, new Date('2027-06-01T00:00:00Z')), true);
  assert.equal(isImpliedValid(consent, new Date('2028-06-01T00:00:00Z')), false);
});

test('an explicit expiresAt overrides the default window', () => {
  const consent = { state: STATES.IMPLIED, capturedAt: '2026-01-01', expiresAt: '2026-02-01T00:00:00Z' };
  assert.equal(impliedExpiryFor(consent).toISOString(), '2026-02-01T00:00:00.000Z');
  assert.equal(isImpliedValid(consent, new Date('2026-03-01')), false);
});

test('implied consent with no capture date is not valid consent', () => {
  assert.equal(impliedExpiryFor({ state: STATES.IMPLIED }), null);
  const r = canSend({ channel: 'sms', consent: { state: STATES.IMPLIED }, now: NOON_UTC });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, BLOCKED.IMPLIED_EXPIRED);
});

// --- transactional ---------------------------------------------------------

test('transactional messages do not need marketing consent', () => {
  const r = canSend({ channel: 'sms', consent: null, messageType: 'transactional', now: NOON_UTC });
  assert.equal(r.allowed, true, 'a tour confirmation they just asked for must send');
});

test('transactional messages ignore quiet hours', () => {
  const r = canSend({
    channel: 'sms',
    consent: null,
    messageType: 'transactional',
    now: new Date('2026-06-15T06:00:00Z'), // 02:00 Toronto
    timezone: 'America/Toronto',
  });
  assert.equal(r.allowed, true);
});

// --- quiet hours -----------------------------------------------------------

test('quiet hours block marketing in the RECIPIENT timezone', () => {
  // 06:00 UTC = 02:00 in Toronto → quiet; = 23:00 the previous day in Honolulu → quiet.
  const at2am = new Date('2026-06-15T06:00:00Z');
  const r = canSend({ channel: 'sms', consent: express, now: at2am, timezone: 'America/Toronto' });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, BLOCKED.QUIET_HOURS);
});

test('the same instant is fine in a timezone where it is midday', () => {
  const at2amToronto = new Date('2026-06-15T06:00:00Z'); // 20:00 in Asia/Tokyo (previous rules differ)
  const r = canSend({ channel: 'sms', consent: express, now: at2amToronto, timezone: 'Europe/Paris' }); // 08:00 Paris
  assert.equal(r.allowed, false, '08:00 Paris is still inside the 21:00–09:00 window');

  const later = canSend({ channel: 'sms', consent: express, now: new Date('2026-06-15T12:00:00Z'), timezone: 'Europe/Paris' });
  assert.equal(later.allowed, true, '14:00 Paris is fine');
});

test('quiet-hours window wraps midnight correctly', () => {
  const tz = 'UTC';
  assert.equal(inQuietHours(new Date('2026-06-15T22:00:00Z'), tz), true); // 22:00
  assert.equal(inQuietHours(new Date('2026-06-15T03:00:00Z'), tz), true); // 03:00
  assert.equal(inQuietHours(new Date('2026-06-15T12:00:00Z'), tz), false); // 12:00
  assert.equal(inQuietHours(new Date('2026-06-15T09:00:00Z'), tz), false); // exactly 09:00 is allowed
  assert.equal(inQuietHours(new Date('2026-06-15T21:00:00Z'), tz), true); // exactly 21:00 is quiet
});

test('an invalid timezone falls back instead of throwing', () => {
  assert.doesNotThrow(() => inQuietHours(new Date(), 'Not/AZone'));
});

test('a workspace can widen or disable quiet hours', () => {
  const at2am = new Date('2026-06-15T06:00:00Z');
  const disabled = canSend({
    channel: 'sms', consent: express, now: at2am, timezone: 'America/Toronto',
    quietHours: { startHour: 0, endHour: 0 },
  });
  assert.equal(disabled.allowed, true, 'startHour === endHour means no quiet window');
});

// --- opt-out detection -----------------------------------------------------

test('carrier opt-out keywords are recognised, in both languages', () => {
  for (const word of ['STOP', 'stop', ' Stop ', 'UNSUBSCRIBE', 'cancel', 'QUIT', 'arrêt', 'ARRETER', 'désabonner', 'stop all']) {
    assert.equal(isOptOutMessage(word), true, word);
  }
});

test('a sentence merely containing "stop" is NOT an opt-out', () => {
  assert.equal(isOptOutMessage('please do not stop sending me listings'), false);
  assert.equal(isOptOutMessage('can you stop by the condo tomorrow'), false);
});

test('ordinary replies are not opt-outs', () => {
  for (const body of ['yes please', 'sounds good', 'what time?', '', null]) {
    assert.equal(isOptOutMessage(body), false, String(body));
  }
});
