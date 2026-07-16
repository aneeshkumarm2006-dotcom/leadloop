/**
 * sequenceService.test.js — the pure cadence math (no DB).
 * Run: node --test src/services/sequenceService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stepDelayMs,
  firstRunAt,
  advanceCursor,
  findEmailColumnId,
  resolveRecipientEmail,
} = require('./sequenceService');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('stepDelayMs converts each unit', () => {
  assert.equal(stepDelayMs({ delayAmount: 0, delayUnit: 'days' }), 0);
  assert.equal(stepDelayMs({ delayAmount: 5, delayUnit: 'minutes' }), 5 * MIN);
  assert.equal(stepDelayMs({ delayAmount: 3, delayUnit: 'hours' }), 3 * HOUR);
  assert.equal(stepDelayMs({ delayAmount: 2, delayUnit: 'days' }), 2 * DAY);
});

test('stepDelayMs defaults unit to days and clamps negatives to 0', () => {
  assert.equal(stepDelayMs({ delayAmount: 1 }), DAY);
  assert.equal(stepDelayMs({ delayAmount: -4, delayUnit: 'days' }), 0);
  assert.equal(stepDelayMs(null), 0);
  assert.equal(stepDelayMs({ delayAmount: 'x', delayUnit: 'hours' }), 0);
});

test('firstRunAt offsets the enrollment moment by step 0 delay', () => {
  const now = new Date('2026-06-09T10:00:00.000Z');
  const steps = [{ delayAmount: 0, delayUnit: 'days' }, { delayAmount: 2, delayUnit: 'days' }];
  assert.equal(firstRunAt(steps, now).getTime(), now.getTime());

  const delayed = [{ delayAmount: 1, delayUnit: 'hours' }];
  assert.equal(firstRunAt(delayed, now).getTime(), now.getTime() + HOUR);
});

test('advanceCursor moves to the next step with its delay', () => {
  const now = new Date('2026-06-09T10:00:00.000Z');
  const steps = [
    { delayAmount: 0, delayUnit: 'days' },
    { delayAmount: 2, delayUnit: 'days' },
    { delayAmount: 3, delayUnit: 'days' },
  ];
  const a = advanceCursor(steps, 0, now);
  assert.equal(a.status, 'active');
  assert.equal(a.currentStep, 1);
  assert.equal(a.nextRunAt.getTime(), now.getTime() + 2 * DAY);
  assert.equal(a.completedAt, null);
});

test('advanceCursor completes after the last step', () => {
  const now = new Date('2026-06-09T10:00:00.000Z');
  const steps = [{ delayAmount: 0 }, { delayAmount: 2, delayUnit: 'days' }];
  const a = advanceCursor(steps, 1, now);
  assert.equal(a.status, 'completed');
  assert.equal(a.currentStep, 2);
  assert.equal(a.nextRunAt, null);
  assert.equal(a.completedAt.getTime(), now.getTime());
});

test('findEmailColumnId prefers the explicit id, else the first email column', () => {
  const board = {
    columns: [
      { _id: 'c1', type: 'text' },
      { _id: 'c2', type: 'email' },
      { _id: 'c3', type: 'email' },
    ],
  };
  assert.equal(findEmailColumnId(board, 'cX'), 'cX');
  assert.equal(findEmailColumnId(board, ''), 'c2');
  assert.equal(findEmailColumnId({ columns: [{ _id: 'c1', type: 'text' }] }, ''), '');
});

test('resolveRecipientEmail reads + validates the column value (Map and object shapes)', () => {
  const board = { columns: [{ _id: 'c2', type: 'email' }] };
  const mapTask = { columnValues: new Map([['c2', 'lead@example.com']]) };
  assert.equal(resolveRecipientEmail(mapTask, board, ''), 'lead@example.com');

  const objTask = { columnValues: { c2: { email: 'a@b.co' } } };
  assert.equal(resolveRecipientEmail(objTask, board, 'c2'), 'a@b.co');

  const bad = { columnValues: new Map([['c2', 'not-an-email']]) };
  assert.equal(resolveRecipientEmail(bad, board, ''), '');

  const empty = { columnValues: new Map() };
  assert.equal(resolveRecipientEmail(empty, board, ''), '');
});
