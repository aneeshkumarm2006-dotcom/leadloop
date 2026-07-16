/**
 * whatsapp.js — WhatsApp routers (Phase 3, F11.4).
 *
 *   - `publicWhatsAppRouter` — the Twilio inbound + status callbacks. NO auth:
 *     trust comes from the per-workspace Twilio signature (validated in the
 *     controller). Mounted in app.js ahead of every auth-gated router (allowlist
 *     block). Twilio POSTs `application/x-www-form-urlencoded`, so each route
 *     carries its OWN urlencoded parser (the public mount precedes the global
 *     `express.urlencoded()`), and the parsed params feed signature validation.
 *   - `whatsappRouter` — authed workspace config + templates (admin), member
 *     template list, the task-scoped WhatsApp tab, and the media upload. Mounted
 *     under `/api`.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const { requireOrgAdmin, requireResourceAccess } = require('../middleware/roleCheck');
const { whatsappMediaUpload } = require('../config/cloudinary');
const {
  inboundWhatsApp,
  statusCallback,
  getConfig,
  updateConfig,
  listTemplates,
  syncTemplates,
  listTaskWhatsApp,
  sendTaskWhatsApp,
  uploadMedia,
} = require('../controllers/whatsappController');

// --- Public Twilio callbacks (NO auth — signature-validated) ----------------
const publicWhatsAppRouter = express.Router();
const twilioBody = express.urlencoded({ extended: false, limit: '64kb' });
publicWhatsAppRouter.post('/api/whatsapp/inbound', twilioBody, inboundWhatsApp);
publicWhatsAppRouter.post('/api/whatsapp/status', twilioBody, statusCallback);

// --- Authed WhatsApp routes -------------------------------------------------
const whatsappRouter = express.Router();
whatsappRouter.use(authMiddleware);
// Workspace config — admin only (requireOrgAdmin reads :id).
whatsappRouter.get('/workspaces/:id/whatsapp/config', requireOrgAdmin, getConfig);
whatsappRouter.put('/workspaces/:id/whatsapp/config', requireOrgAdmin, updateConfig);
// Templates — any workspace member may list; only admins may sync from Twilio.
whatsappRouter.get(
  '/workspaces/:id/whatsapp/templates',
  requireResourceAccess('workspace'),
  listTemplates
);
whatsappRouter.post('/workspaces/:id/whatsapp/templates/sync', requireOrgAdmin, syncTemplates);
// Task-scoped WhatsApp tab — membership-gated in the controller.
whatsappRouter.get('/tasks/:id/whatsapp', listTaskWhatsApp);
whatsappRouter.post('/tasks/:id/whatsapp', sendTaskWhatsApp);
// Media attachment upload (compose modal) — Cloudinary-backed.
whatsappRouter.post('/whatsapp/media', whatsappMediaUpload.single('file'), uploadMedia);

module.exports = { publicWhatsAppRouter, whatsappRouter };
