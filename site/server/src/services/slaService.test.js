/**
 * slaService.test.js — the speed-to-lead clock. Pure, no DB.
 *     node --test src/services/slaService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { STATE, resolvePolicy, dueAt, evaluate, summarise, formatDuration, DEFAULTS } =
  require('./slaService');

const T0 = new Date('2026-06-15T12:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60_000);
const lead = (extra = {}) => ({ createdAt: T0, ...extra });

test('policy defaults apply, and junk values are ignored', () => {
  assert.equal(resolvePolicy({}).targetMinutes, DEFAULTS.targetMinutes);
  assert.equal(resolvePolicy({ targetMinutes: 0 }).targetMinutes, DEFAULTS.targetMinutes);
  assert.equal(resolvePolicy({ targetMinutes: -5 }).targetMinutes, DEFAULTS.targetMinutes);
  assert.equal(resolvePolicy({ targetMinutes: 'soon' }).targetMinutes, DEFAULTS.targetMinutes);
  assert.equal(resolvePolicy({ targetMinutes: 15 }).targetMinutes, 15);
});

test('the deadline is the target after creation', () => {
  assert.equal(dueAt(T0, { targetMinutes: 5 }).toISOString(), at(5).toISOString());
});

test('a fresh lead is pending, then warns, then breaches', () => {
  const p = { targetMinutes: 10, warnAtPercent: 70 };
  assert.equal(evaluate(lead(), p, at(1)).state, STATE.PENDING);
  assert.equal(evaluate(lead(), p, at(7)).state, STATE.WARNING, '70% elapsed');
  assert.equal(evaluate(lead(), p, at(11)).state, STATE.BREACHED);
});

test('remaining time counts down and never goes negative', () => {
  const r = evaluate(lead(), { targetMinutes: 5 }, at(2));
  assert.equal(r.msRemaining, 3 * 60_000);
  const b = evaluate(lead(), { targetMinutes: 5 }, at(9));
  assert.equal(b.msRemaining, 0);
  assert.equal(b.msLate, 4 * 60_000);
});

test('answering stops the clock for good', () => {
  const r = evaluate(lead({ firstResponseAt: at(3) }), { targetMinutes: 5 }, at(600));
  assert.equal(r.state, STATE.RESPONDED, 'still responded hours later');
  assert.equal(r.metTarget, true);
  assert.equal(r.responseMs, 3 * 60_000);
});

test('a late answer is still "responded", but did not meet target', () => {
  const r = evaluate(lead({ firstResponseAt: at(20) }), { targetMinutes: 5 }, at(30));
  assert.equal(r.state, STATE.RESPONDED);
  assert.equal(r.metTarget, false);
  assert.equal(r.msLate, 15 * 60_000);
  assert.equal(r.responseMs, 20 * 60_000);
});

test('escalation waits for the grace period, not the target', () => {
  const p = { targetMinutes: 5, escalateAfterMinutes: 10, reassign: true };
  // Breached at 5 min, but escalation is only at 10 min.
  assert.equal(evaluate(lead(), p, at(6)).shouldEscalate, false, 'do not page instantly on breach');
  assert.equal(evaluate(lead(), p, at(11)).shouldEscalate, true);
});

test('escalation never fires when reassignment is off', () => {
  const p = { targetMinutes: 5, escalateAfterMinutes: 10, reassign: false };
  assert.equal(evaluate(lead(), p, at(60)).shouldEscalate, false);
});

test('an answered lead is never escalated', () => {
  const p = { targetMinutes: 5, escalateAfterMinutes: 10, reassign: true };
  assert.equal(evaluate(lead({ firstResponseAt: at(2) }), p, at(600)).shouldEscalate, false);
});

test('a stored slaDueAt wins over recomputing from the policy', () => {
  // A policy change must not retroactively breach leads already in flight.
  const r = evaluate(lead({ slaDueAt: at(60) }), { targetMinutes: 5 }, at(30));
  assert.equal(r.state, STATE.PENDING);
});

test('summary uses the MEDIAN, so one stale lead cannot distort it', () => {
  const evals = [
    evaluate(lead({ firstResponseAt: at(1) }), { targetMinutes: 5 }, at(10)),
    evaluate(lead({ firstResponseAt: at(2) }), { targetMinutes: 5 }, at(10)),
    evaluate(lead({ firstResponseAt: at(3) }), { targetMinutes: 5 }, at(10)),
    evaluate(lead({ firstResponseAt: at(4320) }), { targetMinutes: 5 }, at(4400)), // 3 days
  ];
  const s = summarise(evals);
  assert.equal(s.responded, 4);
  assert.equal(s.medianMs, 2.5 * 60_000, 'median, not mean');
  assert.equal(s.withinTargetPercent, 75, '3 of 4 met the 5-minute target');
});

test('summary counts pending and breached separately', () => {
  const p = { targetMinutes: 5 };
  const s = summarise([
    evaluate(lead(), p, at(1)), // pending
    evaluate(lead(), p, at(4)), // warning → still pending bucket
    evaluate(lead(), p, at(30)), // breached
    evaluate(lead({ firstResponseAt: at(2) }), p, at(30)), // responded
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.pending, 2);
  assert.equal(s.breached, 1);
  assert.equal(s.responded, 1);
});

test('an empty set reports nothing rather than dividing by zero', () => {
  const s = summarise([]);
  assert.equal(s.medianMs, null);
  assert.equal(s.withinTargetPercent, null);
  assert.equal(s.total, 0);
});

test('durations format for the countdown UI', () => {
  assert.equal(formatDuration(192_000), '3:12');
  assert.equal(formatDuration(48_000), '0:48');
  assert.equal(formatDuration(3_840_000), '1h 04m');
  assert.equal(formatDuration(-5000), '0:00', 'never negative');
});
