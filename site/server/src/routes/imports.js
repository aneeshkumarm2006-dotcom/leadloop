/**
 * imports.js — CSV import (authed; admin enforced in the controller).
 *
 * Mounted at the app ROOT and BEFORE the global `express.json()`, because these
 * two routes need a 12MB body limit that the global 100KB parser would reject
 * first.
 *
 * Because of that mount position, every middleware here MUST be attached
 * per-route rather than with `router.use(...)`. A router-level `use()` on a
 * path-less mount runs for EVERY request that reaches it — which previously put
 * `authMiddleware` in front of `/auth/login` and `/auth/google` and 401'd the
 * entire sign-in flow. Keep the parser and the auth check inline below.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const { previewImport, runImport } = require('../controllers/importController');

const router = express.Router();

// Per-route only — never router.use() here. See the note above.
const bigBody = express.json({ limit: '12mb' });

router.post('/api/boards/:id/import/preview', bigBody, authMiddleware, previewImport);
router.post('/api/boards/:id/import', bigBody, authMiddleware, runImport);

module.exports = router;
