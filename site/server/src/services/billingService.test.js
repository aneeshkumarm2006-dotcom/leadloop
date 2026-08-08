/**
 * billingService.test.js — unit tests for plan entitlements + seat metering.
 * Pure functions, no DB / no Stripe. Run from the server directory:
 *     node --test src/services/billingService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveEntitlement, entitlementHasFeature, computeSeatUsage } = require('./billingService');
const { FEATURES } = require('../config/plans');

test('no subscription → free tier, not zero access', () => {
  const e = resolveEntitlement(null);
  assert.equal(e.planId, 'free');
  assert.equal(e.active, false);
  assert.equal(e.status, 'none');
  assert.ok(entitlementHasFeature(e, FEATURES.CORE), 'core is always granted');
  assert.equal(entitlementHasFeature(e, FEATURES.LEAD_CONNECTORS), false);
});

test('active team plan grants connectors + production reports', () => {
  const e = resolveEntitlement({ planId: 'team', status: 'active', seats: 5 });
  assert.equal(e.planId, 'team');
  assert.equal(e.active, true);
  assert.equal(e.seats, 5);
  assert.ok(entitlementHasFeature(e, FEATURES.LEAD_CONNECTORS));
  assert.ok(entitlementHasFeature(e, FEATURES.PRODUCTION_REPORTS));
  assert.equal(entitlementHasFeature(e, FEATURES.API_ACCESS), false); // brokerage-only
});

test('trialing counts as active — full features during the trial', () => {
  const e = resolveEntitlement({ planId: 'brokerage', status: 'trialing', seats: 20 });
  assert.equal(e.active, true);
  assert.ok(entitlementHasFeature(e, FEATURES.API_ACCESS));
});

test('past_due keeps access (card retry, not a lockout)', () => {
  const e = resolveEntitlement({ planId: 'team', status: 'past_due', seats: 5 });
  assert.equal(e.active, true);
  assert.equal(e.planId, 'team');
  assert.ok(entitlementHasFeature(e, FEATURES.LEAD_CONNECTORS));
});

test('canceled / unpaid degrade to free, never to nothing', () => {
  for (const status of ['canceled', 'unpaid', 'incomplete_expired']) {
    const e = resolveEntitlement({ planId: 'brokerage', status, seats: 50 });
    assert.equal(e.planId, 'free', `${status} → free`);
    assert.equal(e.active, false);
    assert.ok(entitlementHasFeature(e, FEATURES.CORE), `${status} keeps core access`);
    assert.equal(entitlementHasFeature(e, FEATURES.LEAD_CONNECTORS), false);
  }
});

test('an unknown planId falls back to free rather than throwing', () => {
  const e = resolveEntitlement({ planId: 'enterprise-that-does-not-exist', status: 'active' });
  assert.equal(e.planId, 'free');
});

test('seat usage: within limit, over limit, unlimited', () => {
  const team = resolveEntitlement({ planId: 'team', status: 'active', seats: 10 });
  assert.deepEqual(computeSeatUsage(7, team), { used: 7, limit: 10, over: 0, withinLimit: true });
  assert.deepEqual(computeSeatUsage(13, team), { used: 13, limit: 10, over: 3, withinLimit: false });

  const brokerage = resolveEntitlement({ planId: 'brokerage', status: 'active', seats: null });
  const usage = computeSeatUsage(500, brokerage);
  assert.equal(usage.limit, null);
  assert.equal(usage.over, 0);
  assert.equal(usage.withinLimit, true);
});

test('free tier seat cap applies to a lapsed workspace', () => {
  const e = resolveEntitlement({ planId: 'team', status: 'canceled', seats: 10 });
  const usage = computeSeatUsage(6, e);
  assert.equal(usage.limit, 2); // free plan cap
  assert.equal(usage.over, 4);
  assert.equal(usage.withinLimit, false);
});

test('cancelAtPeriodEnd + period end are surfaced for the UI', () => {
  const end = new Date('2026-01-01T00:00:00Z');
  const e = resolveEntitlement({ planId: 'team', status: 'active', seats: 3, currentPeriodEnd: end, cancelAtPeriodEnd: true });
  assert.equal(e.cancelAtPeriodEnd, true);
  assert.equal(e.currentPeriodEnd, end);
  assert.equal(e.active, true); // still paid through the period
});
