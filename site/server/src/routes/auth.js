const express = require('express');
const passport = require('../config/passport');
const authMiddleware = require('../middleware/auth');
const {
  googleCallback,
  getCurrentUser,
  logout,
} = require('../controllers/authController');

const router = express.Router();

// Initiate Google OAuth flow
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })
);

// Google OAuth callback — Passport verifies, controller signs JWT + redirects
router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: `${process.env.CLIENT_URL}/login?error=auth_failed`,
  }),
  googleCallback
);

// Current user (protected)
router.get('/me', authMiddleware, getCurrentUser);

// Logout (client-side token drop)
router.post('/logout', logout);

module.exports = router;
