/**
 * twilioSignature.test.js — F10.4 (QA): Twilio signature validation.
 *
 * Verifies the round-trip (a freshly-signed request validates), and that
 * tampering with the URL, a param, the token, or the signature itself fails.
 * Pure — no DB / network. Run from the server directory:
 *     node --test src/utils/twilioSignature.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { expectedSignature, verify } = require('./twilioSignature');

const TOKEN = 'test_auth_token_abcdef0123456789';
const URL = 'https://crm.example.com/api/sms/inbound';
const PARAMS = {
  AccountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  From: '+15551234567',
  To: '+15557654321',
  Body: 'STOP',
  MessageSid: 'SM0123456789',
};

test('round-trip: a freshly-signed request verifies', () => {
  const sig = expectedSignature(TOKEN, URL, PARAMS);
  assert.equal(verify(TOKEN, sig, URL, PARAMS), true);
});

test('param order does not matter (server sorts keys)', () => {
  const sig = expectedSignature(TOKEN, URL, PARAMS);
  const reordered = {
    To: PARAMS.To,
    Body: PARAMS.Body,
    AccountSid: PARAMS.AccountSid,
    MessageSid: PARAMS.MessageSid,
    From: PARAMS.From,
  };
  assert.equal(verify(TOKEN, sig, URL, reordered), true);
});

test('tampered body fails', () => {
  const sig = expectedSignature(TOKEN, URL, PARAMS);
  assert.equal(verify(TOKEN, sig, URL, { ...PARAMS, Body: 'START' }), false);
});

test('tampered URL fails', () => {
  const sig = expectedSignature(TOKEN, URL, PARAMS);
  assert.equal(verify(TOKEN, sig, 'https://evil.example.com/api/sms/inbound', PARAMS), false);
});

test('wrong token fails', () => {
  const sig = expectedSignature(TOKEN, URL, PARAMS);
  assert.equal(verify('another_token', sig, URL, PARAMS), false);
});

test('missing / malformed signature returns false (never throws)', () => {
  assert.equal(verify(TOKEN, '', URL, PARAMS), false);
  assert.equal(verify(TOKEN, undefined, URL, PARAMS), false);
  assert.equal(verify('', 'x', URL, PARAMS), false);
  assert.equal(verify(TOKEN, 'not-the-signature', URL, PARAMS), false);
});

test('no-params request still signs over the bare URL', () => {
  const sig = expectedSignature(TOKEN, URL, {});
  assert.equal(verify(TOKEN, sig, URL, {}), true);
  assert.equal(verify(TOKEN, sig, URL, { extra: '1' }), false);
});
