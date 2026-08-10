/**
 * compliance.js — consent records, suppression list and audit export. All
 * authed; the controller enforces workspace admin on the mutating routes.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  listSuppressions,
  addSuppression,
  removeSuppression,
  getConsent,
  setConsent,
  exportAudit,
} = require('../controllers/complianceController');

const router = express.Router();
router.use(authMiddleware);

router.get('/compliance/suppressions', listSuppressions);
router.post('/compliance/suppressions', addSuppression);
router.delete('/compliance/suppressions/:id', removeSuppression);
router.get('/compliance/consent/:taskId', getConsent);
router.post('/compliance/consent/:taskId', setConsent);
router.get('/compliance/export', exportAudit);

module.exports = router;
