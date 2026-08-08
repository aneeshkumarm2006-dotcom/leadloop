import api from './api';

/**
 * billingService — Stripe subscription endpoints (admin-only, org-scoped).
 *
 * Checkout and portal return a Stripe-hosted URL that the caller redirects to;
 * the plan itself only changes when Stripe's webhook reaches our server, so the
 * billing page re-fetches state on return rather than assuming success.
 */

/** GET /api/billing?orgId= — plan catalog + this workspace's subscription + seats. */
export const getBilling = async (orgId) => {
  const { data } = await api.get('/api/billing', { params: { orgId } });
  return data; // { configured, trialDays, plans, subscription, seats }
};

/** POST /api/billing/checkout — returns a Stripe Checkout URL to redirect to. */
export const createCheckout = async (orgId, planId) => {
  const { data } = await api.post('/api/billing/checkout', { orgId, planId });
  return data.url;
};

/** POST /api/billing/portal — returns a Stripe Customer Portal URL. */
export const createPortal = async (orgId) => {
  const { data } = await api.post('/api/billing/portal', { orgId });
  return data.url;
};
