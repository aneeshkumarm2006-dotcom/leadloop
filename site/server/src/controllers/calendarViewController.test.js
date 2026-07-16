const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Register Board model deps before requiring the controller.
require('../models/Board');
const CalendarView = require('../models/CalendarView');
const Board = require('../models/Board');
const Task = require('../models/Task');
const Organisation = require('../models/Organisation');

const controller = require('./calendarViewController');
const {
  resolveColor,
  resolveDates,
  resolveResourceId,
  overlapsRange,
  validateColumnsForBoard,
  personColor,
} = controller._internals;

const oid = () => new mongoose.Types.ObjectId();

// --------------------------------------------------------------------------
// Pure internals
// --------------------------------------------------------------------------
test('resolveDates: date column → single-day event', () => {
  const out = resolveDates({ type: 'date' }, '2026-06-10T00:00:00.000Z');
  assert.equal(out.start, '2026-06-10T00:00:00.000Z');
  assert.equal(out.end, '2026-06-10T00:00:00.000Z');
});

test('resolveDates: timeline column → start/end', () => {
  const out = resolveDates(
    { type: 'timeline' },
    { start: '2026-06-10T00:00:00.000Z', end: '2026-06-14T00:00:00.000Z' }
  );
  assert.equal(out.start, '2026-06-10T00:00:00.000Z');
  assert.equal(out.end, '2026-06-14T00:00:00.000Z');
});

test('resolveDates: timeline end falls back to start', () => {
  const out = resolveDates({ type: 'timeline' }, { start: '2026-06-10T00:00:00.000Z' });
  assert.equal(out.end, '2026-06-10T00:00:00.000Z');
});

test('resolveDates: empty value → null (no event)', () => {
  assert.equal(resolveDates({ type: 'date' }, null), null);
  assert.equal(resolveDates({ type: 'date' }, ''), null);
  assert.equal(resolveDates({ type: 'timeline' }, {}), null);
});

test('resolveColor: status option id → option colour', () => {
  const col = {
    type: 'status',
    settings: { options: [{ id: 'opt_a', label: 'A', color: '#FF0000' }, { id: 'opt_b', color: '#00FF00' }] },
  };
  assert.equal(resolveColor(col, 'opt_b'), '#00FF00');
});

test('resolveColor: unknown option id → default colour', () => {
  const col = { type: 'status', settings: { options: [{ id: 'opt_a', color: '#FF0000' }] } };
  assert.equal(resolveColor(col, 'nope'), '#6B7280');
});

test('resolveColor: tags → first tag option colour', () => {
  const col = {
    type: 'tags',
    settings: { options: [{ id: 't1', color: '#111111' }, { id: 't2', color: '#222222' }] },
  };
  assert.equal(resolveColor(col, ['t2', 't1']), '#222222');
});

test('resolveColor: person → deterministic palette colour (stable per user)', () => {
  const u = oid().toString();
  const col = { type: 'person', settings: {} };
  const c1 = resolveColor(col, [u]);
  const c2 = resolveColor(col, [u]);
  assert.equal(c1, c2);
  assert.equal(c1, personColor(u));
});

test('resolveColor: no colour column → default colour', () => {
  assert.equal(resolveColor(null, 'whatever'), '#6B7280');
});

test('resolveResourceId: person column → first user id', () => {
  const a = oid().toString();
  const b = oid().toString();
  assert.equal(resolveResourceId({ type: 'person' }, [a, b]), a);
  assert.equal(resolveResourceId({ type: 'person' }, []), null);
});

test('resolveResourceId: status column → option id string', () => {
  assert.equal(resolveResourceId({ type: 'status' }, 'opt_x'), 'opt_x');
});

test('overlapsRange: includes overlapping, excludes outside, all when open', () => {
  const s = '2026-06-10T00:00:00.000Z';
  const e = '2026-06-10T00:00:00.000Z';
  const from = new Date('2026-06-01').getTime();
  const to = new Date('2026-06-30').getTime();
  assert.equal(overlapsRange(s, e, from, to), true);
  assert.equal(overlapsRange('2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z', from, to), false);
  assert.equal(overlapsRange(s, e, null, null), true);
});

test('validateColumnsForBoard: rejects a non-date source column', () => {
  const sid = oid();
  const board = { columns: [{ _id: sid, type: 'status', settings: {} }] };
  const r = validateColumnsForBoard(board, { sourceColumnId: sid.toString(), layout: 'month' });
  assert.ok(r.error);
  assert.match(r.error, /date or timeline/);
});

test('validateColumnsForBoard: accepts a date source + status color-by', () => {
  const sid = oid();
  const cid = oid();
  const board = {
    columns: [
      { _id: sid, type: 'date', settings: {} },
      { _id: cid, type: 'status', settings: {} },
    ],
  };
  const r = validateColumnsForBoard(board, {
    sourceColumnId: sid.toString(),
    colorByColumnId: cid.toString(),
    layout: 'month',
  });
  assert.equal(r.ok, true);
});

test('validateColumnsForBoard: resource layout requires a resourceColumnId', () => {
  const sid = oid();
  const board = { columns: [{ _id: sid, type: 'date', settings: {} }] };
  const r = validateColumnsForBoard(board, { sourceColumnId: sid.toString(), layout: 'resource' });
  assert.ok(r.error);
  assert.match(r.error, /resourceColumnId/);
});

// --------------------------------------------------------------------------
// events() builder — with stubbed models
// --------------------------------------------------------------------------
const mockRes = () => {
  const r = { statusCode: 200, body: undefined, ended: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
};

// Save originals to restore after each stubbing test.
const restoreAll = () => {
  delete CalendarView.findById;
  delete Organisation.findById;
  delete Board.findById;
  delete Board.find;
  delete Task.find;
};

const taskQueryStub = (tasks) => ({ select: () => ({ lean: async () => tasks }) });

test('events: AC1 — one coloured block per source value, colour by status option', async () => {
  const userId = oid().toString();
  const workspaceId = oid();
  const boardId = oid();
  const sourceCol = oid();
  const colorCol = oid();

  CalendarView.findById = async () => ({
    _id: oid(),
    userId: { toString: () => userId },
    workspaceId: { toString: () => workspaceId.toString() },
    boardId,
    sourceColumnId: sourceCol.toString(),
    colorByColumnId: colorCol.toString(),
    resourceColumnId: null,
    layout: 'month',
    filter: [],
  });
  Organisation.findById = async () => ({ members: [{ toString: () => userId }], admins: [] });
  Board.findById = async () => ({
    _id: boardId,
    columns: [
      { _id: sourceCol, type: 'date', settings: {} },
      { _id: colorCol, type: 'status', settings: { options: [{ id: 'opt_new', color: '#FF0000' }] } },
    ],
  });
  Task.find = () => taskQueryStub([
    { _id: oid(), name: 'Move-in A', columnValues: { [sourceCol.toString()]: '2026-06-10T00:00:00.000Z', [colorCol.toString()]: 'opt_new' } },
    { _id: oid(), name: 'No date', columnValues: { [colorCol.toString()]: 'opt_new' } },
  ]);

  const res = mockRes();
  await controller.events({ user: { userId }, params: { id: oid().toString() }, query: {} }, res);
  restoreAll();

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.events.length, 1, 'task without a source value contributes no event');
  assert.equal(res.body.events[0].title, 'Move-in A');
  assert.equal(res.body.events[0].color, '#FF0000');
  assert.equal(res.body.events[0].start, '2026-06-10T00:00:00.000Z');
});

test('events: AC3 — resource layout projects resourceId from a person column', async () => {
  const userId = oid().toString();
  const workspaceId = oid();
  const boardId = oid();
  const sourceCol = oid();
  const agentCol = oid();
  const agentA = oid().toString();

  CalendarView.findById = async () => ({
    _id: oid(),
    userId: { toString: () => userId },
    workspaceId: { toString: () => workspaceId.toString() },
    boardId,
    sourceColumnId: sourceCol.toString(),
    colorByColumnId: null,
    resourceColumnId: agentCol.toString(),
    layout: 'resource',
    filter: [],
  });
  Organisation.findById = async () => ({ members: [{ toString: () => userId }], admins: [] });
  Board.findById = async () => ({
    _id: boardId,
    columns: [
      { _id: sourceCol, type: 'date', settings: {} },
      { _id: agentCol, type: 'person', settings: {} },
    ],
  });
  Task.find = () => taskQueryStub([
    { _id: oid(), name: 'Lead', columnValues: { [sourceCol.toString()]: '2026-06-12T00:00:00.000Z', [agentCol.toString()]: [agentA] } },
  ]);

  const res = mockRes();
  await controller.events({ user: { userId }, params: { id: oid().toString() }, query: {} }, res);
  restoreAll();

  assert.equal(res.body.events.length, 1);
  assert.equal(res.body.events[0].resourceId, agentA);
});

test('events: AC4 — a deleted source column returns a column_missing warning, not a crash', async () => {
  const userId = oid().toString();
  const workspaceId = oid();
  const boardId = oid();
  const missingCol = oid();

  CalendarView.findById = async () => ({
    _id: oid(),
    userId: { toString: () => userId },
    workspaceId: { toString: () => workspaceId.toString() },
    boardId,
    sourceColumnId: missingCol.toString(), // not present on the board below
    colorByColumnId: null,
    resourceColumnId: null,
    layout: 'month',
    filter: [],
  });
  Organisation.findById = async () => ({ members: [{ toString: () => userId }], admins: [] });
  Board.findById = async () => ({ _id: boardId, columns: [{ _id: oid(), type: 'date', settings: {} }] });
  Task.find = () => taskQueryStub([]);

  const res = mockRes();
  await controller.events({ user: { userId }, params: { id: oid().toString() }, query: {} }, res);
  restoreAll();

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { events: [], warning: 'column_missing' });
});

test('events: filter excludes non-matching tasks', async () => {
  const userId = oid().toString();
  const workspaceId = oid();
  const boardId = oid();
  const sourceCol = oid();
  const statusCol = oid();

  CalendarView.findById = async () => ({
    _id: oid(),
    userId: { toString: () => userId },
    workspaceId: { toString: () => workspaceId.toString() },
    boardId,
    sourceColumnId: sourceCol.toString(),
    colorByColumnId: null,
    resourceColumnId: null,
    layout: 'month',
    filter: [{ columnId: statusCol.toString(), op: 'eq', value: 'opt_qualified' }],
  });
  Organisation.findById = async () => ({ members: [{ toString: () => userId }], admins: [] });
  Board.findById = async () => ({
    _id: boardId,
    columns: [
      { _id: sourceCol, type: 'date', settings: {} },
      { _id: statusCol, type: 'status', settings: { options: [{ id: 'opt_qualified' }, { id: 'opt_new' }] } },
    ],
  });
  Task.find = () => taskQueryStub([
    { _id: oid(), name: 'Keep', columnValues: { [sourceCol.toString()]: '2026-06-10T00:00:00.000Z', [statusCol.toString()]: 'opt_qualified' } },
    { _id: oid(), name: 'Drop', columnValues: { [sourceCol.toString()]: '2026-06-11T00:00:00.000Z', [statusCol.toString()]: 'opt_new' } },
  ]);

  const res = mockRes();
  await controller.events({ user: { userId }, params: { id: oid().toString() }, query: {} }, res);
  restoreAll();

  assert.equal(res.body.events.length, 1);
  assert.equal(res.body.events[0].title, 'Keep');
});

test('events: non-member without a grant on a board-scoped view → 403', async () => {
  const userId = oid().toString();
  const workspaceId = oid();
  const boardId = oid();

  CalendarView.findById = async () => ({
    _id: oid(),
    userId: { toString: () => oid().toString() }, // someone else owns it
    workspaceId: { toString: () => workspaceId.toString() },
    boardId,
    sourceColumnId: oid().toString(),
    colorByColumnId: null,
    resourceColumnId: null,
    layout: 'month',
    filter: [],
    isShared: true,
  });
  // Not a member.
  Organisation.findById = async () => ({ members: [], admins: [] });

  const res = mockRes();
  await controller.events({ user: { userId }, params: { id: oid().toString() }, query: {} }, res);
  restoreAll();

  assert.equal(res.statusCode, 403);
});
