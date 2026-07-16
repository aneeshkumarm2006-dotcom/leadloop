/**
 * emailInboundResolver.js — route a received email to a task (Phase 3, F8.4).
 *
 * A captured inbound message (from provider push or the IMAP/heartbeat sync) is
 * matched to a task in priority order:
 *   1. `inReplyTo` / `messageId` threading → the task of the message it replies to
 *   2. `threadId` → the task of any existing message in that thread
 *   3. sender address → a task whose `email`-type column value matches `from`
 * On a match it writes one `EmailMessage` (`direction: 'in'`, `status:
 * 'received'`), deduped on the provider Message-ID (unique sparse index), and
 * emits `email.received` for downstream listeners. Unmatched mail is dropped
 * (logged) — there's no task to attach it to.
 */

const Board = require('../models/Board');
const Task = require('../models/Task');
const EmailMessage = require('../models/EmailMessage');
const eventBus = require('./eventBus');
const { sanitizeEmailHtml, htmlToText } = require('../utils/emailHtml');

const normaliseAddr = (value) => String(value || '').trim().toLowerCase();

/** Find the task a reply threads onto via Message-ID / thread id. */
const matchByThread = async ({ inReplyTo, messageId, threadId }) => {
  const or = [];
  if (inReplyTo) or.push({ messageId: inReplyTo });
  if (messageId) or.push({ inReplyTo: messageId });
  if (threadId) or.push({ threadId });
  if (!or.length) return null;
  const existing = await EmailMessage.findOne({ $or: or }).sort({ sentAt: -1 }).select('taskId threadId');
  return existing ? { taskId: existing.taskId, threadId: existing.threadId || threadId || null } : null;
};

/** Find a task whose email-type column value matches the sender address. */
const matchBySenderEmail = async (fromAddr) => {
  const addr = normaliseAddr(fromAddr);
  if (!addr) return null;

  const boards = await Board.find({ 'columns.type': 'email' }).select('_id columns').lean();
  for (const board of boards) {
    const emailColIds = (board.columns || []).filter((c) => c.type === 'email').map((c) => c._id.toString());
    for (const colId of emailColIds) {
      // Email values serialise to a plain string; match case-insensitively.
      const task = await Task.findOne({
        board: board._id,
        [`columnValues.${colId}`]: new RegExp(`^${addr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      })
        .sort({ updatedAt: -1 })
        .select('_id');
      if (task) return { taskId: task._id, threadId: null };
    }
  }
  return null;
};

/**
 * Resolve + persist one inbound message. Returns the created EmailMessage, or
 * null when it can't be matched to a task (or is a duplicate).
 *
 * @param {object} msg - normalised provider message
 *   { from, to[], cc[], subject, bodyText, bodyHtml, messageId, inReplyTo, threadId, sentAt, provider }
 */
const resolveInboundEmail = async (msg) => {
  if (!msg) return null;

  // Dedup early on the provider Message-ID.
  if (msg.messageId) {
    const dup = await EmailMessage.findOne({ messageId: msg.messageId }).select('_id');
    if (dup) return null;
  }

  const match =
    (await matchByThread(msg)) || (await matchBySenderEmail(msg.from));
  if (!match) {
    console.warn('[emailInbound] no task matched for sender', normaliseAddr(msg.from));
    return null;
  }

  const bodyHtml = msg.bodyHtml ? sanitizeEmailHtml(msg.bodyHtml) : '';
  const bodyText = msg.bodyText || (bodyHtml ? htmlToText(bodyHtml) : '');

  let created;
  try {
    created = await EmailMessage.create({
      taskId: match.taskId,
      threadId: match.threadId || msg.threadId || null,
      direction: 'in',
      from: msg.from || '',
      to: Array.isArray(msg.to) ? msg.to : msg.to ? [msg.to] : [],
      cc: Array.isArray(msg.cc) ? msg.cc : [],
      subject: msg.subject || '',
      body: bodyText,
      bodyHtml,
      messageId: msg.messageId || null,
      inReplyTo: msg.inReplyTo || null,
      sentAt: msg.sentAt ? new Date(msg.sentAt) : new Date(),
      status: 'received',
      provider: msg.provider || 'unknown',
    });
  } catch (err) {
    // Duplicate-key race on the unique messageId index → already captured.
    if (err && err.code === 11000) return null;
    throw err;
  }

  eventBus.emit('email.received', {
    taskId: match.taskId,
    messageId: created._id,
    from: created.from,
  });
  return created;
};

module.exports = { resolveInboundEmail, matchBySenderEmail, matchByThread };
