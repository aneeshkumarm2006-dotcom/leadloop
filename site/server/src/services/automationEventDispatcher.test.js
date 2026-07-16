/**
 * automationEventDispatcher.test.js — unit tests for the F4 triggerConfig
 * matchers (AC#1 STATUS_BECAME, plus COLUMN_VALUE_CHANGED / PERSON_ASSIGNED /
 * dormant matchers). Pure matching logic — no DB needed.
 *
 * Run from the server directory:
 *     node --test src/services/automationEventDispatcher.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Models must be registered before requiring the dispatcher (it pulls in the
// controller, which requires the Mongoose models).
require('../models');

const { TRIGGER_MATCHERS } = require('./automationEventDispatcher');

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// COLUMN_VALUE_CHANGED
// ---------------------------------------------------------------------------
test('COLUMN_VALUE_CHANGED: empty config matches any column', () => {
  const m = TRIGGER_MATCHERS.COLUMN_VALUE_CHANGED;
  assert.equal(m({}, { columnId: oid() }), true);
  assert.equal(m({ columnId: '' }, { columnId: oid() }), true);
});

test('COLUMN_VALUE_CHANGED: configured column must equal the event column', () => {
  const m = TRIGGER_MATCHERS.COLUMN_VALUE_CHANGED;
  const col = oid();
  assert.equal(m({ columnId: col.toString() }, { columnId: col }), true);
  assert.equal(m({ columnId: col.toString() }, { columnId: oid() }), false);
});

// ---------------------------------------------------------------------------
// STATUS_BECAME — AC#1
// ---------------------------------------------------------------------------
test('STATUS_BECAME: AC#1 — matches columnId + toValue (ids)', () => {
  const m = TRIGGER_MATCHERS.STATUS_BECAME;
  const stageCol = oid();
  const cfg = { columnId: stageCol.toString(), toValue: 'viewing_scheduled' };
  // "Qualified" → "Viewing Scheduled"
  assert.equal(
    m(cfg, { columnId: stageCol, fromValue: 'qualified', toValue: 'viewing_scheduled' }),
    true
  );
  // wrong destination value
  assert.equal(
    m(cfg, { columnId: stageCol, fromValue: 'qualified', toValue: 'closed' }),
    false
  );
  // wrong column
  assert.equal(
    m(cfg, { columnId: oid(), toValue: 'viewing_scheduled' }),
    false
  );
});

test('STATUS_BECAME: fromValue, when configured, must also match', () => {
  const m = TRIGGER_MATCHERS.STATUS_BECAME;
  const stageCol = oid();
  const cfg = {
    columnId: stageCol.toString(),
    fromValue: 'qualified',
    toValue: 'viewing_scheduled',
  };
  assert.equal(
    m(cfg, { columnId: stageCol, fromValue: 'qualified', toValue: 'viewing_scheduled' }),
    true
  );
  assert.equal(
    m(cfg, { columnId: stageCol, fromValue: 'contacted', toValue: 'viewing_scheduled' }),
    false
  );
});

// ---------------------------------------------------------------------------
// PERSON_ASSIGNED
// ---------------------------------------------------------------------------
test('PERSON_ASSIGNED: matches column; userId (if set) must be in addedUserIds', () => {
  const m = TRIGGER_MATCHERS.PERSON_ASSIGNED;
  const personCol = oid();
  const u1 = oid();
  const u2 = oid();
  // no userId → any assignment on the column fires
  assert.equal(m({ columnId: personCol.toString() }, { columnId: personCol, addedUserIds: [u1] }), true);
  // specific user present
  assert.equal(
    m({ columnId: personCol.toString(), userId: u1.toString() }, { columnId: personCol, addedUserIds: [u1, u2] }),
    true
  );
  // specific user absent
  assert.equal(
    m({ columnId: personCol.toString(), userId: u1.toString() }, { columnId: personCol, addedUserIds: [u2] }),
    false
  );
});

// ---------------------------------------------------------------------------
// CHECKBOX_CHECKED (Phase 1b)
// ---------------------------------------------------------------------------
test('CHECKBOX_CHECKED: fires only on the watched column when newly truthy', () => {
  const m = TRIGGER_MATCHERS.CHECKBOX_CHECKED;
  const col = oid();
  assert.equal(m({ columnId: col.toString() }, { columnId: col, toValue: true }), true);
  assert.equal(m({ columnId: col.toString() }, { columnId: col, toValue: 'true' }), true);
  // unchecked / falsy → no fire
  assert.equal(m({ columnId: col.toString() }, { columnId: col, toValue: false }), false);
  assert.equal(m({ columnId: col.toString() }, { columnId: col, toValue: null }), false);
  // wrong column → no fire
  assert.equal(m({ columnId: col.toString() }, { columnId: oid(), toValue: true }), false);
});

// ---------------------------------------------------------------------------
// NUMBER_CROSSED (Phase 1b)
// ---------------------------------------------------------------------------
test('NUMBER_CROSSED: rising crosses the threshold only on the upward transition', () => {
  const m = TRIGGER_MATCHERS.NUMBER_CROSSED;
  const col = oid();
  const cfg = { columnId: col.toString(), threshold: 100, direction: 'above' };
  // 80 → 120 crosses up
  assert.equal(m(cfg, { columnId: col, fromValue: 80, toValue: 120 }), true);
  // 120 → 130 already above, no crossing
  assert.equal(m(cfg, { columnId: col, fromValue: 120, toValue: 130 }), false);
  // exactly at threshold counts as crossed
  assert.equal(m(cfg, { columnId: col, fromValue: 80, toValue: 100 }), true);
  // falling does not fire an 'above' trigger
  assert.equal(m(cfg, { columnId: col, fromValue: 130, toValue: 90 }), false);
});

test('NUMBER_CROSSED: falling direction fires on the downward transition', () => {
  const m = TRIGGER_MATCHERS.NUMBER_CROSSED;
  const col = oid();
  const cfg = { columnId: col.toString(), threshold: 50, direction: 'below' };
  assert.equal(m(cfg, { columnId: col, fromValue: 80, toValue: 40 }), true);
  assert.equal(m(cfg, { columnId: col, fromValue: 40, toValue: 30 }), false); // already below
  assert.equal(m(cfg, { columnId: col, fromValue: 30, toValue: 80 }), false); // rising
});

// ---------------------------------------------------------------------------
// ITEM_MOVED_TO_GROUP / UPDATE_POSTED (Phase 1b)
// ---------------------------------------------------------------------------
test('ITEM_MOVED_TO_GROUP: empty config matches any destination; set must equal', () => {
  const m = TRIGGER_MATCHERS.ITEM_MOVED_TO_GROUP;
  const g = oid();
  assert.equal(m({}, { toGroupId: oid() }), true);
  assert.equal(m({ groupId: g.toString() }, { toGroupId: g }), true);
  assert.equal(m({ groupId: g.toString() }, { toGroupId: oid() }), false);
});

test('UPDATE_POSTED: always matches (no config)', () => {
  const m = TRIGGER_MATCHERS.UPDATE_POSTED;
  assert.equal(m({}, { taskId: oid() }), true);
  assert.equal(m(undefined, {}), true);
});

// ---------------------------------------------------------------------------
// Dormant matchers (FORM_SUBMITTED / WEBHOOK_RECEIVED)
// ---------------------------------------------------------------------------
test('FORM_SUBMITTED / WEBHOOK_RECEIVED: empty config matches; set id must equal', () => {
  const f = TRIGGER_MATCHERS.FORM_SUBMITTED;
  const w = TRIGGER_MATCHERS.WEBHOOK_RECEIVED;
  assert.equal(f({}, { formId: 'abc' }), true);
  assert.equal(f({ formId: 'abc' }, { formId: 'abc' }), true);
  assert.equal(f({ formId: 'abc' }, { formId: 'xyz' }), false);
  assert.equal(w({}, { endpointId: 'e1' }), true);
  assert.equal(w({ endpointId: 'e1' }, { endpointId: 'e1' }), true);
  assert.equal(w({ endpointId: 'e1' }, { endpointId: 'e2' }), false);
});
