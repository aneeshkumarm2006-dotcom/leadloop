/**
 * taskEmail.js — the shared "send an email on a task" primitive (Phase 3, F8.5).
 *
 * One programmatic path used by BOTH the Emails-tab controller (a user composing
 * from the drawer) and the SEND_EMAIL automation action (and F9's welcome
 * touch). It persists an `EmailMessage` row up front (so open/click tracking can
 * reference its id), dispatches through the sender's connected mailbox via
 * `emailService.sendUserEmail`, and falls back to the legacy Resend path with a
 * `[Sent via CRM]` footer when there's no connected mailbox (AC5). The row's
 * `status` reflects the outcome (queued → sent / failed) either way.
 */

const EmailAccount = require('../models/EmailAccount');
const EmailMessage = require('../models/EmailMessage');
const { sendUserEmail, sendUserEmailViaResend } = require('./emailService');
const { sanitizeEmailHtml, htmlToText, textToHtml } = require('../utils/emailHtml');

const asId = (v) => (v == null ? '' : v.toString());

/**
 * Resolve the EmailAccount a message should send from, in priority order:
 * the composing user → the task's assignees → the automation creator. Returns
 * the first connected `active` account found, or null (→ Resend fallback).
 */
const resolveSenderAccount = async ({ workspaceId, candidateUserIds = [] }) => {
  const seen = new Set();
  const ordered = candidateUserIds.map(asId).filter((id) => id && !seen.has(id) && seen.add(id));
  for (const userId of ordered) {
    const query = { userId, status: 'active' };
    if (workspaceId) query.workspaceId = workspaceId;
    const account = await EmailAccount.findOne(query);
    if (account) return account;
  }
  return null;
};

/** Build `{ html, text }` from a composed body (HTML or plain text). */
const normaliseComposed = ({ body, bodyHtml, bodyText }) => {
  let html = bodyHtml || '';
  let text = bodyText || '';
  if (!html && body) html = /<[a-z][\s\S]*>/i.test(body) ? body : textToHtml(body);
  if (!text) text = html ? htmlToText(html) : body || '';
  return { html: sanitizeEmailHtml(html), text };
};

/**
 * Send an email on a task. Always persists an EmailMessage; returns it with the
 * resolved `status`. Never throws on a delivery failure — the row is marked
 * `failed` and returned so callers can surface it (the action records `failed`,
 * the controller returns 502 with the row).
 *
 * @param {object} opts
 * @param {string|ObjectId} opts.taskId
 * @param {string|string[]} opts.to
 * @param {string|string[]} [opts.cc]
 * @param {string|string[]} [opts.bcc]
 * @param {string} opts.subject
 * @param {string} [opts.body] / [opts.bodyHtml] / [opts.bodyText]
 * @param {Array}  [opts.attachments]
 * @param {string} [opts.inReplyTo] / [opts.threadId]
 * @param {object|null} [opts.account]   — pre-resolved sender (else Resend fallback)
 * @param {string|ObjectId} [opts.sentBy]
 * @returns {Promise<EmailMessage>}
 */
const sendEmailForTask = async ({
  taskId,
  to,
  cc,
  bcc,
  subject,
  body,
  bodyHtml,
  bodyText,
  attachments = [],
  inReplyTo = null,
  threadId = null,
  account = null,
  sentBy = null,
}) => {
  const toList = (Array.isArray(to) ? to : to ? [to] : []).map((a) => String(a).trim()).filter(Boolean);
  if (!toList.length) throw new Error('sendEmailForTask requires at least one recipient');

  const { html, text } = normaliseComposed({ body, bodyHtml, bodyText });

  const message = await EmailMessage.create({
    taskId,
    threadId,
    direction: 'out',
    to: toList,
    cc: Array.isArray(cc) ? cc : cc ? [cc] : [],
    bcc: Array.isArray(bcc) ? bcc : bcc ? [bcc] : [],
    subject: subject || '',
    body: text,
    bodyHtml: html,
    attachments: (Array.isArray(attachments) ? attachments : []).filter((a) => a && a.url),
    inReplyTo,
    sentAt: new Date(),
    status: 'queued',
    sentBy: sentBy || null,
    provider: account ? account.provider : 'resend',
  });

  try {
    if (account) {
      const result = await sendUserEmail({
        account,
        to: toList,
        cc,
        bcc,
        subject,
        bodyHtml: html,
        bodyText: text,
        attachments,
        inReplyTo,
        threadId,
        trackingMessageId: asId(message._id),
      });
      message.provider = account.provider;
      if (result.rfcMessageId) message.messageId = result.rfcMessageId;
      if (result.threadId) message.threadId = result.threadId;
      message.from = account.defaultFrom || message.from;
    } else {
      // AC5 — no connected mailbox: relay through Resend with the footer.
      const result = await sendUserEmailViaResend({
        to: toList,
        cc,
        bcc,
        subject,
        bodyHtml: html,
        bodyText: text,
        attachments,
      });
      message.provider = 'resend';
      if (result.messageId) message.messageId = result.messageId;
    }
    message.status = 'sent';
    await message.save();
  } catch (err) {
    message.status = 'failed';
    await message.save().catch(() => {});
    message.sendError = err.message; // transient, not persisted — for the caller
  }

  return message;
};

module.exports = { sendEmailForTask, resolveSenderAccount, normaliseComposed };
