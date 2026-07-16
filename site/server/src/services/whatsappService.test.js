/**
 * whatsappService.test.js — F11 (QA): the pure WhatsApp helpers.
 *
 * Covers the 24-hour window check, template-variable substitution, the Twilio
 * Content → local template mapping, and approval-status normalisation. The
 * `send` / `syncTemplates` paths need a DB + the Twilio API and are exercised by
 * the F11.6 acceptance run, not here.
 *
 * Run from the server directory:
 *     node --test src/services/whatsappService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

require('../models'); // whatsappService requires the WhatsApp + SMS models transitively
const {
  isWindowOpen,
  buildContentVariables,
  renderTemplateBody,
  mapContentToTemplate,
  mapApprovalStatus,
  extractTemplateBody,
  WINDOW_MS,
} = require('./whatsappService');

test('isWindowOpen: open within 24h, closed beyond it (AC1/AC3)', () => {
  const now = 1_700_000_000_000;
  assert.equal(isWindowOpen(new Date(now - 1000), now), true); // just now
  assert.equal(isWindowOpen(new Date(now - (WINDOW_MS - 1000)), now), true); // 23h59m
  assert.equal(isWindowOpen(new Date(now - WINDOW_MS), now), true); // exactly 24h → still open
  assert.equal(isWindowOpen(new Date(now - (WINDOW_MS + 1000)), now), false); // 24h01s → closed
  assert.equal(isWindowOpen(null, now), false); // never replied
  assert.equal(isWindowOpen(undefined, now), false);
  assert.equal(isWindowOpen('not a date', now), false);
});

test('buildContentVariables: string-keys + stringifies values, drops blank keys', () => {
  assert.deepEqual(buildContentVariables({ 1: 'Acme', 2: 0 }), { 1: 'Acme', 2: '0' });
  assert.deepEqual(buildContentVariables({ name: 'Bob', '': 'x' }), { name: 'Bob' });
  assert.deepEqual(buildContentVariables({ a: null }), { a: '' });
  assert.deepEqual(buildContentVariables(null), {});
  assert.deepEqual(buildContentVariables(['a', 'b']), {}); // arrays ignored
});

test('renderTemplateBody: substitutes {{n}} / {{name}}, leaves unknowns intact (AC2)', () => {
  assert.equal(
    renderTemplateBody('Hi {{1}}, your viewing is {{2}}.', { 1: 'Sam', 2: 'Tuesday' }),
    'Hi Sam, your viewing is Tuesday.'
  );
  assert.equal(renderTemplateBody('Hi {{ name }}', { name: 'Sam' }), 'Hi Sam');
  // An unmatched placeholder is preserved (not blanked).
  assert.equal(renderTemplateBody('Hi {{1}} {{2}}', { 1: 'Sam' }), 'Hi Sam {{2}}');
  assert.equal(renderTemplateBody('', {}), '');
  assert.equal(renderTemplateBody('no vars', { 1: 'x' }), 'no vars');
});

test('mapApprovalStatus: collapses Twilio approval states to the enum', () => {
  assert.equal(mapApprovalStatus('approved'), 'approved');
  assert.equal(mapApprovalStatus('APPROVED'), 'approved');
  assert.equal(mapApprovalStatus('rejected'), 'rejected');
  assert.equal(mapApprovalStatus('received'), 'pending'); // anything else → pending
  assert.equal(mapApprovalStatus('pending'), 'pending');
  assert.equal(mapApprovalStatus(undefined), 'pending');
});

test('extractTemplateBody: first non-empty body across a Content `types` map', () => {
  assert.equal(
    extractTemplateBody({ 'twilio/text': { body: 'Hello {{1}}' } }),
    'Hello {{1}}'
  );
  assert.equal(
    extractTemplateBody({ 'twilio/media': { body: '' }, 'twilio/text': { body: 'Hi' } }),
    'Hi'
  );
  assert.equal(extractTemplateBody({}), '');
  assert.equal(extractTemplateBody(null), '');
});

test('mapContentToTemplate: maps a Twilio Content resource to the upsert shape', () => {
  const content = {
    sid: 'HX123',
    friendly_name: 'welcome_viewing',
    language: 'en',
    variables: { 1: 'name', 2: 'date' },
    types: { 'twilio/text': { body: 'Hi {{1}}, see you {{2}}' } },
  };
  const mapped = mapContentToTemplate(content, 'approved');
  assert.equal(mapped.providerTemplateId, 'HX123');
  assert.equal(mapped.name, 'welcome_viewing');
  assert.equal(mapped.language, 'en');
  assert.equal(mapped.body, 'Hi {{1}}, see you {{2}}');
  assert.deepEqual(mapped.variables, ['1', '2']);
  assert.equal(mapped.status, 'approved');
});

test('mapContentToTemplate: defaults language + tolerates missing variables', () => {
  const mapped = mapContentToTemplate({ sid: 'HX9', types: {} }, undefined);
  assert.equal(mapped.providerTemplateId, 'HX9');
  assert.equal(mapped.language, 'en');
  assert.equal(mapped.body, '');
  assert.deepEqual(mapped.variables, []);
  assert.equal(mapped.status, 'pending');
});
