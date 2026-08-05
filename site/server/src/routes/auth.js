const express = require('express');
const passport = require('../config/passport');
const authMiddleware = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const {
  googleCallback,
  getCurrentUser,
  logout,
  register,
  verifyEmail,
  resendCode,
  login,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');

const router = express.Router();

// Abuse limiter for the email+password endpoints. Keyed per (route-tag, ip,
// email) so one attacker IP can't grind a single mailbox and one mailbox can't
// be spammed from many IPs. The body is already parsed here (this router mounts
// AFTER express.json() in app.js), so req.body.email is available to the keyFn.
const authRateKey = (tag) => (req) => {
  const email =
    req.body && req.body.email ? String(req.body.email).trim().toLowerCase() : 'anon';
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  return `${tag}:${ip}:${email}`;
};

const FIFTEEN_MIN = 15 * 60 * 1000;
// Code-SENDING endpoints (email dispatch) — the tightest bucket: ~5 / 15 min.
const codeSendLimiter = rateLimit({
  capacity: 5,
  windowMs: FIFTEEN_MIN,
  keyFn: authRateKey('auth:send'),
});
// Credential/code-CHECKING endpoints — a bit more room for typos: ~10 / 15 min.
const attemptLimiter = rateLimit({
  capacity: 10,
  windowMs: FIFTEEN_MIN,
  keyFn: authRateKey('auth:try'),
});

// Initiate Google OAuth flow
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })
);

// Google OAuth callback — Passport verifies, controller signs JWT + redirects.
// Custom callback (instead of the middleware form) so an OAuth *error* — most
// commonly a token-exchange rejection from Google (`TokenError`, e.g. a wrong
// GOOGLE_CLIENT_SECRET or redirect_uri mismatch) — is logged with its real
// cause and redirected gracefully, rather than bubbling to Express as a raw
// "Internal Server Error". `failureRedirect` only covers auth *failures*, not
// thrown errors, which is why those previously 500'd.
router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err) {
      // passport-oauth2 TokenError carries Google's sub-code on `.code`
      // (invalid_client / invalid_grant / redirect_uri_mismatch) and any
      // response body on `.oauthError` — log both so the fix is unambiguous.
      console.error(
        '[auth/google/callback] OAuth error:',
        err.name || 'Error',
        '| message:', err.message,
        '| code:', err.code,
        '| status:', err.status,
        '| oauthError:', err.oauthError ? JSON.stringify(err.oauthError) : '—'
      );
      return res.redirect(`${process.env.CLIENT_URL}/login?error=auth_failed`);
    }
    if (!user) {
      return res.redirect(`${process.env.CLIENT_URL}/login?error=auth_failed`);
    }
    req.user = user;
    return googleCallback(req, res);
  })(req, res, next);
});

// --- Email + password auth (all PUBLIC — no authMiddleware) ----------------
// These live under the already-public /auth/* surface (see the PUBLIC ROUTE
// ALLOWLIST in app.js). Every handler validates its own input and fails closed;
// the rate limiters above cap abuse of the code-send + credential-check paths.
router.post('/register', codeSendLimiter, register);
router.post('/verify', attemptLimiter, verifyEmail);
router.post('/resend', codeSendLimiter, resendCode);
router.post('/login', attemptLimiter, login);
router.post('/forgot', codeSendLimiter, forgotPassword);
router.post('/reset', attemptLimiter, resetPassword);

// Current user (protected)
router.get('/me', authMiddleware, getCurrentUser);

// Logout (client-side token drop)
router.post('/logout', logout);

module.exports = router;
