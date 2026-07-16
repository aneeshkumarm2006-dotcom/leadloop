/**
 * automationEventDispatcher.loopGuard.test.js — unit tests for the F5.4 loop
 * guard (AC5) and the cross-automation cascade depth cap.
 *
 * The two guards are pure decision functions so they're tested without a DB:
 *   - `originMatches`        suppresses same-automation re-entry (a SET_COLUMN_VALUE
 *                            write never re-fires the automation that made it);
 *   - `cascadeDepthExceeded` caps an A→B→A… column chain at MAX_CASCADE_DEPTH.
 *
 * Run from the server directory:
 *     node --test src/services/automationEventDispatcher.loopGuard.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

require('../models');
const {
  originMatches,
  cascadeDepthExceeded,
  MAX_CASCADE_DEPTH,
} = require('./automationEventDispatcher');

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// originMatches — AC5: same automation suppressed, other automation allowed
// ---------------------------------------------------------------------------
test('originMatches: true only when the event came from THIS automation', () => {
  const a = { _id: oid() };
  const b = { _id: oid() };

  // A wrote the column → A must skip its own write (no infinite self-loop).
  assert.equal(originMatches(a, { _originAutomationId: a._id }), true);
  // …but B (a different automation watching the same column) still chains.
  assert.equal(originMatches(b, { _originAutomationId: a._id }), false);
  // string vs ObjectId id forms compare equal.
  assert.equal(originMatches(a, { _originAutomationId: a._id.toString() }), true);
});

test('originMatches: false for user/manual edits (no origin tag)', () => {
  const a = { _id: oid() };
  assert.equal(originMatches(a, {}), false);
  assert.equal(originMatches(a, { _originAutomationId: null }), false);
  assert.equal(originMatches(a, undefined), false);
});

// ---------------------------------------------------------------------------
// cascadeDepthExceeded — depth cap of 5
// ---------------------------------------------------------------------------
test('cascadeDepthExceeded: trips at the cap, passes below it', () => {
  assert.equal(MAX_CASCADE_DEPTH, 5);
  assert.equal(cascadeDepthExceeded({}), false); // depth 0 (manual edit / first fire)
  assert.equal(cascadeDepthExceeded({ _cascadeDepth: 4 }), false);
  assert.equal(cascadeDepthExceeded({ _cascadeDepth: 5 }), true);
  assert.equal(cascadeDepthExceeded({ _cascadeDepth: 9 }), true);
});

test('cascadeDepthExceeded: honours a custom cap', () => {
  assert.equal(cascadeDepthExceeded({ _cascadeDepth: 2 }, 2), true);
  assert.equal(cascadeDepthExceeded({ _cascadeDepth: 1 }, 2), false);
});
