const nodemailer = require('nodemailer');
const { getAdapter } = require('./emailProviders');
const { ensureAccessToken } = require('./emailOAuth');
const { injectTracking, htmlToText, textToHtml, sanitizeEmailHtml } = require('../utils/emailHtml');

const transporter = nodemailer.createTransport({
  host: 'smtp.resend.com',
  port: 465,
  secure: true,
  auth: {
    user: 'resend',
    pass: process.env.RESEND_API_KEY,
  },
});

const PRIORITY_LABELS = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const PRIORITY_BG = {
  critical: '#DC2626',
  high: '#EA580C',
  medium: '#D97706',
  low: '#6B7280',
};

const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

const buildHtml = ({ taskName, priority, dueDate, taskLink }) => {
  const priorLabel = escapeHtml(PRIORITY_LABELS[priority] || priority);
  const priorBg = PRIORITY_BG[priority] || '#6B7280';
  const dueDateStr = dueDate
    ? new Date(dueDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'No due date set';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New task assigned</title>
  <style>
    body { margin: 0; padding: 0; background: #F3F4F8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; }
    .wrapper { max-width: 560px; margin: 40px auto; background: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: #2563EB; padding: 28px 32px; }
    .header-logo { font-size: 22px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.02em; }
    .body { padding: 32px; }
    .title { font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 6px; }
    .subtitle { font-size: 14px; color: #6B7280; margin: 0 0 24px; line-height: 1.5; }
    .task-card { background: #F9FAFB; border: 1.5px solid #E5E7EB; border-radius: 10px; padding: 20px 24px; margin-bottom: 28px; }
    .task-name { font-size: 16px; font-weight: 600; color: #111827; margin: 0 0 18px; }
    .meta-row { display: flex; align-items: flex-start; gap: 28px; flex-wrap: wrap; }
    .meta-item { display: flex; flex-direction: column; gap: 4px; }
    .meta-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #9CA3AF; }
    .priority-badge { display: inline-block; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 9999px; color: #FFFFFF; background: ${priorBg}; }
    .meta-value { font-size: 13px; font-weight: 500; color: #374151; }
    .cta { text-align: center; }
    .cta a { display: inline-block; background: #2563EB; color: #FFFFFF !important; font-size: 14px; font-weight: 600; padding: 13px 32px; border-radius: 8px; text-decoration: none; }
    .footer { background: #F9FAFB; border-top: 1px solid #E5E7EB; padding: 18px 32px; }
    .footer p { font-size: 12px; color: #9CA3AF; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-logo">Macan</div>
    </div>
    <div class="body">
      <p class="title">You've been assigned a task</p>
      <p class="subtitle">A new task has been assigned to you. Review the details below and click the button to open it.</p>
      <div class="task-card">
        <p class="task-name">${escapeHtml(taskName)}</p>
        <div class="meta-row">
          <div class="meta-item">
            <span class="meta-label">Priority</span>
            <span class="priority-badge">${priorLabel}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Due Date</span>
            <span class="meta-value">${escapeHtml(dueDateStr)}</span>
          </div>
        </div>
      </div>
      <div class="cta">
        <a href="${taskLink}">View Task &rarr;</a>
      </div>
    </div>
    <div class="footer">
      <p>You received this email because a task was assigned to you in Macan. If you believe this is an error, contact your administrator.</p>
    </div>
  </div>
</body>
</html>`;
};

/**
 * Send a task-assignment email to a single recipient.
 *
 * @param {object} opts
 * @param {string} opts.to         — recipient email address
 * @param {string} opts.taskName   — task title
 * @param {string} opts.priority   — "critical" | "high" | "medium" | "low"
 * @param {Date|string|null} opts.dueDate  — optional due date
 * @param {string} opts.taskLink   — direct URL to the board/task
 */
const sendTaskAssignmentEmail = async ({ to, taskName, priority, dueDate, taskLink }) => {
  const html = buildHtml({ taskName, priority, dueDate, taskLink });
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@davnoot.com',
    to,
    subject: `You've been assigned: ${taskName}`,
    html,
  });
};

const buildInviteHtml = ({ orgName, inviteLink, inviteCode }) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're invited to join ${escapeHtml(orgName)}</title>
  <style>
    body { margin: 0; padding: 0; background: #F3F4F8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; }
    .wrapper { max-width: 560px; margin: 40px auto; background: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: #2563EB; padding: 28px 32px; }
    .header-logo { font-size: 22px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.02em; }
    .body { padding: 32px; }
    .title { font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 6px; }
    .subtitle { font-size: 14px; color: #6B7280; margin: 0 0 24px; line-height: 1.5; }
    .code-box { background: #F3F4F8; border: 1.5px solid #E5E7EB; border-radius: 10px; padding: 16px 24px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; }
    .code-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #9CA3AF; margin-bottom: 4px; }
    .code-value { font-size: 20px; font-weight: 700; color: #111827; letter-spacing: 0.08em; font-family: 'Courier New', monospace; }
    .divider { border: none; border-top: 1px solid #E5E7EB; margin: 24px 0; }
    .cta { text-align: center; }
    .cta a { display: inline-block; background: #2563EB; color: #FFFFFF !important; font-size: 14px; font-weight: 600; padding: 13px 32px; border-radius: 8px; text-decoration: none; }
    .footer { background: #F9FAFB; border-top: 1px solid #E5E7EB; padding: 18px 32px; }
    .footer p { font-size: 12px; color: #9CA3AF; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-logo">Macan</div>
    </div>
    <div class="body">
      <p class="title">You've been invited to join ${escapeHtml(orgName)}</p>
      <p class="subtitle">An admin has invited you to collaborate on <strong>${escapeHtml(orgName)}</strong> in Macan. Use the invite code below or click the button to join.</p>
      <div class="code-box">
        <div>
          <div class="code-label">Invite Code</div>
          <div class="code-value">${escapeHtml(inviteCode)}</div>
        </div>
      </div>
      <hr class="divider" />
      <div class="cta">
        <a href="${inviteLink}">Join ${escapeHtml(orgName)} &rarr;</a>
      </div>
    </div>
    <div class="footer">
      <p>You received this invite from an admin of ${escapeHtml(orgName)}. If you don't recognise this, you can safely ignore this email.</p>
    </div>
  </div>
</body>
</html>`;
};

/**
 * Send an organisation invite email.
 *
 * @param {object} opts
 * @param {string} opts.to         — recipient email address
 * @param {string} opts.orgName    — organisation name
 * @param {string} opts.inviteLink — full URL to join the org
 * @param {string} opts.inviteCode — raw invite code (for manual entry)
 */
const sendInviteEmail = async ({ to, orgName, inviteLink, inviteCode }) => {
  const html = buildInviteHtml({ orgName, inviteLink, inviteCode });
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@davnoot.com',
    to,
    subject: `You've been invited to join ${orgName} on Macan`,
    html,
  });
};

const buildMentionHtml = ({ mentionedByName, taskName, commentText, taskLink }) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You were mentioned in a comment</title>
  <style>
    body { margin: 0; padding: 0; background: #F3F4F8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; }
    .wrapper { max-width: 560px; margin: 40px auto; background: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: #2563EB; padding: 28px 32px; }
    .header-logo { font-size: 22px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.02em; }
    .body { padding: 32px; }
    .title { font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 6px; }
    .subtitle { font-size: 14px; color: #6B7280; margin: 0 0 24px; line-height: 1.5; }
    .comment-card { background: #F9FAFB; border: 1.5px solid #E5E7EB; border-radius: 10px; padding: 20px 24px; margin-bottom: 28px; }
    .comment-author { font-size: 13px; font-weight: 600; color: #374151; margin: 0 0 8px; }
    .comment-text { font-size: 14px; color: #111827; line-height: 1.55; margin: 0; white-space: pre-wrap; word-break: break-word; }
    .task-name { font-size: 12px; font-weight: 600; color: #6B7280; margin: 16px 0 0; }
    .cta { text-align: center; }
    .cta a { display: inline-block; background: #2563EB; color: #FFFFFF !important; font-size: 14px; font-weight: 600; padding: 13px 32px; border-radius: 8px; text-decoration: none; }
    .footer { background: #F9FAFB; border-top: 1px solid #E5E7EB; padding: 18px 32px; }
    .footer p { font-size: 12px; color: #9CA3AF; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-logo">Macan</div>
    </div>
    <div class="body">
      <p class="title">You were mentioned in a comment</p>
      <p class="subtitle"><strong>${escapeHtml(mentionedByName)}</strong> mentioned you in a comment on a task.</p>
      <div class="comment-card">
        <p class="comment-author">${escapeHtml(mentionedByName)} wrote:</p>
        <p class="comment-text">${escapeHtml(commentText)}</p>
        <p class="task-name">Task: ${escapeHtml(taskName)}</p>
      </div>
      <div class="cta">
        <a href="${taskLink}">View Task &rarr;</a>
      </div>
    </div>
    <div class="footer">
      <p>You received this email because you were mentioned in a comment in Macan. If you believe this is an error, contact your administrator.</p>
    </div>
  </div>
</body>
</html>`;
};

/**
 * Send a mention-notification email to a single recipient.
 *
 * @param {object} opts
 * @param {string} opts.to              — recipient email address
 * @param {string} opts.mentionedByName — name of the person who mentioned them
 * @param {string} opts.taskName        — task title
 * @param {string} opts.commentText     — the comment body
 * @param {string} opts.taskLink        — direct URL to the board/task
 */
const sendMentionEmail = async ({ to, mentionedByName, taskName, commentText, taskLink }) => {
  const html = buildMentionHtml({ mentionedByName, taskName, commentText, taskLink });
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@davnoot.com',
    to,
    subject: `${mentionedByName} mentioned you in "${taskName}"`,
    html,
  });
};

/**
 * Send a lightweight automation-digest email (the optional email channel for the
 * F5 NOTIFY_PERSON action). Deliberately simple — the full templated email
 * pipeline lands in F8; this just relays the in-app notification text so the
 * "also send email" toggle does something useful today. Callers invoke it
 * best-effort and swallow failures (RESEND may be unconfigured in dev).
 *
 * @param {object} opts
 * @param {string} opts.to       — recipient email address
 * @param {string} opts.subject  — email subject
 * @param {string} opts.message  — already-interpolated notification text
 * @param {string} [opts.taskLink] — optional URL to the related board/task
 */
const sendAutomationDigestEmail = async ({ to, subject, message, taskLink }) => {
  const cta = taskLink
    ? `<div class="cta"><a href="${taskLink}">Open in Macan &rarr;</a></div>`
    : '';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
  <style>
    body { margin: 0; padding: 0; background: #F3F4F8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; }
    .wrapper { max-width: 560px; margin: 40px auto; background: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: #2563EB; padding: 28px 32px; }
    .header-logo { font-size: 22px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.02em; }
    .body { padding: 32px; }
    .title { font-size: 18px; font-weight: 700; color: #111827; margin: 0 0 14px; }
    .message { font-size: 14px; color: #374151; line-height: 1.6; margin: 0 0 24px; white-space: pre-wrap; word-break: break-word; }
    .cta { text-align: center; }
    .cta a { display: inline-block; background: #2563EB; color: #FFFFFF !important; font-size: 14px; font-weight: 600; padding: 13px 32px; border-radius: 8px; text-decoration: none; }
    .footer { background: #F9FAFB; border-top: 1px solid #E5E7EB; padding: 18px 32px; }
    .footer p { font-size: 12px; color: #9CA3AF; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-logo">Macan</div>
    </div>
    <div class="body">
      <p class="title">${escapeHtml(subject)}</p>
      <p class="message">${escapeHtml(message)}</p>
      ${cta}
    </div>
    <div class="footer">
      <p>You received this email from an automation in Macan.</p>
    </div>
  </div>
</body>
</html>`;
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@davnoot.com',
    to,
    subject,
    html,
  });
};

// ===========================================================================
// F8.3 — User-mailbox send dispatcher + Resend fallback.
//
// `sendUserEmail` routes a composed message through the connected provider
// adapter (Gmail / Microsoft / SMTP) so it arrives from the user's REAL address
// (AC2). `sendUserEmailViaResend` is the no-mailbox fallback (AC5): it relays
// through the system Resend transport with a `[Sent via CRM]` footer.
// ===========================================================================

const PUBLIC_BASE_URL = () => process.env.WEBHOOK_PUBLIC_BASE_URL || '';

/**
 * Normalise a composed body into `{ html, text }`. `body` is treated as HTML
 * when it contains markup, otherwise as plain text; explicit `bodyHtml` /
 * `bodyText` always win.
 */
const normaliseBody = ({ body, bodyHtml, bodyText }) => {
  let html = bodyHtml || '';
  let text = bodyText || '';
  if (!html && body) html = /<[a-z][\s\S]*>/i.test(body) ? body : textToHtml(body);
  if (!text) text = html ? htmlToText(html) : body || '';
  return { html: sanitizeEmailHtml(html), text };
};

/**
 * Send an email through a user's connected mailbox.
 *
 * @param {object} opts
 * @param {object} opts.account            — an EmailAccount doc (provider + tokens)
 * @param {string|string[]} opts.to
 * @param {string|string[]} [opts.cc]
 * @param {string|string[]} [opts.bcc]
 * @param {string} opts.subject
 * @param {string} [opts.body]             — HTML or plain text
 * @param {string} [opts.bodyHtml]
 * @param {string} [opts.bodyText]
 * @param {Array}  [opts.attachments]      — [{ url, name, mime }]
 * @param {string} [opts.inReplyTo]        — parent Message-ID for threading
 * @param {string} [opts.threadId]         — provider thread id (reply in-thread)
 * @param {string} [opts.trackingMessageId]— EmailMessage id to wire open/click tracking
 * @returns {Promise<{ provider, providerMessageId, threadId, rfcMessageId }>}
 */
const sendUserEmail = async ({
  account,
  to,
  cc,
  bcc,
  subject,
  body,
  bodyHtml,
  bodyText,
  attachments,
  inReplyTo,
  threadId,
  trackingMessageId,
}) => {
  if (!account) throw new Error('sendUserEmail requires a connected account');
  const adapter = getAdapter(account.provider);
  if (!adapter) throw new Error(`No adapter for provider "${account.provider}"`);

  const { html, text } = normaliseBody({ body, bodyHtml, bodyText });
  const signedHtml = account.signature ? `${html}<br/><br/>${account.signature}` : html;
  const trackedHtml = injectTracking(signedHtml, trackingMessageId, PUBLIC_BASE_URL());

  const mail = {
    from: account.defaultFrom || undefined,
    to,
    cc,
    bcc,
    subject,
    bodyHtml: trackedHtml,
    bodyText: text,
    attachments,
    inReplyTo,
  };

  if (account.provider === 'smtp') {
    // SMTP/IMAP fallback: connection config is assembled by the caller and
    // attached to the account; provider OAuth doesn't apply.
    return adapter.send({ smtp: account.smtpConfig, mail });
  }

  const accessToken = await ensureAccessToken(account);
  return adapter.send({ accessToken, mail, threadId });
};

/**
 * No-mailbox fallback (AC5): relay through the system Resend transport with a
 * `[Sent via CRM]` footer. Used by SEND_EMAIL when the owning user has no
 * connected mailbox. Returns `{ provider: 'resend', messageId }`.
 */
const sendUserEmailViaResend = async ({ to, cc, bcc, subject, body, bodyHtml, bodyText, attachments }) => {
  const { html, text } = normaliseBody({ body, bodyHtml, bodyText });
  const footer =
    '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #E5E7EB;font-size:12px;color:#9CA3AF">[Sent via CRM]</div>';
  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@davnoot.com',
    to,
    cc,
    bcc,
    subject,
    html: `${html}${footer}`,
    text: text ? `${text}\n\n[Sent via CRM]` : undefined,
    attachments: (Array.isArray(attachments) ? attachments : [])
      .filter((a) => a && a.url)
      .map((a) => ({ filename: a.name || undefined, path: a.url })),
  });
  return { provider: 'resend', messageId: info.messageId || null };
};

module.exports = {
  sendTaskAssignmentEmail,
  sendInviteEmail,
  sendMentionEmail,
  sendAutomationDigestEmail,
  // F8.3 — user-mailbox dispatcher + fallback.
  sendUserEmail,
  sendUserEmailViaResend,
};
