/**
 * dateAutomationRunner.window.test.js — unit tests for the since-previous-tick
 * fire window added to fix the DATE_ARRIVED back-fire / re-fire findings.
 *
 * Run from the server directory:
 *     node --test src/services/dateAutomationRunner.window.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { instantInTickWindow } = require('./dateAutomationRunner');

const H = 60 * 60 * 1000;
const now = 1_000_000_000_000; // arbitrary fixed "now" in ms
const prev = now - H; // previous hourly tick

test('fires for an instant crossed during this tick window (prev < instant <= now)', () => {
  assert.equal(instantInTickWindow(now - H / 2, prev, now), true);
  assert.equal(instantInTickWindow(now, prev, now), true); // upper bound inclusive
});

test('does NOT fire for a future instant (not yet crossed)', () => {
  assert.equal(instantInTickWindow(now + H, prev, now), false);
});

test('does NOT re-fire a past instant that crossed before this window (no back-fire / no re-fire)', () => {
  // An instant a week ago is outside (prev, now] — exactly the case that used to
  // back-fire on enable and re-fire after triggerHistory eviction.
  assert.equal(instantInTickWindow(now - 24 * 7 * H, prev, now), false);
  // Lower bound is exclusive: the previous tick's own instant is not re-fired.
  assert.equal(instantInTickWindow(prev, prev, now), false);
});

test('first sweep (prevTick === now) fires nothing — empty window, no historical back-fire', () => {
  assert.equal(instantInTickWindow(now - H, now, now), false);
  assert.equal(instantInTickWindow(now, now, now), false);
});

test('AC2 walk-through: an instant fires in exactly one of two consecutive tick windows', () => {
  const instant = now; // crosses exactly at this tick boundary
  // Tick A: window (now-H, now]  → fires.
  assert.equal(instantInTickWindow(instant, now - H, now), true);
  // Tick B one hour later: window (now, now+H] → does NOT fire again.
  assert.equal(instantInTickWindow(instant, now, now + H), false);
});
