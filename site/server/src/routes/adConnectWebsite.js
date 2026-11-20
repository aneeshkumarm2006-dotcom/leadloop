/**
 * adConnectWebsite.js — Ads & tracking → Website (admin). Mounted at '/api'.
 *
 *   POST /api/workspaces/:id/ad-connect/website/check                 20/hour/workspace
 *   GET  /api/workspaces/:id/ad-connect/website/:connectionId/wordpress-plugin.zip
 *   POST /api/workspaces/:id/ad-connect/website/email-developer       5/hour/workspace
 *
 * Auth is per route (not router.use) so mounting this router at '/api' never
 * intercepts other /api requests. Bearer-token auth (no cookies), so these
 * state-changing POSTs are not CSRF-reachable.
 */

const express = require('express');
const mongoose = require('mongoose');
const authMiddleware = require('../middleware/auth');
const { requireOrgAdmin } = require('../middleware/roleCheck');
const rateLimit = require('../middleware/rateLimit');
const c = require('../controllers/adConnectWebsiteController');

const router = express.Router();

// requireOrgAdmin casts :id — reject malformed ids before it (else a 500).
const validWorkspaceId = (req, res, next) =>
  mongoose.Types.ObjectId.isValid(String(req.params.id || '')) ? next() : res.status(400).json({ error: 'Invalid workspace id' });

const json = express.json({ limit: '16kb' });
const admin = [authMiddleware, validWorkspaceId, requireOrgAdmin];

router.post(
  '/workspaces/:id/ad-connect/website/check',
  json,
  ...admin,
  rateLimit({ capacity: 20, windowMs: 60 * 60 * 1000, keyFn: (req) => `adconnect-sitecheck:${req.params.id}` }),
  c.checkWebsite
);

router.get('/workspaces/:id/ad-connect/website/:connectionId/wordpress-plugin.zip', ...admin, c.wordpressPlugin);

router.post(
  '/workspaces/:id/ad-connect/website/email-developer',
  json,
  ...admin,
  rateLimit({ capacity: 5, windowMs: 60 * 60 * 1000, keyFn: (req) => `adconnect-email:${req.params.id}` }),
  c.emailDeveloper
);

module.exports = router;
