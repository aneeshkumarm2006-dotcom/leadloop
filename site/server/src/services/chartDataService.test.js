/**
 * chartDataService.test.js — F13.3 (QA): one fixture per widget type asserting
 * correct counts, with special attention to the AC3 stage funnel
 * (New→Contacted→Qualified→Viewing→Offer→Closed).
 *
 * Structural test — stubs the Board/Task model statics so it runs without a DB.
 *     node --test src/services/chartDataService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

require('../models/Board');
const Board = require('../models/Board');
const Task = require('../models/Task');
const { aggregate, _internals } = require('./chartDataService');

const oid = () => new mongoose.Types.ObjectId();

// Stub `Board.findById(id).select(...).lean()` → board, and
// `Task.find(...).select(...).lean()` → tasks.
const stubBoard = (board) => {
  Board.findById = () => ({ select: () => ({ lean: async () => board }) });
};
const stubTasks = (tasks) => {
  Task.find = () => ({ select: () => ({ lean: async () => tasks }) });
};
const restore = () => {
  delete Board.findById;
  delete Board.find;
  delete Task.find;
};

// A status column with the canonical lead pipeline, deliberately out of `order`
// in the array to prove the funnel sorts by `order`, not insertion.
const STAGE_COL = oid();
const stageOptions = [
  { id: 'closed', label: 'Closed', color: '#16A34A', order: 5 },
  { id: 'new', label: 'New', color: '#2563EB', order: 0 },
  { id: 'contacted', label: 'Contacted', color: '#0891B2', order: 1 },
  { id: 'offer', label: 'Offer', color: '#D97706', order: 4 },
  { id: 'qualified', label: 'Qualified', color: '#7C3AED', order: 2 },
  { id: 'viewing', label: 'Viewing', color: '#DB2777', order: 3 },
];
const PRICE_COL = oid();
const SOURCE_COL = oid();
const DATE_COL = oid();

const boardWith = (columns) => ({ _id: oid(), columns });
const task = (cv) => ({ _id: oid(), name: 'T', columnValues: cv, createdAt: new Date('2026-06-10T00:00:00.000Z') });

// --------------------------------------------------------------------------
// funnel — AC3
// --------------------------------------------------------------------------
test('funnel: ordered stage counts New→Contacted→Qualified→Viewing→Offer→Closed', async () => {
  stubBoard(boardWith([{ _id: STAGE_COL, type: 'status', settings: { options: stageOptions } }]));
  stubTasks([
    task({ [STAGE_COL.toString()]: 'new' }),
    task({ [STAGE_COL.toString()]: 'new' }),
    task({ [STAGE_COL.toString()]: 'new' }),
    task({ [STAGE_COL.toString()]: 'contacted' }),
    task({ [STAGE_COL.toString()]: 'contacted' }),
    task({ [STAGE_COL.toString()]: 'qualified' }),
    task({ [STAGE_COL.toString()]: 'viewing' }),
    task({ [STAGE_COL.toString()]: 'offer' }),
    task({ [STAGE_COL.toString()]: 'closed' }),
    task({ [STAGE_COL.toString()]: 'closed' }),
  ]);

  const widget = { boardId: oid(), type: 'funnel', query: { columnId: STAGE_COL.toString() } };
  const out = await aggregate(widget, {});
  restore();

  assert.equal(out.type, 'funnel');
  assert.deepEqual(
    out.series.map((s) => [s.label, s.value]),
    [
      ['New', 3],
      ['Contacted', 2],
      ['Qualified', 1],
      ['Viewing', 1],
      ['Offer', 1],
      ['Closed', 2],
    ]
  );
  assert.equal(out.total, 10);
});

test('funnel: a stage with zero tasks is still emitted (0-filled)', async () => {
  stubBoard(boardWith([{ _id: STAGE_COL, type: 'status', settings: { options: stageOptions } }]));
  stubTasks([task({ [STAGE_COL.toString()]: 'new' })]);
  const out = await aggregate({ boardId: oid(), type: 'funnel', query: { columnId: STAGE_COL.toString() } }, {});
  restore();
  assert.equal(out.series.length, 6, 'every stage present even with no tasks');
  assert.equal(out.series.find((s) => s.key === 'closed').value, 0);
});

// --------------------------------------------------------------------------
// bar / pie
// --------------------------------------------------------------------------
test('bar: count by status option, ordered by option order', async () => {
  stubBoard(boardWith([{ _id: STAGE_COL, type: 'status', settings: { options: stageOptions } }]));
  stubTasks([
    task({ [STAGE_COL.toString()]: 'contacted' }),
    task({ [STAGE_COL.toString()]: 'new' }),
    task({ [STAGE_COL.toString()]: 'new' }),
  ]);
  const out = await aggregate({ boardId: oid(), type: 'bar', query: { columnId: STAGE_COL.toString() } }, {});
  restore();
  // Only present keys, but ordered New (order 0) before Contacted (order 1).
  assert.deepEqual(out.series.map((s) => [s.label, s.value]), [['New', 2], ['Contacted', 1]]);
});

test('pie: tasks with no value land in the (None) bucket', async () => {
  stubBoard(boardWith([{ _id: STAGE_COL, type: 'status', settings: { options: stageOptions } }]));
  stubTasks([task({ [STAGE_COL.toString()]: 'new' }), task({})]);
  const out = await aggregate({ boardId: oid(), type: 'pie', query: { columnId: STAGE_COL.toString() } }, {});
  restore();
  const none = out.series.find((s) => s.key === '__none__');
  assert.ok(none, '(None) bucket present');
  assert.equal(none.value, 1);
  assert.equal(out.total, 2);
});

// --------------------------------------------------------------------------
// number — count + sum
// --------------------------------------------------------------------------
test('number: count is the task total', async () => {
  stubBoard(boardWith([{ _id: PRICE_COL, type: 'number', settings: {} }]));
  stubTasks([task({}), task({}), task({})]);
  const out = await aggregate({ boardId: oid(), type: 'number', title: 'Leads', query: { aggregate: 'count' } }, {});
  restore();
  assert.equal(out.value, 3);
  assert.equal(out.label, 'Leads');
});

test('number: sum of a number column', async () => {
  stubBoard(boardWith([{ _id: PRICE_COL, type: 'number', settings: {} }]));
  stubTasks([
    task({ [PRICE_COL.toString()]: 100000 }),
    task({ [PRICE_COL.toString()]: 250000 }),
    task({ [PRICE_COL.toString()]: '50000' }), // string coerces
  ]);
  const out = await aggregate(
    { boardId: oid(), type: 'number', query: { aggregate: 'sum', aggregateColumnId: PRICE_COL.toString() } },
    {}
  );
  restore();
  assert.equal(out.value, 400000);
});

// --------------------------------------------------------------------------
// bar with sum aggregate over a second column
// --------------------------------------------------------------------------
test('bar: sum of price grouped by source', async () => {
  stubBoard(
    boardWith([
      { _id: SOURCE_COL, type: 'dropdown', settings: { options: [{ id: 'ref', label: 'Referral', order: 0 }, { id: 'web', label: 'Web', order: 1 }] } },
      { _id: PRICE_COL, type: 'number', settings: {} },
    ])
  );
  stubTasks([
    task({ [SOURCE_COL.toString()]: 'ref', [PRICE_COL.toString()]: 600000 }),
    task({ [SOURCE_COL.toString()]: 'ref', [PRICE_COL.toString()]: 400000 }),
    task({ [SOURCE_COL.toString()]: 'web', [PRICE_COL.toString()]: 300000 }),
  ]);
  const out = await aggregate(
    { boardId: oid(), type: 'bar', query: { columnId: SOURCE_COL.toString(), aggregate: 'sum', aggregateColumnId: PRICE_COL.toString() } },
    {}
  );
  restore();
  assert.deepEqual(out.series.map((s) => [s.label, s.value]), [['Referral', 1000000], ['Web', 300000]]);
});

// --------------------------------------------------------------------------
// line — bucket by month
// --------------------------------------------------------------------------
test('line: count bucketed by month over a date column', async () => {
  stubBoard(boardWith([{ _id: DATE_COL, type: 'date', settings: {} }]));
  stubTasks([
    task({ [DATE_COL.toString()]: '2026-05-03T00:00:00.000Z' }),
    task({ [DATE_COL.toString()]: '2026-05-20T00:00:00.000Z' }),
    task({ [DATE_COL.toString()]: '2026-06-10T00:00:00.000Z' }),
    task({}), // no date → excluded
  ]);
  const out = await aggregate(
    { boardId: oid(), type: 'line', query: { columnId: DATE_COL.toString(), timeBucket: 'month' } },
    {}
  );
  restore();
  assert.equal(out.series.length, 2);
  assert.deepEqual(out.series.map((s) => s.value), [2, 1]);
  assert.match(out.series[0].label, /May 2026/);
});

// --------------------------------------------------------------------------
// stacked_bar — group by A split by B
// --------------------------------------------------------------------------
test('stacked_bar: group by source split by stage', async () => {
  stubBoard(
    boardWith([
      { _id: SOURCE_COL, type: 'dropdown', settings: { options: [{ id: 'ref', label: 'Referral', order: 0 }, { id: 'web', label: 'Web', order: 1 }] } },
      { _id: STAGE_COL, type: 'status', settings: { options: stageOptions } },
    ])
  );
  stubTasks([
    task({ [SOURCE_COL.toString()]: 'ref', [STAGE_COL.toString()]: 'new' }),
    task({ [SOURCE_COL.toString()]: 'ref', [STAGE_COL.toString()]: 'closed' }),
    task({ [SOURCE_COL.toString()]: 'web', [STAGE_COL.toString()]: 'new' }),
  ]);
  const out = await aggregate(
    { boardId: oid(), type: 'stacked_bar', query: { columnId: SOURCE_COL.toString(), splitBy: STAGE_COL.toString() } },
    {}
  );
  restore();
  assert.equal(out.type, 'stacked_bar');
  const ref = out.groups.find((g) => g.label === 'Referral');
  assert.equal(ref.values.new, 1);
  assert.equal(ref.values.closed, 1);
  const web = out.groups.find((g) => g.label === 'Web');
  assert.equal(web.values.new, 1);
  assert.equal(web.values.closed, 0);
});

// --------------------------------------------------------------------------
// filter — query.filter narrows the task set before aggregation
// --------------------------------------------------------------------------
test('filter: query.filter excludes non-matching tasks', async () => {
  stubBoard(
    boardWith([
      { _id: STAGE_COL, type: 'status', settings: { options: stageOptions } },
      { _id: SOURCE_COL, type: 'dropdown', settings: { options: [{ id: 'ref', label: 'Referral', order: 0 }] } },
    ])
  );
  stubTasks([
    task({ [STAGE_COL.toString()]: 'new', [SOURCE_COL.toString()]: 'ref' }),
    task({ [STAGE_COL.toString()]: 'new', [SOURCE_COL.toString()]: 'web' }),
  ]);
  const out = await aggregate(
    {
      boardId: oid(),
      type: 'bar',
      query: {
        columnId: STAGE_COL.toString(),
        filter: [{ columnId: SOURCE_COL.toString(), op: 'eq', value: 'ref' }],
      },
    },
    {}
  );
  restore();
  assert.equal(out.series.find((s) => s.key === 'new').value, 1);
});

// --------------------------------------------------------------------------
// internals — bucketDate
// --------------------------------------------------------------------------
test('bucketDate: month/week/day truncation (UTC)', () => {
  const { bucketDate } = _internals;
  assert.equal(bucketDate('2026-06-17T13:00:00.000Z', 'month'), '2026-06-01T00:00:00.000Z');
  assert.equal(bucketDate('2026-06-17T13:00:00.000Z', 'day'), '2026-06-17T00:00:00.000Z');
  // 2026-06-17 is a Wednesday → Monday-start week is 2026-06-15.
  assert.equal(bucketDate('2026-06-17T13:00:00.000Z', 'week'), '2026-06-15T00:00:00.000Z');
  assert.equal(bucketDate(null, 'month'), null);
});
