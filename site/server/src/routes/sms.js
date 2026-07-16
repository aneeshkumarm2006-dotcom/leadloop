/**
 * sms.js — SMS routers (Phase 3, F10.4).
 *
 *   - `publicSmsRouter` — the Twilio inbound + status callbacks. NO auth: trust
 *     comes from the per-workspace Twilio signature (validated in the
 *     controller). Mounted in app.js ahead of every auth-gated router (allowlist
 *     block). Twilio POSTs `application/x-www-form-urlencoded`, so each route
 *     carries its OWN urlencoded parser (the public mount precedes the global
 *     `express.urlencoded()`), and the parsed params feed signature validation.
 *   - `smsRouter` — authed workspace config (admin) + task-scoped SMS tab.
 *     Mounted under `/api`.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const { requireOrgAdmin } = require('../middleware/roleCheck');
const {
  inboundSms,
  statusCallback,
  getSmsConfig,
  updateSmsConfig,
  listOptOuts,
  listTaskSms,
  sendTaskSms,
} = require('../controllers/smsController');

// --- Public Twilio callbacks (NO auth — signature-validated) ----------------
const publicSmsRouter = express.Router();
const twilioBody = express.urlencoded({ extended: false, limit: '64kb' });
publicSmsRouter.post('/api/sms/inbound', twilioBody, inboundSms);
publicSmsRouter.post('/api/sms/status', twilioBody, statusCallback);

// --- Authed SMS routes ------------------------------------------------------
const smsRouter = express.Router();
smsRouter.use(authMiddleware);
// Workspace config + opt-out list — admin only (requireOrgAdmin reads :id).
smsRouter.get('/workspaces/:id/sms-config', requireOrgAdmin, getSmsConfig);
smsRouter.put('/workspaces/:id/sms-config', requireOrgAdmin, updateSmsConfig);
smsRouter.get('/workspaces/:id/sms-opt-outs', requireOrgAdmin, listOptOuts);
// Task-scoped SMS tab — membership-gated in the controller.
smsRouter.get('/tasks/:id/sms', listTaskSms);
smsRouter.post('/tasks/:id/sms', sendTaskSms);

module.exports = { publicSmsRouter, smsRouter };
