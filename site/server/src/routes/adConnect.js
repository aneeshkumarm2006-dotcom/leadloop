/**
 * adConnect.js — one-click ad-platform connections. Two routers:
 *
 *   - `publicAdConnectRouter` (NO auth — see the PUBLIC ROUTE ALLOWLIST in
 *     app.js): the OAuth callbacks (signed single-use state) and the Meta /
 *     TikTok lead webhooks (signature / URL-secret verified). Mounted ABOVE the
 *     global express.json(): the webhooks carry their own express.raw parser
 *     because signature checks hash the exact raw bytes.
 *
 *   - `adConnectRouter` — admin-only workspace routes (authMiddleware first,
 *     requireOrgAdmin on every route; it reads :id). Auth is a bearer token,
 *     not a cookie, so these are not CSRF-reachable.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { requireOrgAdmin } = require('../middleware/roleCheck');
const c = require('../controllers/adConnectController');

const ipKey = (prefix) => (req) => `${prefix}:${req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'}`;

// --- public ------------------------------------------------------------------------
const publicAdConnectRouter = express.Router();

publicAdConnectRouter.get(
  '/api/ad-connect/callback/:platform',
  rateLimit({ capacity: 30, windowMs: 60 * 1000, keyFn: ipKey('adcb') }),
  c.callback
);

const rawJson = express.raw({ type: () => true, limit: '1mb' });
// Platform IPs are shared across many senders; generous limit, still bounded.
const webhookLimit = (name) => rateLimit({ capacity: 600, windowMs: 60 * 1000, keyFn: ipKey(name) });

publicAdConnectRouter.get('/api/ad-connect/webhooks/meta', webhookLimit('adwh-meta'), c.metaWebhookVerify);
publicAdConnectRouter.post('/api/ad-connect/webhooks/meta', webhookLimit('adwh-meta'), rawJson, c.metaWebhook);
publicAdConnectRouter.post('/api/ad-connect/webhooks/tiktok', webhookLimit('adwh-tiktok'), rawJson, c.tiktokWebhook);

// --- admin -------------------------------------------------------------------------
const adConnectRouter = express.Router();
// Auth first for everything under the prefix; requireOrgAdmin on each route
// (it reads :id from the route's own params).
adConnectRouter.use('/workspaces/:id/ad-connect', authMiddleware);

const base = '/workspaces/:id/ad-connect';
// Starting OAuth is cheap for us but each click mints a state — keep it bounded per user.
const startLimit = rateLimit({ capacity: 10, windowMs: 60 * 1000, keyFn: (req) => `adstart:${req.user && req.user.userId}` });
// Calls that hit the platforms' APIs (and our quota with them).
const platformLimit = rateLimit({ capacity: 60, windowMs: 60 * 1000, keyFn: (req) => `adapi:${req.params.id}` });

adConnectRouter.get(`${base}/overview`, requireOrgAdmin, c.overview);
adConnectRouter.post(`${base}/:platform/start`, requireOrgAdmin, startLimit, c.start);
adConnectRouter.post(`${base}/:platform/confirm`, requireOrgAdmin, startLimit, c.confirm);

adConnectRouter.get(`${base}/meta/assets`, requireOrgAdmin, platformLimit, c.metaAssets);
adConnectRouter.get(`${base}/meta/pixels`, requireOrgAdmin, platformLimit, c.metaPixels);
adConnectRouter.post(`${base}/meta/select`, requireOrgAdmin, platformLimit, c.metaSelect);
adConnectRouter.post(`${base}/meta/lead-ads`, requireOrgAdmin, platformLimit, c.metaLeadAds);
adConnectRouter.post(`${base}/meta/disconnect`, requireOrgAdmin, platformLimit, c.metaDisconnect);

adConnectRouter.get(`${base}/google/accounts`, requireOrgAdmin, platformLimit, c.googleAccounts);
adConnectRouter.post(`${base}/google/select`, requireOrgAdmin, platformLimit, c.googleSelect);
adConnectRouter.get(`${base}/google/gtm/containers`, requireOrgAdmin, platformLimit, c.gtmContainers);
adConnectRouter.post(`${base}/google/gtm/install`, requireOrgAdmin, platformLimit, c.gtmInstall);
adConnectRouter.post(`${base}/google/disconnect`, requireOrgAdmin, platformLimit, c.googleDisconnect);

adConnectRouter.get(`${base}/tiktok/assets`, requireOrgAdmin, platformLimit, c.tiktokAssets);
adConnectRouter.get(`${base}/tiktok/pixels`, requireOrgAdmin, platformLimit, c.tiktokPixels);
adConnectRouter.post(`${base}/tiktok/select`, requireOrgAdmin, platformLimit, c.tiktokSelect);
adConnectRouter.post(`${base}/tiktok/test`, requireOrgAdmin, platformLimit, c.tiktokTest);
adConnectRouter.post(`${base}/tiktok/disconnect`, requireOrgAdmin, platformLimit, c.tiktokDisconnect);

module.exports = { publicAdConnectRouter, adConnectRouter };
