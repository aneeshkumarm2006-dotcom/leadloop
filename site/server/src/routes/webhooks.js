/**
 * webhooks.js — webhook routers (Phase 3, F7.6).
 *
 * Exports TWO routers because the inbound ingress is public and everything else
 * is authed:
 *
 *   - `publicWebhookRouter`  — `POST /api/webhooks/in/:token`. Mounted in app.js
 *     BEFORE any auth-gated router and WITHOUT `authMiddleware`. It applies its
 *     OWN body parser capped at 256KB (the global `express.json()` has no cap)
 *     and the F7 token-bucket rate limiter keyed per `(token, ip)`.
 *
 *   - `boardWebhookRouter`   — the admin, board-scoped management routes. Mounted
 *     under the authed `/api` surface; every handler re-checks board-admin access.
 *
 * See the PUBLIC ROUTE ALLOWLIST comment block in app.js for the full list of
 * unauthenticated paths.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const {
  receiveInbound,
  listEndpoints,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  testEndpoint,
  listDeliveries,
} = require('../controllers/webhookController');

// --- Public inbound router (NO auth) ---------------------------------------
const publicWebhookRouter = express.Router();
publicWebhookRouter.post(
  '/api/webhooks/in/:token',
  rateLimit(), // 60 req/min per (token, ip) → 429 on overflow
  express.json({ limit: '256kb' }), // body cap on this route only
  receiveInbound
);

// --- Admin board-scoped router (auth required) -----------------------------
const boardWebhookRouter = express.Router();
boardWebhookRouter.use(authMiddleware);
boardWebhookRouter.get('/boards/:id/webhooks', listEndpoints);
boardWebhookRouter.post('/boards/:id/webhooks', createEndpoint);
boardWebhookRouter.put('/boards/:id/webhooks/:wid', updateEndpoint);
boardWebhookRouter.delete('/boards/:id/webhooks/:wid', deleteEndpoint);
boardWebhookRouter.post('/boards/:id/webhooks/:wid/test', testEndpoint);
boardWebhookRouter.get('/boards/:id/webhooks/:wid/deliveries', listDeliveries);

module.exports = { publicWebhookRouter, boardWebhookRouter };
