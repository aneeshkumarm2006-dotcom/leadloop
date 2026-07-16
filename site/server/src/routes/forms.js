/**
 * forms.js — form routers (Phase 4, F13.4).
 *
 * Exports TWO routers because the public form surface is unauthenticated and
 * everything else is admin/board-scoped:
 *
 *   - `publicFormRouter` — `GET /f/:slug` (render config) + `POST /f/:slug/submit`.
 *     Mounted in app.js BEFORE any auth-gated router and WITHOUT `authMiddleware`.
 *     The submit route carries its OWN body parser (the global `express.json()`
 *     is mounted after it) capped at 256KB and the F7 token-bucket rate limiter
 *     keyed per `(slug, ip)` (60 req/min → 429 on overflow).
 *
 *   - `boardFormRouter` — authed form management; every handler re-checks board
 *     membership (reads) / workspace-admin (writes).
 *
 * See the PUBLIC ROUTE ALLOWLIST comment block in app.js.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const {
  renderForm,
  submitForm,
  listForms,
  getForm,
  createForm,
  updateForm,
  deleteForm,
} = require('../controllers/formController');

// --- Public form router (NO auth) ------------------------------------------
const publicFormRouter = express.Router();
publicFormRouter.get('/f/:slug', renderForm);
publicFormRouter.post(
  '/f/:slug/submit',
  rateLimit({ keyFn: (req) => `form:${req.params.slug}:${req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'}` }),
  express.json({ limit: '256kb' }), // body cap on this route only
  submitForm
);

// --- Admin board-scoped router (auth required) -----------------------------
const boardFormRouter = express.Router();
boardFormRouter.use(authMiddleware);
boardFormRouter.get('/boards/:id/forms', listForms);
boardFormRouter.post('/boards/:id/forms', createForm);
boardFormRouter.get('/forms/:id', getForm);
boardFormRouter.patch('/forms/:id', updateForm);
boardFormRouter.delete('/forms/:id', deleteForm);

module.exports = { publicFormRouter, boardFormRouter };
