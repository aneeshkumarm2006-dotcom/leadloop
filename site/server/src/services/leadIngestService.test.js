/**
 * leadIngestService.test.js — unit tests for the F14 provisioning + coercion
 * logic. Exercises `provisionColumnsFromSchema` against a lightweight fake board
 * (a plain object with a stubbed `save()`), so it runs without a live DB. Run
 * from the server directory:
 *     node --test src/services/leadIngestService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

require('../models'); // register models (the service requires them transitively)
const { inferSchema, MAX_FIELDS } = require('../utils/schemaInference');
const {
  provisionColumnsFromSchema,
  coerceForColumn,
  pickUnseenFields,
  withConnectionLock,
} = require('./leadIngestService');

/** A fake mongoose board: array columns + a no-op async save. */
const fakeBoard = (columns = []) => ({
  _id: 'board1',
  useFlexibleColumns: columns.length > 0,
  columns,
  saved: false,
  async save() {
    this.saved = true;
  },
});

test('empty board: provisions columns, sets exactly one primary, adds Source', async () => {
  const board = fakeBoard([]);
  const inferred = inferSchema({ full_name: 'Jane', email: 'jane@acme.co' });
  const conn = { attributeSource: true, sourceTag: '', name: 'Website form' };

  const { fieldMap } = await provisionColumnsFromSchema(board, inferred, conn);

  assert.equal(board.useFlexibleColumns, true, 'flexible columns turned on');
  assert.equal(board.saved, true, 'board was saved');

  const primaries = board.columns.filter((c) => c.isPrimary);
  assert.equal(primaries.length, 1, 'exactly one primary');
  assert.equal(primaries[0].key, 'full_name', 'the inferred primary key is the title column');

  const keys = board.columns.map((c) => c.key).sort();
  assert.deepEqual(keys, ['email', 'full_name', 'source'], 'name + email + attribution column');

  assert.deepEqual(
    fieldMap.map((f) => [f.sourceKey, f.columnKey, f.type]),
    [
      ['full_name', 'full_name', 'text'],
      ['email', 'email', 'email'],
    ]
  );
});

test('existing board: reuses matching columns, never adds a second primary', async () => {
  const board = fakeBoard([
    { _id: 'c0', key: 'name', name: 'Name', type: 'text', order: 0, isPrimary: true, settings: {} },
  ]);
  const inferred = inferSchema({ name: 'Jane', email: 'jane@acme.co' });
  const conn = { attributeSource: true, sourceTag: 'Website', name: 'Web' };

  const { fieldMap } = await provisionColumnsFromSchema(board, inferred, conn);

  // 'name' reused (slug matches) — not duplicated, primary unchanged.
  assert.equal(board.columns.filter((c) => c.key === 'name').length, 1, 'name column not duplicated');
  const primaries = board.columns.filter((c) => c.isPrimary);
  assert.equal(primaries.length, 1, 'still exactly one primary');
  assert.equal(primaries[0].key, 'name', 'the existing primary is preserved');

  const emailCol = board.columns.find((c) => c.key === 'email');
  assert.ok(emailCol && emailCol.isPrimary === false, 'new email column is non-primary');

  assert.deepEqual(
    fieldMap.map((f) => f.columnKey),
    ['name', 'email'],
    'field map points name→name (reused) and email→email (new)'
  );
});

test('attributeSource=false: no Source column is added', async () => {
  const board = fakeBoard([]);
  const inferred = inferSchema({ email: 'jane@acme.co' });
  const { fieldMap } = await provisionColumnsFromSchema(board, inferred, { attributeSource: false, name: 'X' });
  assert.equal(board.columns.some((c) => c.key === 'source'), false, 'no source column');
  assert.equal(fieldMap.length, 1);
});

test('coerceForColumn: checkbox strings and long_text objects are normalised', () => {
  assert.equal(coerceForColumn({ type: 'checkbox' }, 'on'), true);
  assert.equal(coerceForColumn({ type: 'checkbox' }, 'true'), true);
  assert.equal(coerceForColumn({ type: 'checkbox' }, '1'), true);
  assert.equal(coerceForColumn({ type: 'checkbox' }, 'false'), false);
  assert.equal(coerceForColumn({ type: 'checkbox' }, true), true);
  assert.equal(coerceForColumn({ type: 'long_text' }, { a: 1 }), '{"a":1}');
  assert.equal(coerceForColumn({ type: 'text' }, 'hello'), 'hello');
});

// --- Schema evolution --------------------------------------------------------

test('pickUnseenFields: only new, non-ignored, non-underscore keys are selected', () => {
  const fieldMap = [
    { sourceKey: 'name', columnKey: 'name' },
    { sourceKey: 'email', columnKey: 'email' },
  ];
  const { unseen, warnings } = pickUnseenFields(fieldMap, {
    name: 'Jane', //           known → skipped
    email: 'j@a.co', //        known → skipped
    budget: '5000', //         NEW → selected
    _redirect: 'https://x.y', // underscore control key → skipped
    'g-recaptcha-response': 'tok', // IGNORED_KEYS → skipped
    '': 'empty key', //        unnormalisable → skipped
  });
  assert.deepEqual(unseen, { budget: '5000' });
  assert.deepEqual(warnings, []);
});

test('pickUnseenFields: the field cap is cumulative and warns, never silently drops', () => {
  const fullMap = Array.from({ length: MAX_FIELDS }, (_, i) => ({
    sourceKey: `f${i}`,
    columnKey: `f${i}`,
  }));
  const { unseen, warnings } = pickUnseenFields(fullMap, { extra_field: 'x' });
  assert.deepEqual(unseen, {}, 'no room left — nothing selected');
  assert.deepEqual(warnings, [{ reason: 'field_cap_reached', key: 'extra_field' }]);

  // One slot left → first new key fits, second warns.
  const almostFull = fullMap.slice(0, MAX_FIELDS - 1);
  const r2 = pickUnseenFields(almostFull, { a_field: '1', b_field: '2' });
  assert.deepEqual(Object.keys(r2.unseen), ['a_field']);
  assert.deepEqual(r2.warnings, [{ reason: 'field_cap_reached', key: 'b_field' }]);
});

test('evolution provisioning: appends a non-primary column to an already-provisioned board', async () => {
  // Board as it looks AFTER the first call provisioned name+email+source.
  const board = fakeBoard([
    { _id: 'c1', key: 'full_name', name: 'Full Name', type: 'text', order: 0, isPrimary: true, settings: {} },
    { _id: 'c2', key: 'email', name: 'Email', type: 'email', order: 1, isPrimary: false, settings: {} },
    { _id: 'c3', key: 'source', name: 'Source', type: 'text', order: 2, isPrimary: false, settings: {} },
  ]);
  const conn = { attributeSource: true, sourceTag: 'Website', name: 'Web' };

  // A later submission carries one unseen field.
  const inferred = inferSchema({ budget: 12000 });
  const { fieldMap } = await provisionColumnsFromSchema(board, inferred, conn);

  const budgetCol = board.columns.find((c) => c.key === 'budget');
  assert.ok(budgetCol, 'budget column created');
  assert.equal(budgetCol.type, 'number');
  assert.equal(budgetCol.isPrimary, false, 'evolution never adds a second primary');
  assert.equal(board.columns.filter((c) => c.isPrimary).length, 1, 'still exactly one primary');
  assert.equal(budgetCol.order, 3, 'appended after existing columns');
  assert.deepEqual(fieldMap.map((f) => [f.sourceKey, f.columnKey, f.type]), [['budget', 'budget', 'number']]);
  assert.equal(board.columns.filter((c) => c.key === 'source').length, 1, 'source column not duplicated');
});

test('evolution provisioning: reuses an existing column matching by slug instead of duplicating', async () => {
  const board = fakeBoard([
    { _id: 'c1', key: 'name', name: 'Name', type: 'text', order: 0, isPrimary: true, settings: {} },
    { _id: 'c2', key: 'company', name: 'Company', type: 'text', order: 1, isPrimary: false, settings: {} },
  ]);
  const inferred = inferSchema({ company: 'Acme Inc' });
  const { fieldMap } = await provisionColumnsFromSchema(board, inferred, { attributeSource: false, name: 'X' });

  assert.equal(board.columns.filter((c) => c.key === 'company').length, 1, 'company column reused, not duplicated');
  assert.deepEqual(fieldMap, [{ sourceKey: 'company', columnKey: 'company', label: 'Company', type: 'text' }]);
});

// --- Per-connection lock -----------------------------------------------------

test('withConnectionLock: serializes calls for the same connection', async () => {
  const order = [];
  const slow = withConnectionLock('conn1', async () => {
    await new Promise((r) => setTimeout(r, 30));
    order.push('slow');
    return 'A';
  });
  const fast = withConnectionLock('conn1', async () => {
    order.push('fast');
    return 'B';
  });
  const [a, b] = await Promise.all([slow, fast]);
  assert.deepEqual(order, ['slow', 'fast'], 'second call waited for the first');
  assert.equal(a, 'A');
  assert.equal(b, 'B');
});

test('withConnectionLock: an error does not poison the chain and still rejects its caller', async () => {
  await assert.rejects(
    withConnectionLock('conn2', async () => {
      throw new Error('boom');
    }),
    /boom/
  );
  const ok = await withConnectionLock('conn2', async () => 'recovered');
  assert.equal(ok, 'recovered', 'next call runs normally after a failure');
});

test('withConnectionLock: different connections run independently', async () => {
  const order = [];
  const p1 = withConnectionLock('connA', async () => {
    await new Promise((r) => setTimeout(r, 30));
    order.push('A');
  });
  const p2 = withConnectionLock('connB', async () => {
    order.push('B');
  });
  await Promise.all([p1, p2]);
  assert.deepEqual(order, ['B', 'A'], 'connB did not wait behind connA');
});
