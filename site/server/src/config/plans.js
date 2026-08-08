/**
 * plans.js — the LeadLoop plan catalog (single source of truth for pricing,
 * seat limits, and feature entitlements).
 *
 * Pricing shape: per-seat monthly, the norm for real-estate team software, so
 * revenue grows with a brokerage's headcount instead of forcing a big-bang
 * upgrade. Three tiers:
 *
 *   solo       — a single agent running their own pipeline.
 *   team       — the paid default: small teams that buy leads and need the ad /
 *                portal connectors, automations and production reporting.
 *   brokerage  — multi-team offices: unlimited seats, API access, priority
 *                support.
 *
 * ─── Money lives in Stripe, not here ───────────────────────────────────────
 * `priceId` and `amount` are read from the environment. Stripe Price objects
 * are the authority on what a customer is charged; the `amount` here is ONLY
 * for display, and a tier with no configured `priceId` is automatically not
 * purchasable (see `isPurchasable`) so a misconfigured deploy shows "contact
 * us" rather than a checkout that would fail. Set these in Render:
 *
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRICE_SOLO, STRIPE_PRICE_TEAM, STRIPE_PRICE_BROKERAGE
 *   (optional display overrides) PRICE_AMOUNT_SOLO / _TEAM / _BROKERAGE
 *
 * ─── Features ──────────────────────────────────────────────────────────────
 * `features` is the entitlement set checked by billingService.hasFeature().
 * Keep these keys stable — they're referenced by gating code and by the client.
 */

const FEATURES = {
  CORE: 'core', // boards, leads, kanban, forms — everyone
  LEAD_CONNECTORS: 'lead_connectors', // ad / portal one-click sources
  AUTOMATIONS: 'automations',
  BOOKING: 'booking',
  PRODUCTION_REPORTS: 'production_reports', // GCI / ROI / leaderboard
  API_ACCESS: 'api_access',
  PRIORITY_SUPPORT: 'priority_support',
};

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * The catalog. `seats: null` means unlimited. `amount` is in whole dollars per
 * seat per month, for display only.
 */
const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    amount: 0,
    seats: 2,
    boards: 3,
    priceId: null, // never purchasable — the default state, not a product
    features: [FEATURES.CORE],
  },
  solo: {
    id: 'solo',
    name: 'Solo',
    amount: num(process.env.PRICE_AMOUNT_SOLO, 29),
    seats: 1,
    boards: null,
    priceId: process.env.STRIPE_PRICE_SOLO || null,
    features: [FEATURES.CORE, FEATURES.BOOKING, FEATURES.AUTOMATIONS],
  },
  team: {
    id: 'team',
    name: 'Team',
    amount: num(process.env.PRICE_AMOUNT_TEAM, 59),
    seats: 10,
    boards: null,
    priceId: process.env.STRIPE_PRICE_TEAM || null,
    recommended: true,
    features: [
      FEATURES.CORE,
      FEATURES.BOOKING,
      FEATURES.AUTOMATIONS,
      FEATURES.LEAD_CONNECTORS,
      FEATURES.PRODUCTION_REPORTS,
    ],
  },
  brokerage: {
    id: 'brokerage',
    name: 'Brokerage',
    amount: num(process.env.PRICE_AMOUNT_BROKERAGE, 99),
    seats: null, // unlimited
    boards: null,
    priceId: process.env.STRIPE_PRICE_BROKERAGE || null,
    features: [
      FEATURES.CORE,
      FEATURES.BOOKING,
      FEATURES.AUTOMATIONS,
      FEATURES.LEAD_CONNECTORS,
      FEATURES.PRODUCTION_REPORTS,
      FEATURES.API_ACCESS,
      FEATURES.PRIORITY_SUPPORT,
    ],
  },
};

/** The plan every workspace starts on when it has no subscription. */
const DEFAULT_PLAN_ID = 'free';

/** Days of full-featured trial granted on first paid signup. */
const TRIAL_DAYS = num(process.env.STRIPE_TRIAL_DAYS, 14);

/** A tier can be bought only when its Stripe Price is actually configured. */
const isPurchasable = (plan) => !!(plan && plan.priceId);

/** Look up a plan by id, falling back to the free tier for unknown ids. */
const getPlan = (planId) => PLANS[planId] || PLANS[DEFAULT_PLAN_ID];

/** Resolve the plan a Stripe price id belongs to (used by the webhook). */
const planForPriceId = (priceId) =>
  priceId ? Object.values(PLANS).find((p) => p.priceId && p.priceId === priceId) || null : null;

/** Public, non-secret catalog for the billing page. */
const listPlans = () =>
  Object.values(PLANS).map((p) => ({
    id: p.id,
    name: p.name,
    amount: p.amount,
    seats: p.seats,
    boards: p.boards,
    features: p.features,
    recommended: !!p.recommended,
    purchasable: isPurchasable(p),
  }));

module.exports = {
  FEATURES,
  PLANS,
  DEFAULT_PLAN_ID,
  TRIAL_DAYS,
  getPlan,
  planForPriceId,
  isPurchasable,
  listPlans,
};
