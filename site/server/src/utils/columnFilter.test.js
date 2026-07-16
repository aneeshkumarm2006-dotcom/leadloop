const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { matchesFilter, evaluateClause, getColumnValue } = require('./columnFilter');

// Helper: build a task whose columnValues is a Map (matches the Mongoose doc
// representation). We also test the plain-object (.lean) representation.
const taskWithMap = (entries) => ({ columnValues: new Map(Object.entries(entries)) });
const taskWithObj = (entries) => ({ columnValues: { ...entries } });

const STATUS = 'col_status';
const PERSON = 'col_person';
const TAGS = 'col_tags';
const DATE = 'col_date';
const NUM = 'col_number';

// --------------------------------------------------------------------------
// getColumnValue — Map vs plain object
// --------------------------------------------------------------------------
test('getColumnValue reads from a Map', () => {
  const cv = new Map([[STATUS, 'opt_new']]);
  assert.equal(getColumnValue(cv, STATUS), 'opt_new');
});

test('getColumnValue reads from a plain object', () => {
  assert.equal(getColumnValue({ [STATUS]: 'opt_new' }, STATUS), 'opt_new');
});

test('getColumnValue returns undefined for a missing column', () => {
  assert.equal(getColumnValue(new Map(), 'nope'), undefined);
  assert.equal(getColumnValue(undefined, 'nope'), undefined);
});

// --------------------------------------------------------------------------
// eq — status / option-id
// --------------------------------------------------------------------------
test('eq matches a status option id', () => {
  const t = taskWithMap({ [STATUS]: 'opt_qualified' });
  assert.equal(matchesFilter(t, [{ columnId: STATUS, op: 'eq', value: 'opt_qualified' }]), true);
});

test('eq rejects a different status option id', () => {
  const t = taskWithMap({ [STATUS]: 'opt_new' });
  assert.equal(matchesFilter(t, [{ columnId: STATUS, op: 'eq', value: 'opt_qualified' }]), false);
});

test('eq against an array value (tags) matches when the array contains it', () => {
  const t = taskWithObj({ [TAGS]: ['opt_hot', 'opt_vip'] });
  assert.equal(matchesFilter(t, [{ columnId: TAGS, op: 'eq', value: 'opt_vip' }]), true);
  assert.equal(matchesFilter(t, [{ columnId: TAGS, op: 'eq', value: 'opt_cold' }]), false);
});

// --------------------------------------------------------------------------
// in — person / multi-option
// --------------------------------------------------------------------------
test('in matches when a person id is among the allowed set', () => {
  const a = new mongoose.Types.ObjectId().toString();
  const b = new mongoose.Types.ObjectId().toString();
  const t = taskWithMap({ [PERSON]: [a] });
  assert.equal(matchesFilter(t, [{ columnId: PERSON, op: 'in', value: [a, b] }]), true);
});

test('in rejects when no person id intersects', () => {
  const a = new mongoose.Types.ObjectId().toString();
  const b = new mongoose.Types.ObjectId().toString();
  const c = new mongoose.Types.ObjectId().toString();
  const t = taskWithMap({ [PERSON]: [c] });
  assert.equal(matchesFilter(t, [{ columnId: PERSON, op: 'in', value: [a, b] }]), false);
});

test('in matches a scalar status against an allowed list', () => {
  const t = taskWithObj({ [STATUS]: 'opt_contacted' });
  assert.equal(
    matchesFilter(t, [{ columnId: STATUS, op: 'in', value: ['opt_new', 'opt_contacted'] }]),
    true
  );
});

// --------------------------------------------------------------------------
// between — dates
// --------------------------------------------------------------------------
test('between matches a date inside an inclusive range', () => {
  const t = taskWithObj({ [DATE]: '2026-06-15T00:00:00.000Z' });
  assert.equal(
    matchesFilter(t, [
      { columnId: DATE, op: 'between', value: ['2026-06-01', '2026-06-30'] },
    ]),
    true
  );
});

test('between rejects a date outside the range', () => {
  const t = taskWithObj({ [DATE]: '2026-07-15T00:00:00.000Z' });
  assert.equal(
    matchesFilter(t, [
      { columnId: DATE, op: 'between', value: ['2026-06-01', '2026-06-30'] },
    ]),
    false
  );
});

test('between supports a {from,to} object form', () => {
  const t = taskWithObj({ [DATE]: '2026-06-15T00:00:00.000Z' });
  assert.equal(
    matchesFilter(t, [
      { columnId: DATE, op: 'between', value: { from: '2026-06-01', to: '2026-06-30' } },
    ]),
    true
  );
});

// --------------------------------------------------------------------------
// between — numbers
// --------------------------------------------------------------------------
test('between matches a number inside the range', () => {
  const t = taskWithObj({ [NUM]: 600000 });
  assert.equal(matchesFilter(t, [{ columnId: NUM, op: 'between', value: [500000, 700000] }]), true);
});

test('between rejects a number below the range', () => {
  const t = taskWithObj({ [NUM]: 400000 });
  assert.equal(matchesFilter(t, [{ columnId: NUM, op: 'between', value: [500000, 700000] }]), false);
});

test('between supports an open-ended upper bound', () => {
  const t = taskWithObj({ [NUM]: 900000 });
  assert.equal(matchesFilter(t, [{ columnId: NUM, op: 'between', value: [500000, null] }]), true);
});

// --------------------------------------------------------------------------
// missing-column behaviour (F12.1 QA — deleted column → no match, no throw)
// --------------------------------------------------------------------------
test('a filter referencing a deleted/absent column resolves to no match (not a throw)', () => {
  const t = taskWithMap({ [STATUS]: 'opt_new' });
  assert.doesNotThrow(() => {
    matchesFilter(t, [{ columnId: 'col_deleted', op: 'eq', value: 'whatever' }]);
  });
  assert.equal(matchesFilter(t, [{ columnId: 'col_deleted', op: 'eq', value: 'x' }]), false);
  assert.equal(matchesFilter(t, [{ columnId: 'col_deleted', op: 'in', value: ['x'] }]), false);
  assert.equal(
    matchesFilter(t, [{ columnId: 'col_deleted', op: 'between', value: [1, 5] }]),
    false
  );
});

// --------------------------------------------------------------------------
// AND combination + empty filter
// --------------------------------------------------------------------------
test('multiple clauses AND together', () => {
  const a = new mongoose.Types.ObjectId().toString();
  const t = taskWithObj({ [STATUS]: 'opt_qualified', [PERSON]: [a], [NUM]: 600000 });
  const filter = [
    { columnId: STATUS, op: 'eq', value: 'opt_qualified' },
    { columnId: PERSON, op: 'in', value: [a] },
    { columnId: NUM, op: 'between', value: [500000, 700000] },
  ];
  assert.equal(matchesFilter(t, filter), true);

  // Flip one clause → whole filter fails.
  const filter2 = [...filter, { columnId: STATUS, op: 'eq', value: 'opt_new' }];
  assert.equal(matchesFilter(t, filter2), false);
});

test('an empty or non-array filter matches everything', () => {
  const t = taskWithObj({ [STATUS]: 'opt_new' });
  assert.equal(matchesFilter(t, []), true);
  assert.equal(matchesFilter(t, null), true);
  assert.equal(matchesFilter(t, undefined), true);
});

test('a malformed clause (no columnId / bad op) is ignored, not fatal', () => {
  const t = taskWithObj({ [STATUS]: 'opt_new' });
  assert.equal(evaluateClause(t.columnValues, { op: 'eq', value: 'x' }), true); // no columnId → ignored
  assert.equal(evaluateClause(t.columnValues, { columnId: STATUS, op: 'weird', value: 'x' }), true);
});
