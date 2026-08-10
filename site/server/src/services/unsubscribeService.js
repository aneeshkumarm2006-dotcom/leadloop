/**
 * unsubscribeService.js — one-click unsubscribe links for commercial email.
 *
 * Both CASL and CAN-SPAM require every commercial message to carry a working
 * unsubscribe mechanism that keeps working for at least 60 days (CAN-SPAM) /
 * 60 days (CASL) after sending, and that takes effect promptly. Enforcing
 * consent on send (consentGate) is only half the obligation; this is the other
 * half — the recipient's own way out.
 *
 * The link carries a SIGNED token rather than a database row, so:
 *   • no lookup table to grow or clean up;
 *   • the link cannot be forged to unsubscribe someone else;
 *   • it keeps working long after the message was sent (tokens are long-lived
 *     by design — an expired unsubscribe link is a compliance failure, not a
 *     security win).
 *
 * The token identifies (workspace, email address) only. It grants nothing
 * except the ability to stop mail to that one address.
 */

const jwt = require('jsonwebtoken');
const { normalizeEmail } = require('./dedupeService');

const SECRET = () => process.env.JWT_SECRET || '';

/** Where the public unsubscribe page lives (the API host serves it). */
const PUBLIC_BASE = () =>
  process.env.WEBHOOK_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

/**
 * Mint an unsubscribe token for an address in a workspace.
 * @returns {string|null} null when the inputs can't produce a valid token
 */
const makeToken = (organisation, email) => {
  const normalized = normalizeEmail(email);
  if (!organisation || !normalized || !SECRET()) return null;
  return jwt.sign(
    { org: String(organisation), email: normalized, t: 'unsub' },
    SECRET(),
    // Deliberately long-lived: a recipient who unsubscribes from an old message
    // must still succeed. Ten years is effectively "does not expire".
    { expiresIn: '3650d' }
  );
};

/** Verify a token → `{ organisation, email }`, or null when invalid. */
const verifyToken = (token) => {
  if (!token || !SECRET()) return null;
  try {
    const payload = jwt.verify(String(token), SECRET());
    if (!payload || payload.t !== 'unsub' || !payload.org || !payload.email) return null;
    return { organisation: payload.org, email: payload.email };
  } catch {
    return null;
  }
};

/** The absolute URL a recipient clicks. */
const buildUrl = (organisation, email) => {
  const token = makeToken(organisation, email);
  return token ? `${PUBLIC_BASE()}/u/${token}` : null;
};

/**
 * Append the unsubscribe footer to a composed message. Returns the body
 * unchanged when no URL can be built, so a misconfigured secret can never stop
 * a message being composed — but see `hasFooter`: the caller decides whether
 * sending without one is acceptable.
 */
const appendFooter = ({ html = '', text = '', url, companyName = '' }) => {
  if (!url) return { html, text, hasFooter: false };
  const who = companyName ? `${companyName} · ` : '';
  const htmlFooter =
    `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e4dccb;` +
    `font:12px -apple-system,Segoe UI,sans-serif;color:#9a9184">` +
    `${who}<a href="${url}" style="color:#9a9184">Unsubscribe from these emails</a>` +
    `</div>`;
  const textFooter = `\n\n---\n${who}Unsubscribe: ${url}`;
  return {
    html: `${html}${htmlFooter}`,
    text: `${text}${textFooter}`,
    hasFooter: true,
  };
};

/**
 * RFC 8058 / RFC 2369 headers, so Gmail and Outlook show their own native
 * "Unsubscribe" button next to the sender. Mail providers weigh this heavily
 * for deliverability, and it is the least friction for the recipient.
 */
const listUnsubscribeHeaders = (url) =>
  url
    ? {
        'List-Unsubscribe': `<${url}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      }
    : {};

module.exports = {
  makeToken,
  verifyToken,
  buildUrl,
  appendFooter,
  listUnsubscribeHeaders,
  PUBLIC_BASE,
};
