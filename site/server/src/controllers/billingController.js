/**
 * billingController.js — Stripe subscription billing for a workspace.
 *
 * Four surfaces:
 *   GET  /api/billing              (admin) plan catalog + this workspace's state
 *   POST /api/billing/checkout     (admin) → Stripe Checkout URL
 *   POST /api/billing/portal       (admin) → Stripe Customer Portal URL
 *   POST /api/billing/webhook      (PUBLIC, signature-verified) lifecycle sync
 *
 * ─── Trust model ───────────────────────────────────────────────────────────
 * The webhook is the ONLY writer of plan/status. A client can never tell us it
 * upgraded: checkout returns a redirect URL, and entitlements change only when
 * Stripe says so, with `constructEvent` verifying the signature against the
 * raw body. That means the route must receive the UNPARSED body (see
 * routes/billing.js — it mounts express.raw before the global json parser).
 *
 * Stripe is configured lazily: the app must boot fine with no Stripe keys (dev,
 * CI, self-host), in which case billing endpoints report "not configured"
 * instead of crashing the server at require-time.
 */

const mongoose = require('mongoose');
const Organisation = require('../models/Organisation');
const Subscription = require('../models/Subscription');
const {
  getPlan,
  listPlans,
  planForPriceId,
  isPurchasable,
  TRIAL_DAYS,
} = require('../config/plans');
const { resolveEntitlement, computeSeatUsage } = require('../services/billingService');

let _stripe = null;
/** Lazily construct the Stripe client; null when the key isn't configured. */
const stripe = () => {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // eslint-disable-next-line global-require
  _stripe = require('stripe')(key);
  return _stripe;
};

const APP_URL = () => process.env.CLIENT_URL || 'http://localhost:5173';

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

/** Load the workspace asserting the caller is one of its admins. */
const loadAdminOrg = async (orgId, userId) => {
  if (!orgId || !mongoose.Types.ObjectId.isValid(orgId)) {
    return { status: 400, error: 'A valid orgId is required' };
  }
  const org = await Organisation.findById(orgId);
  if (!org) return { status: 404, error: 'Organisation not found' };
  if (!org.members.some((m) => m.toString() === userId)) {
    return { status: 403, error: 'Not a member of this workspace' };
  }
  if (!isOrgAdmin(org, userId)) return { status: 403, error: 'Admin access required' };
  return { org };
};

// ===========================================================================
// GET /api/billing?orgId= — catalog + current state
// ===========================================================================

const getBilling = async (req, res) => {
  try {
    const ctx = await loadAdminOrg(req.query.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const sub = await Subscription.findOne({ workspaceId: ctx.org._id }).lean();
    const entitlement = resolveEntitlement(sub);
    const seats = computeSeatUsage(
      Array.isArray(ctx.org.members) ? ctx.org.members.length : 0,
      entitlement
    );

    return res.json({
      configured: !!stripe(),
      trialDays: TRIAL_DAYS,
      plans: listPlans(),
      subscription: {
        planId: entitlement.planId,
        planName: entitlement.planName,
        status: entitlement.status,
        active: entitlement.active,
        features: entitlement.features,
        currentPeriodEnd: entitlement.currentPeriodEnd,
        trialEndsAt: entitlement.trialEndsAt,
        cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
        hasBillingProfile: !!sub?.stripeCustomerId,
      },
      seats,
    });
  } catch (err) {
    console.error('getBilling error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ===========================================================================
// POST /api/billing/checkout — start a subscription
// ===========================================================================

const createCheckout = async (req, res) => {
  try {
    const client = stripe();
    if (!client) return res.status(503).json({ error: 'Billing is not configured' });

    const ctx = await loadAdminOrg(req.body.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const plan = getPlan(req.body.planId);
    if (!isPurchasable(plan)) {
      return res.status(400).json({ error: 'That plan is not available for purchase' });
    }

    // Seats: bill for the workspace's current headcount (at least 1), capped by
    // the plan's own limit so a Team checkout can't be opened for 40 people.
    const memberCount = Array.isArray(ctx.org.members) ? ctx.org.members.length : 1;
    const quantity = plan.seats == null ? Math.max(1, memberCount) : Math.min(Math.max(1, memberCount), plan.seats);

    // Reuse the existing billing profile so invoices stay on one customer.
    let sub = await Subscription.findOne({ workspaceId: ctx.org._id });
    let customerId = sub?.stripeCustomerId || null;
    if (!customerId) {
      const customer = await client.customers.create({
        name: ctx.org.name,
        metadata: { workspaceId: String(ctx.org._id) },
      });
      customerId = customer.id;
      if (!sub) sub = new Subscription({ workspaceId: ctx.org._id });
      sub.stripeCustomerId = customerId;
      await sub.save();
    }

    // Only grant a trial to a workspace that has never had a subscription.
    const trialEligible = !sub?.stripeSubscriptionId && TRIAL_DAYS > 0;

    const session = await client.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: plan.priceId, quantity }],
      allow_promotion_codes: true,
      subscription_data: {
        ...(trialEligible ? { trial_period_days: TRIAL_DAYS } : {}),
        metadata: { workspaceId: String(ctx.org._id), planId: plan.id },
      },
      // The webhook — not this redirect — is what actually grants the plan.
      success_url: `${APP_URL()}/billing?checkout=success`,
      cancel_url: `${APP_URL()}/billing?checkout=cancelled`,
      metadata: { workspaceId: String(ctx.org._id), planId: plan.id },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('createCheckout error:', err);
    return res.status(500).json({ error: 'Could not start checkout' });
  }
};

// ===========================================================================
// POST /api/billing/portal — manage payment method / invoices / cancel
// ===========================================================================

const createPortal = async (req, res) => {
  try {
    const client = stripe();
    if (!client) return res.status(503).json({ error: 'Billing is not configured' });

    const ctx = await loadAdminOrg(req.body.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const sub = await Subscription.findOne({ workspaceId: ctx.org._id });
    if (!sub?.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing profile yet — subscribe first' });
    }

    const session = await client.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${APP_URL()}/billing`,
    });
    return res.json({ url: session.url });
  } catch (err) {
    console.error('createPortal error:', err);
    return res.status(500).json({ error: 'Could not open the billing portal' });
  }
};

// ===========================================================================
// POST /api/billing/webhook — the only writer of plan/status
// ===========================================================================

/** Apply a Stripe Subscription object onto our cached projection. */
const applySubscription = async (stripeSub) => {
  const workspaceId =
    stripeSub?.metadata?.workspaceId ||
    stripeSub?.items?.data?.[0]?.metadata?.workspaceId ||
    null;

  // Prefer the customer id (stable) and fall back to workspace metadata.
  const query = stripeSub.customer
    ? { stripeCustomerId: stripeSub.customer }
    : workspaceId && mongoose.Types.ObjectId.isValid(workspaceId)
      ? { workspaceId }
      : null;
  if (!query) return;

  const sub = await Subscription.findOne(query);
  if (!sub) return; // a customer we never created — ignore rather than guess

  const item = stripeSub.items?.data?.[0] || null;
  const priceId = item?.price?.id || null;
  const plan = planForPriceId(priceId);

  sub.status = stripeSub.status || sub.status;
  if (plan) sub.planId = plan.id;
  sub.stripeSubscriptionId = stripeSub.id || sub.stripeSubscriptionId;
  sub.stripePriceId = priceId || sub.stripePriceId;
  if (item?.quantity) sub.seats = item.quantity;
  sub.cancelAtPeriodEnd = !!stripeSub.cancel_at_period_end;
  if (stripeSub.current_period_end) sub.currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);
  if (stripeSub.trial_end) sub.trialEndsAt = new Date(stripeSub.trial_end * 1000);
  sub.lastEventAt = new Date();
  await sub.save();
};

/**
 * POST /api/billing/webhook (public). Verifies the Stripe signature against the
 * RAW body, then syncs subscription lifecycle events. Always 200s on events we
 * don't handle so Stripe doesn't retry them forever.
 */
const handleWebhook = async (req, res) => {
  const client = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!client || !secret) return res.status(503).json({ error: 'Billing is not configured' });

  let event;
  try {
    event = client.webhooks.constructEvent(req.body, req.get('stripe-signature'), secret);
  } catch (err) {
    // Bad signature = not from Stripe. Never process it.
    console.warn('stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applySubscription(event.data.object);
        break;

      case 'checkout.session.completed': {
        // Fetch the full subscription — the session carries only its id.
        const session = event.data.object;
        if (session.subscription) {
          const full = await client.subscriptions.retrieve(session.subscription);
          await applySubscription(full);
        }
        break;
      }

      default:
        break; // unhandled event types are fine
    }
    return res.json({ received: true });
  } catch (err) {
    console.error('stripe webhook handling error:', err);
    // 500 → Stripe retries, which is what we want for a transient DB failure.
    return res.status(500).json({ error: 'Webhook handling failed' });
  }
};

module.exports = { getBilling, createCheckout, createPortal, handleWebhook };
