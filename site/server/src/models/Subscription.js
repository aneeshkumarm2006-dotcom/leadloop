const mongoose = require('mongoose');

/**
 * Subscription — a workspace's billing state, mirrored from Stripe.
 *
 * Kept in its own collection rather than as fields on Organisation: the
 * org/admins/members shape is load-bearing for every permission check in the
 * app, and billing is a separate lifecycle written by an untrusted-ish external
 * webhook. One document per workspace (unique index).
 *
 * STRIPE IS THE SOURCE OF TRUTH. Everything here is a cached projection written
 * by the webhook handler so the app can answer "what plan is this workspace on"
 * without a network call on every request. Nothing in here should ever be
 * edited by a normal API request — the only writer is billingController's
 * webhook (plus checkout creating the customer id).
 */

const subscriptionSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organisation',
      required: true,
      unique: true,
      index: true,
    },

    // Plan id from config/plans.js — the entitlement key the app checks.
    planId: { type: String, default: 'free' },

    /**
     * Stripe's subscription status, mirrored verbatim:
     *   trialing | active | past_due | canceled | incomplete |
     *   incomplete_expired | unpaid | paused
     * `none` is our own value for "never subscribed" (free tier).
     */
    status: { type: String, default: 'none' },

    // Stripe identifiers. customerId persists across subscriptions so a
    // returning customer keeps one billing profile + invoice history.
    stripeCustomerId: { type: String, default: null, index: true },
    stripeSubscriptionId: { type: String, default: null, index: true },
    stripePriceId: { type: String, default: null },

    // Seats purchased (the Stripe line-item quantity). Compared against the
    // workspace's actual member count to surface over-seat usage.
    seats: { type: Number, default: 1 },

    // Period + trial bookkeeping, for the "renews on" / "trial ends" copy.
    currentPeriodEnd: { type: Date, default: null },
    trialEndsAt: { type: Date, default: null },
    cancelAtPeriodEnd: { type: Boolean, default: false },

    // Last webhook event applied — lets us ignore out-of-order deliveries.
    lastEventAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/**
 * Statuses that still grant access. `past_due` deliberately keeps access: the
 * card failed but Stripe is retrying, and locking a brokerage out of its CRM
 * over a temporary decline is worse than a few days of unpaid usage. Access is
 * only revoked once Stripe gives up and moves to `canceled` / `unpaid`.
 */
const ACTIVE_STATUSES = ['trialing', 'active', 'past_due'];

subscriptionSchema.methods.isActive = function isActive() {
  return ACTIVE_STATUSES.includes(this.status);
};

const Subscription = mongoose.model('Subscription', subscriptionSchema);
Subscription.ACTIVE_STATUSES = ACTIVE_STATUSES;

module.exports = Subscription;
