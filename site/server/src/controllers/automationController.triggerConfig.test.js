/**
 * automationController.triggerConfig.test.js — unit tests for
 * `sanitizeTriggerConfig`, focused on the DATE_ARRIVED comparison-sign
 * normalization added to fix the "comparison ignored by the runner" finding.
 *
 * Run from the server directory:
 *     node --test src/controllers/automationController.triggerConfig.test.js
 *
 * `sanitizeTriggerConfig` is pure (triggerType, rawConfig, board) — no DB — so
 * we pass a hand-built board fixture. Requiring the controller registers models
 * but opens no connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeTriggerConfig } = require('./automationController');

// Minimal board fixture: a date column and a status column with options.
const board = {
  columns: [
    { _id: 'date_col', type: 'date', settings: {} },
    {
      _id: 'stage_col',
      type: 'status',
      settings: { options: [{ id: 'qualified' }, { id: 'viewing_scheduled' }] },
    },
    { _id: 'owner_col', type: 'person', settings: {} },
  ],
};

// ---------------------------------------------------------------------------
// DATE_ARRIVED — comparison folds into the sign of the stored offset
// ---------------------------------------------------------------------------
test("DATE_ARRIVED 'before' stores a negative offset regardless of input sign", () => {
  const a = sanitizeTriggerConfig('DATE_ARRIVED', { columnId: 'date_col', offsetDays: 7, comparison: 'before' }, board);
  assert.equal(a.config.offsetDays, -7);
  const b = sanitizeTriggerConfig('DATE_ARRIVED', { columnId: 'date_col', offsetDays: -7, comparison: 'before' }, board);
  assert.equal(b.config.offsetDays, -7); // AC2 default shape stays -7
});

test("DATE_ARRIVED 'after' stores a positive offset regardless of input sign", () => {
  const a = sanitizeTriggerConfig('DATE_ARRIVED', { columnId: 'date_col', offsetDays: 3, comparison: 'after' }, board);
  assert.equal(a.config.offsetDays, 3);
  const b = sanitizeTriggerConfig('DATE_ARRIVED', { columnId: 'date_col', offsetDays: -3, comparison: 'after' }, board);
  assert.equal(b.config.offsetDays, 3);
});

test("DATE_ARRIVED 'on' preserves the signed offset", () => {
  const a = sanitizeTriggerConfig('DATE_ARRIVED', { columnId: 'date_col', offsetDays: -7, comparison: 'on' }, board);
  assert.equal(a.config.offsetDays, -7);
  const b = sanitizeTriggerConfig('DATE_ARRIVED', { columnId: 'date_col', offsetDays: 0, comparison: 'on' }, board);
  assert.equal(b.config.offsetDays, 0);
});

test('DATE_ARRIVED defaults comparison to on and keeps the offset', () => {
  const r = sanitizeTriggerConfig('DATE_ARRIVED', { columnId: 'date_col', offsetDays: 2 }, board);
  assert.equal(r.config.comparison, 'on');
  assert.equal(r.config.offsetDays, 2);
});

test('DATE_ARRIVED rejects a non-date column and a non-integer offset', () => {
  assert.ok(sanitizeTriggerConfig('DATE_ARRIVED', { columnId: 'stage_col', offsetDays: 1, comparison: 'on' }, board).error);
  assert.ok(sanitizeTriggerConfig('DATE_ARRIVED', { columnId: 'date_col', offsetDays: 1.5, comparison: 'on' }, board).error);
  assert.ok(sanitizeTriggerConfig('DATE_ARRIVED', { columnId: 'date_col', offsetDays: 1, comparison: 'sideways' }, board).error);
});

// ---------------------------------------------------------------------------
// STATUS_BECAME — sanity that option-id validation still holds (AC1 shape)
// ---------------------------------------------------------------------------
test('STATUS_BECAME accepts a valid option id and rejects an unknown one', () => {
  const ok = sanitizeTriggerConfig('STATUS_BECAME', { columnId: 'stage_col', toValue: 'viewing_scheduled' }, board);
  assert.equal(ok.config.columnId, 'stage_col');
  assert.equal(ok.config.toValue, 'viewing_scheduled');
  assert.ok(sanitizeTriggerConfig('STATUS_BECAME', { columnId: 'stage_col', toValue: 'nope' }, board).error);
  assert.ok(sanitizeTriggerConfig('STATUS_BECAME', { columnId: 'date_col', toValue: 'qualified' }, board).error);
});

// ---------------------------------------------------------------------------
// COLUMN_VALUE_CHANGED — optional columnId
// ---------------------------------------------------------------------------
test('COLUMN_VALUE_CHANGED allows an empty config (any column)', () => {
  const r = sanitizeTriggerConfig('COLUMN_VALUE_CHANGED', {}, board);
  assert.deepEqual(r.config, {});
});
