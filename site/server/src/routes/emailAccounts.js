/**
 * emailAccounts.js — email-account routers (Phase 3, F8.5).
 *
 * Two routers, mirroring the F7 public/authed split:
 *   - `publicEmailAccountRouter` — `GET /api/email-accounts/oauth/callback/:provider`
 *     (the OAuth redirect target). NO auth: the caller is the user's browser
 *     returning from the provider; trust comes from the signed `state` JWT.
 *     Mounted in app.js ahead of every auth-gated router (allowlist block).
 *   - `emailAccountRouter` — authed list / connect / disconnect.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  listAccounts,
  connectProvider,
  oauthCallback,
  disconnectAccount,
} = require('../controllers/emailAccountController');

// --- Public OAuth callback (NO auth — state-verified) ----------------------
const publicEmailAccountRouter = express.Router();
publicEmailAccountRouter.get('/api/email-accounts/oauth/callback/:provider', oauthCallback);

// --- Authed account management ---------------------------------------------
const emailAccountRouter = express.Router();
emailAccountRouter.use(authMiddleware);
emailAccountRouter.get('/email-accounts', listAccounts);
emailAccountRouter.post('/email-accounts/connect/:provider', connectProvider);
emailAccountRouter.delete('/email-accounts/:id', disconnectAccount);

module.exports = { publicEmailAccountRouter, emailAccountRouter };
