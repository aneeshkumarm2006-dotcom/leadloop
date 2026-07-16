/**
 * smsController.js — SMS config, task SMS tab, and the Twilio callbacks (F10.4).
 *
 * PUBLIC (no auth, allowlisted in app.js, Twilio-signature-validated):
 *   - POST /api/sms/inbound   inbound reply → STOP/START opt-out OR route to task
 *   - POST /api/sms/status    delivery status callback → append to statusUpdates
 *
 * AUTHED — workspace config (admin, token redacted):
 *   - GET  /api/workspaces/:id/sms-config
 *   - PUT  /api/workspaces/:id/sms-config
 *   - GET  /api/workspaces/:id/sms-opt-outs
 *
 * AUTHED — task-scoped (membership-gated):
 *   - GET  /api/tasks/:id/sms                 thread
 *   - POST /api/tasks/:id/sms                 send a manual SMS (chat reply)
 */

const mongoose = require('mongoose');
const Task = require('../models/Task');
const Board = require('../models/Board');
const Organisation = require('../models/Organisation');
const SmsConfig = require('../models/SmsConfig');
const SmsMessage = require('../models/SmsMessage');
const SmsOptOut = require('../models/SmsOptOut');
const aesEncrypt = require('../utils/aesEncrypt');
const twilioSignature = require('../utils/twilioSignature');
const smsService = require('../services/smsService');
const { resolveInboundSms } = require('../services/smsInboundResolver');

const asId = (v) => (v == null ? '' : v.toString());
const isObjectId = (v) => v != null && mongoose.Types.ObjectId.isValid(asId(v));

// ===========================================================================
// Shared helpers
// ===========================================================================

/**
 * Load a task and assert the caller may read/write it (mirrors
 * emailController.loadTaskAccess): personal → creator only; board task → org
 * membership. Returns { task, board?, workspaceId } or { status, error }.
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
  twilioSid: m.twilioSid,
  status: m.status,
  statusUpdates: m.statusUpdates,
  error: m.error || null,
  sentAt: m.sentAt,
});

/** Redacted config shape for client responses (never returns the token). */
const serializeConfig = (config, workspaceId) => {
  if (!config) {
    return {
      workspaceId: asId(workspaceId),
      exists: false,
      accountSid: '',
      defaultFrom: '',
      messagingServiceSid: '',
      appendOptOutFooter: true,
      hasAuthToken: false,
    };
  }
  return {
    _id: config._id,
    workspaceId: asId(config.workspaceId),
    exists: true,
    accountSid: config.accountSid || '',
    defaultFrom: config.defaultFrom || '',
    messagingServiceSid: config.messagingServiceSid || '',
    appendOptOutFooter: config.appendOptOutFooter !== false,
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

/** Find the workspace SmsConfig for an inbound webhook by AccountSid then To. */
const resolveConfigForInbound = async (params) => {
  if (params.AccountSid) {
    const byAccount = await SmsConfig.findOne({ accountSid: params.AccountSid });
    if (byAccount) return byAccount;
  }
  if (params.To) {
    const byNumber = await SmsConfig.findOne({ defaultFrom: params.To });
    if (byNumber) return byNumber;
  }
  return null;
};

/** Empty TwiML 200 — acks the webhook without auto-replying. */
const respondTwiml = (res) => {
  res.set('Content-Type', 'text/xml');
  return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
};

// ===========================================================================
// PUBLIC — Twilio callbacks
// ===========================================================================

/** POST /api/sms/inbound — inbound reply: opt-out keyword OR route to a task. */
const inboundSms = async (req, res) => {
  try {
    const params = req.body || {};
    const config = await resolveConfigForInbound(params);
    // Unknown account/number → ack silently (never reveal which numbers exist).
    if (!config) return respondTwiml(res);
    if (!verifyTwilioRequest(req, config)) {
      return res.status(403).send('Invalid Twilio signature');
    }

    const workspaceId = config.workspaceId;
    const from = params.From;
    const keyword = smsService.classifyKeyword(params.Body);

    if (keyword === 'stop') {
      await smsService.recordOptOut(workspaceId, from).catch(() => {});
      return respondTwiml(res);
    }
    if (keyword === 'start') {
      await smsService.removeOptOut(workspaceId, from).catch(() => {});
      return respondTwiml(res);
    }

    // Normal inbound — route to the matching task (best-effort; never 500 Twilio).
    await resolveInboundSms({
      workspaceId,
      from,
      to: params.To,
      body: params.Body,
      twilioSid: params.MessageSid || params.SmsSid || null,
    }).catch((err) => console.error('[smsInbound] resolve failed:', err?.message || err));

    return respondTwiml(res);
  } catch (err) {
    console.error('inboundSms error:', err);
    // Still ack so Twilio doesn't hammer retries on a transient server error.
    return respondTwiml(res);
  }
};

/** POST /api/sms/status — delivery status callback. */
const statusCallback = async (req, res) => {
  try {
    const params = req.body || {};
    if (!params.AccountSid) return res.status(204).end();
    const config = await SmsConfig.findOne({ accountSid: params.AccountSid });
    if (!config) return res.status(204).end();
    if (!verifyTwilioRequest(req, config)) {
      return res.status(403).send('Invalid Twilio signature');
    }

    const sid = params.MessageSid || params.SmsSid;
    const status = params.MessageStatus || params.SmsStatus;
    if (sid && status) {
      await SmsMessage.updateOne(
        { twilioSid: sid },
        {
          $set: { status: smsService.mapTwilioStatus(status) },
          $push: { statusUpdates: { status, at: new Date() } },
        }
      ).catch(() => {});
    }
    return res.status(204).end();
  } catch (err) {
    console.error('statusCallback error:', err);
    return res.status(204).end();
  }
};

// ===========================================================================
// AUTHED — workspace config (admin; requireOrgAdmin gates the route)
// ===========================================================================

/** GET /api/workspaces/:id/sms-config — redacted config (admin). */
const getSmsConfig = async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const config = await SmsConfig.findOne({ workspaceId });
    return res.json({ config: serializeConfig(config, workspaceId) });
  } catch (err) {
    console.error('getSmsConfig error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** PUT /api/workspaces/:id/sms-config — upsert (admin). Auth token write-only. */
const updateSmsConfig = async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const body = req.body || {};

    // Writing a new token requires the encryption key to be configured.
    const tokenProvided = typeof body.authToken === 'string' && body.authToken.trim();
    if (tokenProvided && !aesEncrypt.isConfigured()) {
      return res.status(503).json({ error: 'Token encryption is not configured on the server' });
    }

    if (body.defaultFrom != null && String(body.defaultFrom).trim()) {
      const e164 = smsService.toE164(body.defaultFrom);
      if (!smsService.isValidE164(e164)) {
        return res.status(400).json({ error: 'defaultFrom must be a valid phone number (E.164)' });
      }
    }

    let config = await SmsConfig.findOne({ workspaceId });
    if (!config) config = new SmsConfig({ workspaceId });

    if (body.accountSid !== undefined) config.accountSid = String(body.accountSid || '').trim();
    if (body.defaultFrom !== undefined) {
      const raw = String(body.defaultFrom || '').trim();
      config.defaultFrom = raw ? smsService.toE164(raw) : '';
    }
    if (body.messagingServiceSid !== undefined) {
      config.messagingServiceSid = String(body.messagingServiceSid || '').trim();
    }
    if (body.appendOptOutFooter !== undefined) {
      config.appendOptOutFooter = body.appendOptOutFooter === true || body.appendOptOutFooter === 'true';
    }
    // Token: write-only. A non-empty string sets it; explicit null clears it; an
    // omitted / empty value leaves the existing ciphertext untouched.
    if (tokenProvided) config.setAuthToken(body.authToken.trim());
    else if (body.authToken === null) config.setAuthToken(null);

    config.updatedAt = new Date();
    await config.save();
    return res.json({ config: serializeConfig(config, workspaceId) });
  } catch (err) {
    console.error('updateSmsConfig error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** GET /api/workspaces/:id/sms-opt-outs — opted-out numbers (admin). */
const listOptOuts = async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const optOuts = await SmsOptOut.find({ workspaceId })
      .sort({ optedOutAt: -1 })
      .limit(500)
      .lean();
    return res.json({
      optOuts: optOuts.map((o) => ({ _id: asId(o._id), phone: o.phone, optedOutAt: o.optedOutAt })),
    });
  } catch (err) {
    console.error('listOptOuts error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ===========================================================================
// AUTHED — task SMS tab
// ===========================================================================

/** GET /api/tasks/:id/sms — the task's SMS thread, newest first. */
const listTaskSms = async (req, res) => {
  try {
    const ctx = await loadTaskAccess(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const messages = await SmsMessage.find({ taskId: req.params.id }).sort({ sentAt: -1 });
    return res.json({ messages: messages.map(serializeMessage) });
  } catch (err) {
    console.error('listTaskSms error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/tasks/:id/sms — send a manual SMS (chat reply) on the task. */
const sendTaskSms = async (req, res) => {
  try {
    const ctx = await loadTaskAccess(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    if (!ctx.workspaceId) {
      return res.status(400).json({ error: 'SMS is only available on workspace tasks' });
    }

    const { to, body } = req.body || {};
    const dest = (to && String(to).trim()) || taskPhone(ctx.task, ctx.board);
    if (!dest) return res.status(400).json({ error: 'No phone number found for this task' });
    if (!String(body || '').trim()) return res.status(400).json({ error: 'Message body is required' });

    const result = await smsService.send({
      workspaceId: ctx.workspaceId,
      to: dest,
      body,
      taskId: ctx.task._id,
    });

    if (!result.ok) {
      const MAP = {
        no_sms_config: [400, 'SMS is not configured for this workspace'],
        invalid_number: [400, 'Invalid phone number'],
        opted_out: [400, 'This number has opted out of SMS'],
        send_error: [502, result.error || 'Failed to send SMS'],
      };
      const [code, error] = MAP[result.reason] || [502, 'Failed to send SMS'];
      return res.status(code).json({
        error,
        message: result.message ? serializeMessage(result.message) : undefined,
      });
    }
    return res.status(201).json({ message: serializeMessage(result.message) });
  } catch (err) {
    console.error('sendTaskSms error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  // public
  inboundSms,
  statusCallback,
  // admin config
  getSmsConfig,
  updateSmsConfig,
  listOptOuts,
  // task tab
  listTaskSms,
  sendTaskSms,
};
