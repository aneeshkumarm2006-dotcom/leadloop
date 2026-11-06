/**
 * capture.js — public routes for the no-code website snippet. NO auth: trust is
 * the public site key + per-request domain lock (controllers/captureController).
 *
 * Mounted in app.js BEFORE the global origin-restricted cors() and before any
 * auth-gated router (see the PUBLIC ROUTE ALLOWLIST there). Carries its own
 * text/JSON body parser and rate limits:
 *   - per visitor per site: 10 submissions / minute
 *   - per site overall:     300 submissions / hour
 * Rate keys use the visitor's real IP (first X-Forwarded-For hop) because the
 * app doesn't enable `trust proxy`, so `req.ip` is the host's proxy.
 */

const express = require('express');
const rateLimit = require('../middleware/rateLimit');
const { serveScript, getConfig, submit, clientIp } = require('../controllers/captureController');

const router = express.Router();

router.get('/capture.js', serveScript);
router.get('/api/capture/:siteKey/config', getConfig);

// The snippet posts JSON as text/plain (a CORS "simple request": no preflight,
// works with navigator.sendBeacon). Accept application/json too.
const body = [express.text({ type: 'text/plain', limit: '32kb' }), express.json({ limit: '32kb' })];
router.post(
  '/api/capture/:siteKey',
  rateLimit({ capacity: 10, windowMs: 60 * 1000, keyFn: (req) => `capture:${req.params.siteKey}:${clientIp(req)}` }),
  rateLimit({ capacity: 300, windowMs: 60 * 60 * 1000, keyFn: (req) => `capture-site:${req.params.siteKey}` }),
  ...body,
  submit
);

module.exports = router;
