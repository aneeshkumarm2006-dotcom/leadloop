/**
 * emails.js — email routers (Phase 3, F8.5).
 *
 *   - `publicEmailRouter` — tracking pixels + click redirects + provider inbound
 *     push. NO auth (open pixels are hit by mail clients; inbound is verified by
 *     provider signature / signed Pub/Sub). Mounted in app.js ahead of every
 *     auth-gated router (allowlist block). The Gmail inbound route carries its
 *     own JSON parser since the public mount precedes the global `express.json()`.
 *   - `emailRouter` — authed task-scoped thread list + compose/send + the
 *     Cloudinary attachment upload. Mounted under `/api`.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const { emailAttachmentUpload } = require('../config/cloudinary');
const {
  trackOpen,
  trackClick,
  inboundGmail,
  inboundMicrosoft,
  listTaskEmails,
  sendTaskEmail,
  uploadEmailAttachment,
} = require('../controllers/emailController');

// --- Public tracking + inbound (NO auth) -----------------------------------
const publicEmailRouter = express.Router();
publicEmailRouter.get('/api/email/track/:messageId/open.gif', trackOpen);
publicEmailRouter.get('/api/email/track/:messageId/click', trackClick);
// Inbound provider push needs its own body parser (mounted before global json).
publicEmailRouter.post('/api/email/inbound/gmail', express.json({ limit: '1mb' }), inboundGmail);
publicEmailRouter.post(
  '/api/email/inbound/microsoft',
  express.json({ limit: '1mb' }),
  inboundMicrosoft
);

// --- Authed task-scoped email routes ---------------------------------------
const emailRouter = express.Router();
emailRouter.use(authMiddleware);
emailRouter.get('/tasks/:id/emails', listTaskEmails);
emailRouter.post('/tasks/:id/emails', sendTaskEmail);
emailRouter.post('/emails/attachments', emailAttachmentUpload.single('file'), uploadEmailAttachment);

module.exports = { publicEmailRouter, emailRouter };
