/**
 * billing.js — Stripe billing routers.
 *
 * TWO routers, for the same reason the lead/webhook routes split:
 *
 *   - `publicBillingRouter` — `POST /api/billing/webhook`. NO auth (the caller
 *     is Stripe, authenticated by its signature) and, critically, its own
 *     `express.raw` body parser. Signature verification hashes the EXACT bytes
 *     Stripe sent, so this must be mounted BEFORE the global `express.json()`;
 *     once JSON has parsed and re-serialised the body the signature can never
 *     validate. See the PUBLIC ROUTE ALLOWLIST in app.js.
 *
 *   - `billingRouter` — authed admin management (catalog, checkout, portal).
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  getBilling,
  createCheckout,
  createPortal,
  handleWebhook,
} = require('../controllers/billingController');

// --- Public webhook router (NO auth, RAW body) -----------------------------
const publicBillingRouter = express.Router();
publicBillingRouter.post(
  '/api/billing/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  handleWebhook
);

// --- Authed admin router ---------------------------------------------------
const billingRouter = express.Router();
billingRouter.use(authMiddleware);
billingRouter.get('/billing', getBilling);
billingRouter.post('/billing/checkout', createCheckout);
billingRouter.post('/billing/portal', createPortal);

module.exports = { publicBillingRouter, billingRouter };
