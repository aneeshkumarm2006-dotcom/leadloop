/**
 * imports.js — CSV import (authed; admin enforced in the controller).
 *
 * Carries its OWN body parser at 12MB. The global express.json() caps at the
 * Express default (100KB), which a few thousand contacts blows past instantly —
 * so this router is mounted BEFORE the global parser in app.js.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const { previewImport, runImport } = require('../controllers/importController');

const router = express.Router();
router.use(express.json({ limit: '12mb' }));
router.use(authMiddleware);

router.post('/api/boards/:id/import/preview', previewImport);
router.post('/api/boards/:id/import', runImport);

module.exports = router;
