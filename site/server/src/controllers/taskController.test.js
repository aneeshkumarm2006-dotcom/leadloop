/**
 * taskController.test.js — unit tests for the F4 person-assigned dedupe edge
 * case (AC#5): adding/removing the same user multiple times in one save must
 * emit a single `task.person_assigned` per net-added user.
 *
 * Run from the server directory:
 *     node --test src/controllers/taskController.test.js
 *
 * Uses the built-in `node:test` runner — no new dependency.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { diffAddedUserIds } = require('./taskController');

const oid = () => new mongoose.Types.ObjectId();

test('diffAddedUserIds: net-add from empty → all ids', () => {
  const a = oid();
  const b = oid();
  assert.deepEqual(diffAddedUserIds([], [a, b]), [a.toString(), b.toString()]);
});

test('diffAddedUserIds: only the newly-added id (not the pre-existing one)', () => {
  const existing = oid();
  const added = oid();
  assert.deepEqual(
    diffAddedUserIds([existing], [existing, added]),
    [added.toString()]
  );
});

test('diffAddedUserIds: add+remove that nets to no change → no ids (AC#5)', () => {
  const u = oid();
  // user was present, then removed in the same save → toValue lacks it.
  assert.deepEqual(diffAddedUserIds([u], []), []);
  // user present before and after (toggled but net unchanged) → not "added".
  assert.deepEqual(diffAddedUserIds([u], [u]), []);
});

test('diffAddedUserIds: duplicated add yields a single id (AC#5)', () => {
  const u = oid();
  assert.deepEqual(diffAddedUserIds([], [u, u, u]), [u.toString()]);
});

test('diffAddedUserIds: ObjectId vs string equality holds', () => {
  const u = oid();
  assert.deepEqual(diffAddedUserIds([u.toString()], [u]), []);
});

test('diffAddedUserIds: null/empty inputs are safe', () => {
  assert.deepEqual(diffAddedUserIds(null, null), []);
  assert.deepEqual(diffAddedUserIds(undefined, [oid()]).length, 1);
});
