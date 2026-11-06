/**
 * adConversions.js — ad-platform conversion settings + logs. Mounted at /api.
 * Workspace routes are admin-only (requireOrgAdmin reads :id); the per-lead log
 * checks workspace membership in the controller.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const { requireOrgAdmin } = require('../middleware/roleCheck');
const c = require('../controllers/adConversionController');

const router = express.Router();
router.use(authMiddleware);

router.get('/workspaces/:id/ad-conversions', requireOrgAdmin, c.getConfig);
router.put('/workspaces/:id/ad-conversions', requireOrgAdmin, c.updateConfig);
router.post('/workspaces/:id/ad-conversions/meta/test', requireOrgAdmin, c.testMeta);
router.get('/workspaces/:id/ad-conversions/events', requireOrgAdmin, c.listEvents);
router.get('/workspaces/:id/ad-conversions/checklist', requireOrgAdmin, c.checklist);
router.get('/tasks/:id/conversions', c.listTaskConversions);

module.exports = router;
