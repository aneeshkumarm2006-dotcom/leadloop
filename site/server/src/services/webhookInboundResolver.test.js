/**
 * webhookInboundResolver.test.js — unit tests for the F7.3 mapping step.
 *
 * `applyMapping` is the pure core of inbound resolution: it turns a
 * `{ [columnId]: jsonPath }` mapping + a request body into the column values to
 * write, plus the list of paths that resolved to nothing (AC5). Tested in
 * isolation (no DB). Run from the server directory:
 *     node --test src/services/webhookInboundResolver.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

require('../models');
const { applyMapping } = require('./webhookInboundResolver');

test('AC1: maps nested + indexed paths onto column values', () => {
  const mapping = {
    colEmail: 'contact.email',
    colCity: 'city',
    colFirstTag: 'tags[0]',
  };
  const body = {
    contact: { email: 'jane@acme.co' },
    city: 'Edmonton',
    tags: ['vip', 'new'],
  };
  const { columnValues, missing } = applyMapping(mapping, body);
  assert.deepEqual(columnValues, {
    colEmail: 'jane@acme.co',
    colCity: 'Edmonton',
    colFirstTag: 'vip',
  });
  assert.equal(missing.length, 0);
});

test('AC5: a path that resolves to nothing is reported missing and left unset', () => {
  const mapping = {
    colEmail: 'contact.email',
    colPhone: 'contact.phone', // not present in the body
  };
  const body = { contact: { email: 'jane@acme.co' } };
  const { columnValues, missing } = applyMapping(mapping, body);
  assert.deepEqual(columnValues, { colEmail: 'jane@acme.co' }); // phone left unset
  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0], { columnId: 'colPhone', missingPath: 'contact.phone' });
});

test('falsy-but-present values (0, false, "") are mapped, not treated as missing', () => {
  const mapping = { colScore: 'score', colOptIn: 'optIn', colNote: 'note' };
  const body = { score: 0, optIn: false, note: '' };
  const { columnValues, missing } = applyMapping(mapping, body);
  assert.deepEqual(columnValues, { colScore: 0, colOptIn: false, colNote: '' });
  assert.equal(missing.length, 0);
});

test('empty mapping → no column values, no missing', () => {
  const { columnValues, missing } = applyMapping({}, { anything: 1 });
  assert.deepEqual(columnValues, {});
  assert.equal(missing.length, 0);
});
