/**
 * whatsappController.js — WhatsApp config, templates, the task WhatsApp tab, and
 * the Twilio callbacks (Phase 3, F11.4).
 *
 * PUBLIC (no auth, allowlisted in app.js, Twilio-signature-validated):
 *   - POST /api/whatsapp/inbound   inbound reply → STOP/START opt-out OR route to
 *                                  task (which RE-OPENS the 24h window)
 *   - POST /api/whatsapp/status    delivery status callback → append statusUpdates
 *
 * AUTHED — workspace config + templates:
 *   - GET  /api/workspaces/:id/whatsapp/config           (admin, token redacted)
 *   - PUT  /api/workspaces/:id/whatsapp/config           (admin)
 *   - GET  /api/workspaces/:id/whatsapp/templates        (member)
 *   - POST /api/workspaces/:id/whatsapp/templates/sync   (admin)
 *
 * AUTHED — task-scoped (membership-gated):
 *   - GET  /api/tasks/:id/whatsapp                 thread + 24h window state
 *   - POST /api/tasks/:id/whatsapp                 manual send (free-form/template)
 *   - POST /api/whatsapp/media                     attachment upload (→ Cloudinary)
 */

const mongoose = require('mongoose');
const Task = require('../models/Task');
const Board = require('../models/Board');
const Organisation = require('../models/Organisation');
const WhatsAppConfig = require('../models/WhatsAppConfig');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const aesEncrypt = require('../utils/aesEncrypt');
const twilioSignature = require('../utils/twilioSignature');
const whatsappService = require('../services/whatsappService');
const { resolveInboundWhatsApp } = require('../services/whatsappInboundResolver');

const asId = (v) => (v == null ? '' : v.toString());
const isObjectId = (v) => v != null && mongoose.Types.ObjectId.isValid(asId(v));

/** Strip Twilio's `whatsapp:` prefix from a From/To param. */
const stripWhatsApp = (v) => String(v == null ? '' : v).replace(/^whatsapp:/i, '').trim();

// ===========================================================================
// Shared helpers (mirror smsController / emailController — self-contained)
// ===========================================================================

/**
 * Load a task and assert the caller may read/write it: personal → creator only;
 * board task → org membership. Returns { task, board?, workspaceId } or
 * { status, error }.
 */
const loadTaskAccess = async (taskId, userId) => {
  if (!isObjectId(taskId)) return { status: 400, error: 'Invalid task id' };
  const task = await Task.findById(taskId);
  if (!task) return { status: 404, error: 'Task not found' };
  if (task.isPersonal) {
    if (!task.createdBy || task.createdBy.toString() !== userId) {
      return { status: 403, error: 'Not authorised' };
    }
    return { task, workspaceId: null };
  }
  const board = await Board.findById(task.board);
  if (!board) return { status: 404, error: 'Board not found' };
  const org = await Organisation.findById(board.organisation);
  if (!org) return { status: 404, error: 'Organisation not found' };
  if (!org.members.some((m) => m.toString() === userId)) {
    return { status: 403, error: 'Not a member of this organisation' };
  }
  return { task, board, workspaceId: org._id };
};

/** First phone-column value on a (hydrated) task, or '' when none is set. */
const taskPhone = (task, board) => {
  if (!board || !Array.isArray(board.columns)) return '';
  const cv = task && task.columnValues;
  const read = (id) => (cv ? (typeof cv.get === 'function' ? cv.get(id) : cv[id]) : undefined);
  for (const col of board.columns) {
    if (col && col.type === 'phone') {
      const v = read(asId(col._id));
      const s = v == null ? '' : String(v).trim();
      if (s) return s;
    }
  }
  return '';
};

const serializeMessage = (m) => ({
  _id: m._id,
  taskId: m.taskId,
  direction: m.direction,
  from: m.from,
  to: m.to,
  body: m.body,
  mediaUrl: m.mediaUrl || null,
  twilioSid: m.twilioSid,
  status: m.status,
  statusUpdates: m.statusUpdates,
  error: m.error || null,
  sentAt: m.sentAt,
});

const serializeTemplate = (t) => ({
  _id: t._id,
  providerTemplateId: t.providerTemplateId,
  name: t.name || '',
  language: t.language || 'en',
  body: t.body || '',
  status: t.status,
  variables: Array.isArray(t.variables) ? t.variables : [],
  lastSyncedAt: t.lastSyncedAt,
});

/** Redacted config shape for client responses (never returns the token). */
const serializeConfig = (config, workspaceId) => {
  if (!config) {
    return {
      workspaceId: asId(workspaceId),
      exists: false,
      accountSid: '',
      whatsappSenderId: '',
      hasAuthToken: false,
    };
  }
  return {
    _id: config._id,
    workspaceId: asId(config.workspaceId),
    exists: true,
    accountSid: config.accountSid || '',
    whatsappSenderId: config.whatsappSenderId || '',
    hasAuthToken: !!config.authToken,
    updatedAt: config.updatedAt,
  };
};

/** Reconstruct the exact URL Twilio signed (configured base + request path). */
const callbackUrl = (req) => {
  const base = (process.env.TWILIO_WEBHOOK_BASE_URL || process.env.WEBHOOK_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base + req.originalUrl;
};

/**
 * Validate the inbound request's Twilio signature against the workspace's token.
 * A dev escape hatch (`TWILIO_SKIP_SIGNATURE_VALIDATION=true`) or a config with
 * no stored token outside production returns true so local testing works; in
 * production an unvalidatable request is rejected.
 */
const verifyTwilioRequest = (req, config) => {
  if (process.env.TWILIO_SKIP_SIGNATURE_VALIDATION === 'true') return true;
  const { authToken } = config.getDecryptedAuthToken();
  if (!authToken) return process.env.NODE_ENV !== 'production';
  const signature = req.get('X-Twilio-Signature');
  return twilioSignature.verify(authToken, signature, callbackUrl(req), req.body || {});
};

/** Find the workspace WhatsAppConfig for an inbound webhook by AccountSid then To. */
const resolveConfigForInbound = async (params) => {
  if (params.AccountSid) {
    const byAccount = await WhatsAppConfig.findOne({ accountSid: params.AccountSid });
    if (byAccount) return byAccount;
  }
  const to = stripWhatsApp(params.To);
  if (to) {
    const byNumber = await WhatsAppConfig.findOne({ whatsappSenderId: to });
    if (byNumber) return byNumber;
  }
  return null;
};

/** Empty TwiML 200 — acks the webhook without auto-replying. */
const respondTwiml = (res) => {
  res.set('Content-Type', 'text/xml');
  return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
};

/** First media URL on an inbound Twilio webhook (NumMedia / MediaUrl0). */
const inboundMediaUrl = (params) => {
  const n = parseInt(params.NumMedia, 10);
  if (Number.isFinite(n) && n > 0 && params.MediaUrl0) return params.MediaUrl0;
  return null;
};

// ===========================================================================
// PUBLIC — Twilio callbacks
// ===========================================================================

/** POST /api/whatsapp/inbound — inbound reply: opt-out keyword OR route to task. */
const inboundWhatsApp = async (req, res) => {
  try {
    const params = req.body || {};
    const config = await resolveConfigForInbound(params);
    // Unknown account/number → ack silently (never reveal which numbers exist).
    if (!config) return respondTwiml(res);
    if (!verifyTwilioRequest(req, config)) {
      return res.status(403).send('Invalid Twilio signature');
    }

    const workspaceId = config.workspaceId;
    const from = stripWhatsApp(params.From);
    const keyword = whatsappService.classifyKeyword(params.Body);

    if (keyword === 'stop') {
      await whatsappService.recordOptOut(workspaceId, from).catch(() => {});
      return respondTwiml(res);
    }
    if (keyword === 'start') {
      await whatsappService.removeOptOut(workspaceId, from).catch(() => {});
      return respondTwiml(res);
    }

    // Normal inbound — route to the matching task (best-effort; never 500 Twilio).
    // Persisting the inbound row RE-OPENS the 24h window (AC3).
    await resolveInboundWhatsApp({
      workspaceId,
      from,
      to: stripWhatsApp(params.To),
      body: params.Body,
      mediaUrl: inboundMediaUrl(params),
      twilioSid: params.MessageSid || params.SmsSid || null,
    }).catch((err) => console.error('[whatsappInbound] resolve failed:', err?.message || err));

    return respondTwiml(res);
  } catch (err) {
    console.error('inboundWhatsApp error:', err);
    // Still ack so Twilio doesn't hammer retries on a transient server error.
    return respondTwiml(res);
  }
};

/** POST /api/whatsapp/status — delivery status callback. */
const statusCallback = async (req, res) => {
  try {
    const params = req.body || {};
    if (!params.AccountSid) return res.status(204).end();
    const config = await WhatsAppConfig.findOne({ accountSid: params.AccountSid });
    if (!config) return res.status(204).end();
    if (!verifyTwilioRequest(req, config)) {
      return res.status(403).send('Invalid Twilio signature');
    }

    const sid = params.MessageSid || params.SmsSid;
    const status = params.MessageStatus || params.SmsStatus;
    if (sid && status) {
      await WhatsAppMessage.updateOne(
        { twilioSid: sid },
        {
          $set: { status: whatsappService.mapTwilioStatus(status) },
          $push: { statusUpdates: { status, at: new Date() } },
        }
      ).catch(() => {});
    }
    return res.status(204).end();
  } catch (err) {
    console.error('whatsapp statusCallback error:', err);
    return res.status(204).end();
  }
};

// ===========================================================================
// AUTHED — workspace config (admin; requireOrgAdmin gates the route)
// ===========================================================================

/** GET /api/workspaces/:id/whatsapp/config — redacted config (admin). */
const getConfig = async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const config = await WhatsAppConfig.findOne({ workspaceId });
    return res.json({ config: serializeConfig(config, workspaceId) });
  } catch (err) {
    console.error('getWhatsAppConfig error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** PUT /api/workspaces/:id/whatsapp/config — upsert (admin). Token write-only. */
const updateConfig = async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const body = req.body || {};

    const tokenProvided = typeof body.authToken === 'string' && body.authToken.trim();
    if (tokenProvided && !aesEncrypt.isConfigured()) {
      return res.status(503).json({ error: 'Token encryption is not configured on the server' });
    }

    if (body.whatsappSenderId != null && String(body.whatsappSenderId).trim()) {
      const e164 = whatsappService.toE164(body.whatsappSenderId);
      if (!whatsappService.isValidE164(e164)) {
        return res.status(400).json({ error: 'whatsappSenderId must be a valid phone number (E.164)' });
      }
    }

    let config = await WhatsAppConfig.findOne({ workspaceId });
    if (!config) config = new WhatsAppConfig({ workspaceId });

    if (body.accountSid !== undefined) config.accountSid = String(body.accountSid || '').trim();
    if (body.whatsappSenderId !== undefined) {
      const raw = String(body.whatsappSenderId || '').trim();
      config.whatsappSenderId = raw ? whatsappService.toE164(raw) : '';
    }
    // Token: write-only. A non-empty string sets it; explicit null clears it; an
    // omitted / empty value leaves the existing ciphertext untouched.
    if (tokenProvided) config.setAuthToken(body.authToken.trim());
    else if (body.authToken === null) config.setAuthToken(null);

    config.updatedAt = new Date();
    await config.save();
    return res.json({ config: serializeConfig(config, workspaceId) });
  } catch (err) {
    console.error('updateWhatsAppConfig error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ===========================================================================
// AUTHED — templates
// ===========================================================================

/** GET /api/workspaces/:id/whatsapp/templates — synced templates (member). */
const listTemplates = async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const templates = await WhatsAppTemplate.find({ workspaceId }).sort({ name: 1 }).lean();
    return res.json({ templates: templates.map(serializeTemplate) });
  } catch (err) {
    console.error('listWhatsAppTemplates error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/workspaces/:id/whatsapp/templates/sync — pull from Twilio (admin). */
const syncTemplates = async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const result = await whatsappService.syncTemplates(workspaceId);
    if (!result.ok) {
      const MAP = {
        no_whatsapp_config: [400, 'WhatsApp is not configured for this workspace'],
        sync_error: [502, result.error || 'Failed to sync templates from Twilio'],
      };
      const [code, error] = MAP[result.reason] || [502, 'Failed to sync templates'];
      return res.status(code).json({ error });
    }
    return res.json({
      count: result.count,
      templates: (result.templates || []).map(serializeTemplate),
    });
  } catch (err) {
    console.error('syncWhatsAppTemplates error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ===========================================================================
// AUTHED — task WhatsApp tab
// ===========================================================================

/** GET /api/tasks/:id/whatsapp — the task's WhatsApp thread + window state. */
const listTaskWhatsApp = async (req, res) => {
  try {
    const ctx = await loadTaskAccess(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const messages = await WhatsAppMessage.find({ taskId: req.params.id }).sort({ sentAt: -1 });

    // Surface the 24h window so the UI knows whether free-form is allowed (AC3).
    let windowOpen = false;
    let lastInboundAt = null;
    if (ctx.workspaceId) {
      const phone = taskPhone(ctx.task, ctx.board);
      if (phone) {
        lastInboundAt = await whatsappService.lastInboundAt({
          workspaceId: ctx.workspaceId,
          contact: phone,
          taskId: ctx.task._id,
        });
        windowOpen = whatsappService.isWindowOpen(lastInboundAt);
      }
    }

    return res.json({
      messages: messages.map(serializeMessage),
      windowOpen,
      lastInboundAt,
    });
  } catch (err) {
    console.error('listTaskWhatsApp error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/tasks/:id/whatsapp — send a manual WhatsApp message (chat reply). */
const sendTaskWhatsApp = async (req, res) => {
  try {
    const ctx = await loadTaskAccess(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    if (!ctx.workspaceId) {
      return res.status(400).json({ error: 'WhatsApp is only available on workspace tasks' });
    }

    const { to, body, templateId, variables, mediaUrl } = req.body || {};
    const dest = (to && String(to).trim()) || taskPhone(ctx.task, ctx.board);
    if (!dest) return res.status(400).json({ error: 'No phone number found for this task' });
    if (!String(body || '').trim() && !templateId && !mediaUrl) {
      return res.status(400).json({ error: 'A message, template, or media is required' });
    }

    const result = await whatsappService.send({
      workspaceId: ctx.workspaceId,
      to: dest,
      taskId: ctx.task._id,
      templateId: templateId || null,
      variables: variables && typeof variables === 'object' ? variables : {},
      body: body || '',
      mediaUrl: mediaUrl || null,
    });

    if (!result.ok) {
      const MAP = {
        no_whatsapp_config: [400, 'WhatsApp is not configured for this workspace'],
        invalid_number: [400, 'Invalid phone number'],
        opted_out: [400, 'This number has opted out'],
        template_not_found: [400, 'WhatsApp template not found'],
        window_closed: [400, 'Outside the 24-hour window — send an approved template instead'],
        template_not_approved: [400, 'This template is not approved for sending outside the 24-hour window'],
        empty_message: [400, 'A message, template, or media is required'],
        send_error: [502, result.error || 'Failed to send WhatsApp message'],
      };
      const [code, error] = MAP[result.reason] || [502, 'Failed to send WhatsApp message'];
      return res.status(code).json({
        error,
        windowOpen: result.windowOpen === true,
        message: result.message ? serializeMessage(result.message) : undefined,
      });
    }
    return res.status(201).json({ message: serializeMessage(result.message), windowOpen: result.windowOpen === true });
  } catch (err) {
    console.error('sendTaskWhatsApp error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/whatsapp/media — upload one attachment to Cloudinary (compose). */
const uploadMedia = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    return res.status(201).json({
      url: req.file.path,
      name: req.file.originalname,
      mime: req.file.mimetype,
      size: req.file.size,
    });
  } catch (err) {
    console.error('uploadWhatsAppMedia error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  // public
  inboundWhatsApp,
  statusCallback,
  // admin config
  getConfig,
  updateConfig,
  // templates
  listTemplates,
  syncTemplates,
  // task tab
  listTaskWhatsApp,
  sendTaskWhatsApp,
  uploadMedia,
};
