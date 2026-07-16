/**
 * microsoftAdapter.js — Microsoft 365 send/read over Graph REST (Phase 3, F8.3).
 *
 * Uses the user's OAuth bearer token against `graph.microsoft.com/v1.0` (no
 * `@microsoft/microsoft-graph-client` SDK). Graph takes a structured JSON
 * message for `sendMail` (not raw MIME), so this adapter builds the message
 * object directly. Same adapter contract as gmailAdapter.
 */

const { getJson, postJson } = require('./rest');
const { htmlToText, sanitizeEmailHtml } = require('../../utils/emailHtml');

const API = 'https://graph.microsoft.com/v1.0/me';

const recipients = (list) =>
  (Array.isArray(list) ? list : list ? [list] : [])
    .map((a) => String(a).trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));

/** Normalise a Graph message resource into the shared shape. */
const normalize = (msg) => {
  const bodyHtml = msg.body && msg.body.contentType === 'html' ? sanitizeEmailHtml(msg.body.content) : '';
  const bodyText =
    msg.body && msg.body.contentType === 'text'
      ? msg.body.content
      : bodyHtml
        ? htmlToText(bodyHtml)
        : msg.bodyPreview || '';
  return {
    providerMessageId: msg.id,
    threadId: msg.conversationId || null,
    rfcMessageId: msg.internetMessageId || null,
    inReplyTo: null,
    from: msg.from && msg.from.emailAddress ? msg.from.emailAddress.address : '',
    to: (msg.toRecipients || []).map((r) => r.emailAddress && r.emailAddress.address).filter(Boolean),
    cc: (msg.ccRecipients || []).map((r) => r.emailAddress && r.emailAddress.address).filter(Boolean),
    subject: msg.subject || '',
    bodyText,
    bodyHtml,
    sentAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
  };
};

const send = async ({ accessToken, mail }) => {
  const message = {
    subject: mail.subject || '',
    body: { contentType: 'HTML', content: mail.bodyHtml || mail.bodyText || '' },
    toRecipients: recipients(mail.to),
    ccRecipients: recipients(mail.cc),
    bccRecipients: recipients(mail.bcc),
  };
  // Graph assigns the Message-ID + conversation; sendMail returns 202 (no body).
  await postJson(`${API}/sendMail`, accessToken, { message, saveToSentItems: true });
  return { providerMessageId: null, threadId: null, rfcMessageId: null };
};

const fetchThread = async ({ accessToken, threadId }) => {
  if (!threadId) return [];
  const res = await getJson(
    `${API}/messages?$filter=conversationId eq '${encodeURIComponent(threadId)}'&$top=50&$orderby=receivedDateTime asc`,
    accessToken
  );
  return (res.value || []).map(normalize);
};

const fetchRecent = async ({ accessToken, max = 25 }) => {
  const res = await getJson(
    `${API}/mailFolders/inbox/messages?$top=${max}&$orderby=receivedDateTime desc`,
    accessToken
  );
  return (res.value || []).map(normalize);
};

module.exports = { provider: 'microsoft', send, fetchThread, fetchRecent, normalize };
