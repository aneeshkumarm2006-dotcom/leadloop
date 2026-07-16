/**
 * gmailAdapter.js — Gmail send/read over the REST API (Phase 3, F8.3).
 *
 * Uses the user's OAuth bearer token against `gmail.googleapis.com` (no
 * `googleapis` SDK). `send` compiles a raw RFC-5322 message (MailComposer) and
 * posts it base64url-encoded; `fetchThread` / `fetchRecent` list + parse
 * messages for thread rendering and inbound capture.
 *
 * Adapter contract (shared by microsoft/imap):
 *   send({ accessToken, mail, threadId? }) → { providerMessageId, threadId, rfcMessageId }
 *   fetchThread({ accessToken, threadId }) → [normalizedMessage]
 *   fetchRecent({ accessToken, query?, max? }) → [normalizedMessage]
 */

const { getJson, postJson } = require('./rest');
const { buildRawMime } = require('./mime');
const { htmlToText } = require('../../utils/emailHtml');

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const base64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const decodeB64Url = (data) => {
  if (!data) return '';
  const norm = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(norm, 'base64').toString('utf8');
};

/** Pull a header value (case-insensitive) from a Gmail payload.headers array. */
const header = (headers, name) => {
  const h = (headers || []).find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
};

/** Split a "A <a@x>, B <b@y>" address header into bare addresses. */
const splitAddrs = (value) =>
  (value || '')
    .split(',')
    .map((p) => {
      const m = p.match(/<([^>]+)>/);
      return (m ? m[1] : p).trim();
    })
    .filter(Boolean);

/** Recursively collect the text/plain + text/html bodies from a payload tree. */
const extractBodies = (payload, acc = { text: '', html: '' }) => {
  if (!payload) return acc;
  const mime = payload.mimeType || '';
  if (payload.body && payload.body.data) {
    if (mime === 'text/plain' && !acc.text) acc.text = decodeB64Url(payload.body.data);
    if (mime === 'text/html' && !acc.html) acc.html = decodeB64Url(payload.body.data);
  }
  for (const part of payload.parts || []) extractBodies(part, acc);
  return acc;
};

/** Normalise a Gmail message resource into the shared shape. */
const normalize = (msg) => {
  const payload = msg.payload || {};
  const headers = payload.headers || [];
  const { text, html } = extractBodies(payload);
  const bodyHtml = html || '';
  const bodyText = text || (bodyHtml ? htmlToText(bodyHtml) : msg.snippet || '');
  return {
    providerMessageId: msg.id,
    threadId: msg.threadId || null,
    rfcMessageId: header(headers, 'Message-ID') || null,
    inReplyTo: header(headers, 'In-Reply-To') || null,
    from: splitAddrs(header(headers, 'From'))[0] || header(headers, 'From'),
    to: splitAddrs(header(headers, 'To')),
    cc: splitAddrs(header(headers, 'Cc')),
    subject: header(headers, 'Subject') || '',
    bodyText,
    bodyHtml,
    sentAt: header(headers, 'Date') ? new Date(header(headers, 'Date')) : new Date(Number(msg.internalDate) || Date.now()),
  };
};

const send = async ({ accessToken, mail, threadId }) => {
  const { raw, messageId } = await buildRawMime(mail);
  const body = { raw: base64url(raw) };
  if (threadId) body.threadId = threadId;
  const res = await postJson(`${API}/messages/send`, accessToken, body);
  return { providerMessageId: res.id, threadId: res.threadId || threadId || null, rfcMessageId: messageId };
};

const getMessage = async (accessToken, id) =>
  getJson(`${API}/messages/${id}?format=full`, accessToken);

const fetchThread = async ({ accessToken, threadId }) => {
  if (!threadId) return [];
  const thread = await getJson(`${API}/threads/${threadId}?format=full`, accessToken);
  return (thread.messages || []).map(normalize);
};

const fetchRecent = async ({ accessToken, query = 'in:inbox newer_than:7d', max = 25 }) => {
  const list = await getJson(
    `${API}/messages?maxResults=${max}&q=${encodeURIComponent(query)}`,
    accessToken
  );
  const ids = (list.messages || []).map((m) => m.id);
  const out = [];
  for (const id of ids) {
    try {
      out.push(normalize(await getMessage(accessToken, id)));
    } catch {
      /* skip a single unreadable message */
    }
  }
  return out;
};

module.exports = { provider: 'gmail', send, fetchThread, fetchRecent, normalize };
