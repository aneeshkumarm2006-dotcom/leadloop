/**
 * whatsappAdapters/twilio.js — send a WhatsApp message via Twilio (Phase 3,
 * F11.2).
 *
 * Mirrors `smsAdapters/twilio.js` (F10.2) — Twilio's Messages endpoint over
 * built-in `fetch`, a single Basic-auth form POST, no SDK weight. WhatsApp is
 * the same endpoint with three differences:
 *   1. `From`/`To` are prefixed `whatsapp:` (e.g. `whatsapp:+14155238886`).
 *   2. Template sends pass `ContentSid` (the Content SID) + `ContentVariables`
 *      (a JSON map of `{ "1": "…", "2": "…" }`) instead of a free-form `Body`.
 *   3. Media rides `MediaUrl` (a publicly reachable URL — Cloudinary here).
 *
 * A future Meta Cloud API adapter (`whatsappAdapters/meta.js`) drops in beside
 * this one and registers in `whatsappAdapters/index.js`.
 */

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

const withPrefix = (num) => {
  const s = String(num == null ? '' : num).trim();
  if (!s) return s;
  return s.startsWith('whatsapp:') ? s : `whatsapp:${s}`;
};

/**
 * Send one WhatsApp message. Resolves to `{ sid, status, raw }` on a 2xx; throws
 * on a non-2xx (the caller marks the WhatsAppMessage `failed` and records it).
 *
 * @param {object} opts
 * @param {string} opts.accountSid
 * @param {string} opts.authToken            — decrypted Twilio Auth Token
 * @param {string} opts.from                 — WhatsApp sender (E.164 or whatsapp:…)
 * @param {string} opts.to                   — E.164 destination (whatsapp: added)
 * @param {string} [opts.body]               — free-form text (in-window sends)
 * @param {string} [opts.contentSid]         — Twilio Content SID (template send)
 * @param {object} [opts.contentVariables]   — `{ "1": "…" }` template variables
 * @param {string} [opts.mediaUrl]           — public media URL (image/document)
 * @param {string} [opts.statusCallback]     — URL Twilio POSTs delivery updates to
 * @returns {Promise<{ sid: string|null, status: string, raw: object }>}
 */
const send = async ({
  accountSid,
  authToken,
  from,
  to,
  body,
  contentSid,
  contentVariables,
  mediaUrl,
  statusCallback,
}) => {
  if (!accountSid || !authToken) throw new Error('whatsapp adapter: missing credentials');
  if (!to) throw new Error('whatsapp adapter: missing destination number');
  if (!from) throw new Error('whatsapp adapter: a WhatsApp sender is required');
  if (!contentSid && !body && !mediaUrl) {
    throw new Error('whatsapp adapter: a template, body, or media is required');
  }

  const url = `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const form = new URLSearchParams();
  form.set('To', withPrefix(to));
  form.set('From', withPrefix(from));
  if (contentSid) {
    form.set('ContentSid', contentSid);
    if (contentVariables && Object.keys(contentVariables).length > 0) {
      form.set('ContentVariables', JSON.stringify(contentVariables));
    }
  } else {
    form.set('Body', body == null ? '' : String(body));
  }
  if (mediaUrl) form.set('MediaUrl', mediaUrl);
  if (statusCallback) form.set('StatusCallback', statusCallback);

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (data && (data.message || data.error_message)) || `Twilio API error (HTTP ${res.status})`;
    const err = new Error(message);
    err.twilioCode = data && data.code;
    err.httpStatus = res.status;
    throw err;
  }

  return { sid: data.sid || null, status: data.status || 'queued', raw: data };
};

module.exports = { name: 'twilio', send, withPrefix };
