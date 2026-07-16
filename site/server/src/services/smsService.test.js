/**
 * smsService.test.js — F10 (QA): the pure SMS helpers.
 *
 * Covers E.164 normalisation, tolerant phone matching, STOP/START keyword
 * classification, and Twilio→local status mapping. The `send` path needs a DB +
 * the Twilio API and is exercised by the F10.7 acceptance run, not here.
 *
 * Run from the server directory:
 *     node --test src/services/smsService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

require('../models'); // smsService requires the SMS models transitively
const {
  toE164,
  isValidE164,
  phonesMatch,
  phoneKey,
  classifyKeyword,
  mapTwilioStatus,
} = require('./smsService');

test('toE164: normalises common formats', () => {
  assert.equal(toE164('5551234567'), '+15551234567'); // bare NANP 10-digit
  assert.equal(toE164('(555) 123-4567'), '+15551234567'); // formatted NANP
  assert.equal(toE164('15551234567'), '+15551234567'); // 11-digit w/ country
  assert.equal(toE164('+1 555 123 4567'), '+15551234567'); // already E.164
  assert.equal(toE164('+447911123456'), '+447911123456'); // UK, untouched
  assert.equal(toE164(''), '');
  assert.equal(toE164(null), '');
  assert.equal(toE164('not a phone'), '');
});

test('isValidE164: accepts plausible numbers, rejects junk', () => {
  assert.equal(isValidE164('+15551234567'), true);
  assert.equal(isValidE164('+447911123456'), true);
  assert.equal(isValidE164('5551234567'), false); // no +
  assert.equal(isValidE164('+123'), false); // too short
  assert.equal(isValidE164(''), false);
});

test('phonesMatch: tolerant across formats, false on different lines', () => {
  assert.equal(phonesMatch('+15551234567', '(555) 123-4567'), true);
  assert.equal(phonesMatch('5551234567', '+1 555 123 4567'), true);
  assert.equal(phonesMatch('+15551234567', '+15559999999'), false);
  assert.equal(phonesMatch('', '+15551234567'), false);
});

test('phoneKey: international + national formats collapse to one opt-out key (AC2)', () => {
  // The opt-out gate keys on phoneKey (last-10 digits) so a STOP from a Twilio
  // E.164 number blocks a send to the same line stored in national format —
  // even though toE164 only canonicalises NANP numbers.
  const fromIntl = phoneKey('+447911123456'); // Twilio STOP From
  const storedNational = phoneKey('07911 123456'); // lead's phone column value
  const mangledE164 = phoneKey(toE164('07911 123456')); // '+07911123456'
  assert.equal(fromIntl, storedNational);
  assert.equal(fromIntl, mangledE164);
  // A different line must NOT collide.
  assert.notEqual(fromIntl, phoneKey('+447900000000'));
});

test('classifyKeyword: STOP / START families, else null', () => {
  assert.equal(classifyKeyword('STOP'), 'stop');
  assert.equal(classifyKeyword('  stop  '), 'stop');
  assert.equal(classifyKeyword('UNSUBSCRIBE'), 'stop');
  assert.equal(classifyKeyword('Stopall'), 'stop');
  assert.equal(classifyKeyword('START'), 'start');
  assert.equal(classifyKeyword('unstop'), 'start');
  assert.equal(classifyKeyword('Hello there'), null);
  assert.equal(classifyKeyword('stop it please'), null); // not a bare keyword
});

test('mapTwilioStatus: collapses Twilio statuses to the enum', () => {
  assert.equal(mapTwilioStatus('queued'), 'queued');
  assert.equal(mapTwilioStatus('accepted'), 'queued');
  assert.equal(mapTwilioStatus('sending'), 'queued');
  assert.equal(mapTwilioStatus('sent'), 'sent');
  assert.equal(mapTwilioStatus('delivered'), 'delivered');
  assert.equal(mapTwilioStatus('undelivered'), 'failed');
  assert.equal(mapTwilioStatus('failed'), 'failed');
  assert.equal(mapTwilioStatus('received'), 'received');
  assert.equal(mapTwilioStatus(undefined), 'queued');
});
