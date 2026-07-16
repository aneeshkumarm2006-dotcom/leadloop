/**
 * emailController.js — email tracking, inbound capture, and the task Emails tab.
 *
 * PUBLIC (no auth, allowlisted in app.js):
 *   - GET  /api/email/track/:messageId/open.gif   open pixel  → append openedAt
 *   - GET  /api/email/track/:messageId/click       click       → append + 302
 *   - POST /api/email/inbound/gmail                Pub/Sub push → sync account
 *   - POST /api/email/inbound/microsoft            Graph webhook (+ validation)
 *
 * AUTHED (task-scoped, membership-gated):
 *   - GET  /api/tasks/:id/emails                   thread list
 *   - POST /api/tasks/:id/emails                   compose + send
 *   - POST /api/emails/attachments                 upload a Cloudinary attachment
 */

const mongoose = require('mongoose');
const Task = require('../models/Task');
const Board = require('../models/Board');
const Organisation = require('../models/Organisation');
const EmailMessage = require('../models/EmailMessage');
const EmailAccount = require('../models/EmailAccount');
const { sendEmailForTask, resolveSenderAccount } = require('../services/taskEmail');

// 1×1 transparent GIF (43 bytes) for the open-tracking pixel.
const TRACKING_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

const CLIENT_URL = () => process.env.CLIENT_URL || 'http://localhost:5173';
const isHttpUrl = (v) => /^https?:\/\//i.test(v || '');

/**
 * Load a task and assert the caller may read/write it: personal → creator only;
 * board task → org membership. Returns { task, board?, org?, workspaceId } or
 * { status, error }.
 */
const loadTaskAccess = async (taskId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(taskId)) return { status: 400, error: 'Invalid task id' };
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
  return { task, board, org, workspaceId: org._id };
};

const serializeMessage = (m) => ({
  _id: m._id,
  taskId: m.taskId,
  threadId: m.threadId,
  direction: m.direction,
  from: m.from,
  to: m.to,
  cc: m.cc,
  subject: m.subject,
  body: m.body,
  bodyHtml: m.bodyHtml,
  attachments: m.attachments,
  messageId: m.messageId,
  inReplyTo: m.inReplyTo,
  sentAt: m.sentAt,
  openedAt: m.openedAt,
  clicks: m.clicks,
  status: m.status,
  provider: m.provider,
  sentBy: m.sentBy,
});

// ===========================================================================
// PUBLIC — tracking
// ===========================================================================
/** GET /api/email/track/:messageId/open.gif — record an open, return the pixel. */
const trackOpen = async (req, res) => {
  const { messageId } = req.params;
  if (mongoose.Types.ObjectId.isValid(messageId)) {
    // Best-effort: an open is non-critical, never block the pixel on the write.
    EmailMessage.updateOne({ _id: messageId }, { $push: { openedAt: new Date() } }).catch(() => {});
  }
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  return res.status(200).send(TRACKING_GIF);
};

/** GET /api/email/track/:messageId/click?u=<encoded> — record + 302 redirect. */
const trackClick = async (req, res) => {
  const { messageId } = req.params;
  const target = req.query.u ? decodeURIComponent(req.query.u) : '';
  if (mongoose.Types.ObjectId.isValid(messageId) && isHttpUrl(target)) {
    EmailMessage.updateOne(
      { _id: messageId },
      { $push: { clicks: { url: target, at: new Date() } } }
    ).catch(() => {});
  }
  return res.redirect(302, isHttpUrl(target) ? target : CLIENT_URL());
};

// ===========================================================================
// PUBLIC — inbound provider push (best-effort; always 2xx to avoid retries)
// ===========================================================================
/** Kick off a best-effort sync of the account whose address matches. */
const syncByAddress = async (provider, address) => {
  if (!address) return;
  const account = await EmailAccount.findOne({ provider, defaultFrom: address, status: 'active' });
  if (!account) return;
  const { syncAccount } = require('../services/emailSyncRunner');
  await syncAccount(account).catch((err) =>
    console.error('[emailInbound] sync failed:', err?.message || err)
  );
};

/** POST /api/email/inbound/gmail — Gmail Pub/Sub push envelope. */
const inboundGmail = async (req, res) => {
  try {
    const data = req.body && req.body.message && req.body.message.data;
    if (data) {
      const decoded = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
      await syncByAddress('gmail', decoded.emailAddress);
    }
  } catch (err) {
    console.error('inboundGmail error:', err?.message || err);
  }
  return res.status(204).end(); // ack the Pub/Sub message regardless
};

/** POST /api/email/inbound/microsoft — Graph change notification (+ handshake). */
const inboundMicrosoft = async (req, res) => {
  // Subscription-validation handshake: echo the token as text/plain.
  if (req.query.validationToken) {
    res.set('Content-Type', 'text/plain');
    return res.status(200).send(req.query.validationToken);
  }
  try {
    const notifications = (req.body && req.body.value) || [];
    const addresses = new Set();
    for (const n of notifications) {
      const addr = n.resourceData && (n.resourceData.address || n.resourceData['emailAddress']);
      if (addr) addresses.add(addr);
    }
    // Fall back to syncing every active microsoft account if no address is given.
    if (addresses.size === 0) {
      const accounts = await EmailAccount.find({ provider: 'microsoft', status: 'active' }).select('defaultFrom');
      accounts.forEach((a) => a.defaultFrom && addresses.add(a.defaultFrom));
    }
    for (const addr of addresses) await syncByAddress('microsoft', addr);
  } catch (err) {
    console.error('inboundMicrosoft error:', err?.message || err);
  }
  return res.status(202).end();
};

// ===========================================================================
// AUTHED — task Emails tab
// ===========================================================================
/** GET /api/tasks/:id/emails — the task's email thread, newest first. */
const listTaskEmails = async (req, res) => {
  try {
    const ctx = await loadTaskAccess(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const emails = await EmailMessage.find({ taskId: req.params.id }).sort({ sentAt: -1 });
    return res.json({ emails: emails.map(serializeMessage) });
  } catch (err) {
    console.error('listTaskEmails error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/tasks/:id/emails — compose + send from the caller's mailbox. */
const sendTaskEmail = async (req, res) => {
  try {
    const ctx = await loadTaskAccess(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const { to, cc, bcc, subject, body, attachments, inReplyTo, threadId } = req.body || {};
    const toList = (Array.isArray(to) ? to : to ? [to] : []).map((a) => String(a).trim()).filter(Boolean);
    if (!toList.length) return res.status(400).json({ error: 'At least one recipient is required' });
    if (!String(body || '').trim()) return res.status(400).json({ error: 'Email body is required' });

    const account = await resolveSenderAccount({
      workspaceId: ctx.workspaceId,
      candidateUserIds: [req.user.userId],
    });

    const message = await sendEmailForTask({
      taskId: ctx.task._id,
      to: toList,
      cc,
      bcc,
      subject: subject || '',
      body,
      attachments: Array.isArray(attachments) ? attachments : [],
      inReplyTo: inReplyTo || null,
      threadId: threadId || null,
      account,
      sentBy: req.user.userId,
    });

    if (message.status === 'failed') {
      return res.status(502).json({
        error: message.sendError || 'Email failed to send',
        email: serializeMessage(message),
      });
    }
    return res.status(201).json({ email: serializeMessage(message), via: message.provider });
  } catch (err) {
    console.error('sendTaskEmail error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/emails/attachments — upload one file to Cloudinary (macan/emails/). */
const uploadEmailAttachment = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    return res.status(201).json({
      attachment: {
        url: req.file.path,
        name: req.file.originalname || 'attachment',
        mime: req.file.mimetype || '',
        size: req.file.size || 0,
      },
    });
  } catch (err) {
    console.error('uploadEmailAttachment error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  trackOpen,
  trackClick,
  inboundGmail,
  inboundMicrosoft,
  listTaskEmails,
  sendTaskEmail,
  uploadEmailAttachment,
};
