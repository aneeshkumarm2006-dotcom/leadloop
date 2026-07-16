/**
 * formSubmissionService.test.js — F13.2 unit coverage for the pure helpers:
 * payload validation, legacy-board mapping (AC5), value coercion, and the
 * option label→id resolution that lets a public form (which shows labels) map
 * onto option-id-based columns.
 *
 *     node --test src/services/formSubmissionService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

require('../models'); // register models (the service requires them transitively)
const {
  validatePayload,
  mapToLegacyFields,
  coerceValue,
  resolveValueForColumn,
} = require('./formSubmissionService');

// --------------------------------------------------------------------------
// coerceValue
// --------------------------------------------------------------------------
test('coerceValue: number coerces, checkbox truthiness, text trims', () => {
  assert.equal(coerceValue('number', '42'), 42);
  assert.equal(coerceValue('number', 'nope'), '');
  assert.equal(coerceValue('checkbox', 'true'), true);
  assert.equal(coerceValue('checkbox', 'on'), true);
  assert.equal(coerceValue('checkbox', false), false);
  assert.equal(coerceValue('text', '  hi  '), 'hi');
});

// --------------------------------------------------------------------------
// validatePayload — required fields + coercion
// --------------------------------------------------------------------------
const form = {
  fieldMap: [
    { formFieldId: 'name', label: 'Name', type: 'text', required: true },
    { formFieldId: 'email', label: 'Email', type: 'email', required: true },
    { formFieldId: 'city', label: 'City', type: 'text', required: false },
  ],
};

test('validatePayload: collects coerced values, flags missing required (AC1)', () => {
  const { values, missingRequired } = validatePayload(form, {
    name: '  Ada  ',
    email: 'ada@example.com',
    city: 'Edmonton',
  });
  assert.equal(missingRequired.length, 0);
  assert.equal(values.name, 'Ada');
  assert.equal(values.city, 'Edmonton');
});

test('validatePayload: a blank required field is reported', () => {
  const { missingRequired } = validatePayload(form, { name: 'Ada', email: '   ' });
  assert.deepEqual(missingRequired, ['Email']);
});

// --------------------------------------------------------------------------
// mapToLegacyFields — AC5 (legacy board → name/note)
// --------------------------------------------------------------------------
test('mapToLegacyFields: name from a name-like field, note compiles the rest', () => {
  const { name, note } = mapToLegacyFields(form, { name: 'Ada Lovelace', email: 'ada@x.com', city: 'Regina' });
  assert.equal(name, 'Ada Lovelace');
  assert.match(note, /Email: ada@x\.com/);
  assert.match(note, /City: Regina/);
});

test('mapToLegacyFields: falls back to the first filled value when no name field', () => {
  const f = { fieldMap: [{ formFieldId: 'q1', label: 'Question', type: 'text' }] };
  const { name } = mapToLegacyFields(f, { q1: 'Hello there' });
  assert.equal(name, 'Hello there');
});

// --------------------------------------------------------------------------
// resolveValueForColumn — label/id → canonical option id
// --------------------------------------------------------------------------
const board = {
  columns: [
    { _id: 'col_stage', type: 'status', settings: { options: [{ id: 'new', label: 'New' }, { id: 'qualified', label: 'Qualified' }] } },
    { _id: 'col_tags', type: 'tags', settings: { options: [{ id: 'hot', label: 'Hot' }, { id: 'vip', label: 'VIP' }] } },
    { _id: 'col_name', type: 'text', settings: {} },
  ],
};

test('resolveValueForColumn: status label resolves to its option id', () => {
  assert.equal(resolveValueForColumn(board, 'col_stage', 'Qualified'), 'qualified');
  assert.equal(resolveValueForColumn(board, 'col_stage', 'qualified'), 'qualified'); // id passes through
});

test('resolveValueForColumn: an unmatched option value is returned as-is (will warn, not silently drop)', () => {
  assert.equal(resolveValueForColumn(board, 'col_stage', 'Bogus'), 'Bogus');
});

test('resolveValueForColumn: tags maps a comma list of labels to ids', () => {
  assert.deepEqual(resolveValueForColumn(board, 'col_tags', 'Hot, VIP'), ['hot', 'vip']);
});

test('resolveValueForColumn: a non-option column passes the value through unchanged', () => {
  assert.equal(resolveValueForColumn(board, 'col_name', 'Ada'), 'Ada');
});
