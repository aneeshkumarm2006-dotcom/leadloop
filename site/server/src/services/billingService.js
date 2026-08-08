/**
 * billingService.js — plan entitlements + seat metering.
 *
 * The app asks two questions:
 *   "can this workspace use feature X?"  → hasFeature()
 *   "how many seats are used vs paid?"   → seatUsage()
 *
 * `resolveEntitlement` is PURE (takes a subscription-shaped object, no DB) so
 * the access rules are unit-tested directly; `getEntitlement` loads the
 * subscription and delegates.
 *
 * Rule: a workspace whose subscription lapsed falls back to the FREE plan
 * rather than losing access outright. Their leads are their livelihood — we
 * degrade features, we never lock people out of their own data.
 */

const Subscription = require('../models/Subscription');
const { getPlan, DEFAULT_PLAN_ID, FEATURES } = require('../config/plans');

/**
 * Pure. Given a subscription-shaped object (or null) return the effective
 * entitlement for a workspace.
 *
 * @param {Object|null} sub    { planId, status, seats, currentPeriodEnd, ... }
 * @returns {{ planId, plan, status, active, seats, features, trialEndsAt, currentPeriodEnd, cancelAtPeriodEnd }}
 */
const resolveEntitlement = (sub) => {
  const status = sub?.status || 'none';
  const active = ['trialing', 'active', 'past_due'].includes(status);
  // Lapsed / never-subscribed → free tier entitlements, never zero access.
  const planId = active ? sub?.planId || DEFAULT_PLAN_ID : DEFAULT_PLAN_ID;
  const plan = getPlan(planId);

  // The seat LIMIT. A plan with `seats: null` is unlimited and stays unlimited
  // whatever quantity Stripe reports — never collapse that to a number, or an
  // unlimited brokerage reads as over-seat. Otherwise the purchased quantity is
  // the limit, falling back to the plan's own cap.
  const seats = plan.seats == null ? null : (active && sub?.seats) || plan.seats;

  return {
    planId: plan.id,
    planName: plan.name,
    status,
    active,
    seats,
    features: plan.features,
    trialEndsAt: sub?.trialEndsAt || null,
    currentPeriodEnd: sub?.currentPeriodEnd || null,
    cancelAtPeriodEnd: !!sub?.cancelAtPeriodEnd,
  };
};

/** Pure. Is `feature` included in the resolved entitlement? */
const entitlementHasFeature = (entitlement, feature) =>
  !!entitlement && Array.isArray(entitlement.features) && entitlement.features.includes(feature);

/**
 * Pure. Seat usage for a workspace.
 * `limit: null` means unlimited. `over` is how many members exceed the limit.
 */
const computeSeatUsage = (memberCount, entitlement) => {
  const limit = entitlement?.seats ?? null;
  const used = Number(memberCount) || 0;
  return {
    used,
    limit,
    over: limit == null ? 0 : Math.max(0, used - limit),
    withinLimit: limit == null ? true : used <= limit,
  };
};

// --- DB-backed wrappers ----------------------------------------------------

/** Load a workspace's subscription (or null) and resolve its entitlement. */
const getEntitlement = async (workspaceId) => {
  const sub = await Subscription.findOne({ workspaceId }).lean();
  return resolveEntitlement(sub);
};

/** Convenience: does this workspace have `feature` right now? */
const hasFeature = async (workspaceId, feature) =>
  entitlementHasFeature(await getEntitlement(workspaceId), feature);

/** Seat usage for a workspace, given its Organisation doc. */
const seatUsage = async (org) => {
  const entitlement = await getEntitlement(org._id);
  const memberCount = Array.isArray(org.members) ? org.members.length : 0;
  return { ...computeSeatUsage(memberCount, entitlement), entitlement };
};

module.exports = {
  FEATURES,
  resolveEntitlement,
  entitlementHasFeature,
  computeSeatUsage,
  getEntitlement,
  hasFeature,
  seatUsage,
};
