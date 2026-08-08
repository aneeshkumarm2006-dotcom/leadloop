/**
 * sourceAdapters.test.js — unit tests for the lead-source payload normalisers.
 * Pure functions, no DB. Run from the server directory:
 *     node --test src/services/sourceAdapters.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SOURCE_TYPES,
  isValidSourceType,
  normalizeSourcePayload,
} = require('./sourceAdapters');

test('isValidSourceType: known vs unknown', () => {
  assert.equal(isValidSourceType('google_ads'), true);
  assert.equal(isValidSourceType('website'), true);
  assert.equal(isValidSourceType('nope'), false);
  assert.equal(isValidSourceType(''), false);
  assert.equal(isValidSourceType(undefined), false);
});

test('passthrough: a flat website/zapier body is returned unchanged', () => {
  const body = { full_name: 'Jane Doe', email: 'jane@acme.co' };
  assert.deepEqual(normalizeSourcePayload('website', body), body);
  assert.deepEqual(normalizeSourcePayload('zapier', body), body);
});

test('google_ads: user_column_data is flattened, google_key dropped', () => {
  const body = {
    lead_id: 'L123',
    campaign_id: 'C9',
    google_key: 'shhh-secret',
    user_column_data: [
      { column_id: 'FULL_NAME', column_name: 'Full Name', string_value: 'Jane Doe' },
      { column_id: 'EMAIL', column_name: 'Email', string_value: 'jane@acme.co' },
      { column_id: 'PHONE_NUMBER', column_name: 'Phone', string_value: '+15145551234' },
    ],
  };
  const out = normalizeSourcePayload('google_ads', body);
  assert.equal(out['Full Name'], 'Jane Doe');
  assert.equal(out.Email, 'jane@acme.co');
  assert.equal(out.Phone, '+15145551234');
  assert.equal(out.campaign_id, 'C9');
  assert.equal(out.lead_id, 'L123');
  assert.ok(!('google_key' in out), 'verification secret must never become a field');
});

test('google_ads: falls back to column_id when column_name is absent', () => {
  const out = normalizeSourcePayload('google_ads', {
    user_column_data: [{ column_id: 'EMAIL', string_value: 'x@y.co' }],
  });
  assert.equal(out.EMAIL, 'x@y.co');
});

test('facebook: field_data array is flattened to first value', () => {
  const body = {
    form_id: 'F1',
    field_data: [
      { name: 'full_name', values: ['Jane Doe'] },
      { name: 'email', values: ['jane@acme.co'] },
    ],
  };
  const out = normalizeSourcePayload('facebook_lead_ads', body);
  assert.equal(out.full_name, 'Jane Doe');
  assert.equal(out.email, 'jane@acme.co');
  assert.equal(out.form_id, 'F1');
});

test('mismatched shape degrades to passthrough (no data loss)', () => {
  // Labelled google_ads but body is a plain flat form → returned unchanged.
  const body = { email: 'x@y.co' };
  assert.deepEqual(normalizeSourcePayload('google_ads', body), body);
});

test('non-object bodies are returned as-is', () => {
  assert.equal(normalizeSourcePayload('website', null), null);
  assert.equal(normalizeSourcePayload('website', 'nope'), 'nope');
});

test('every SOURCE_TYPES entry names a real adapter + delivery', () => {
  for (const [id, spec] of Object.entries(SOURCE_TYPES)) {
    assert.ok(['webhook', 'email', 'poll'].includes(spec.delivery), `${id} delivery`);
    assert.ok(['passthrough', 'google_ads', 'facebook'].includes(spec.adapter), `${id} adapter`);
    assert.equal(typeof spec.ready, 'boolean', `${id} ready`);
  }
});
