/**
 * smsAdapters/twilio.js — send an SMS via Twilio (Phase 3, F10.2).
 *
 * Mirrors F8's "REST API over built-in `fetch`, not the vendor SDK" decision
 * (emailProviders/rest.js): the Twilio Messages endpoint is a single
 * Basic-auth form POST, so the `twilio` npm package is deliberately NOT added —
 * no SDK weight, and inbound signature validation is a dependency-free
 * `crypto` helper (utils/twilioSignature.js). Swapping in Plivo/Vonage means
 * adding a sibling adapter and registering it in `smsAdapters/index.js`.
 */

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

/**
 * Send one SMS. Resolves to `{ sid, status, raw }` on a 2xx; throws on a
 * non-2xx (the caller marks the SmsMessage `failed` and records the message).
 *
 * @param {object} opts
 * @param {string} opts.accountSid
 * @param {string} opts.authToken            — decrypted Twilio Auth Token
 * @param {string} [opts.from]               — E.164 sender (or use messagingServiceSid)
 * @param {string} [opts.messagingServiceSid]
 * @param {string} opts.to                   — E.164 destination
 * @param {string} opts.body
 * @param {string} [opts.statusCallback]     — URL Twilio POSTs delivery updates to
 * @returns {Promise<{ sid: string|null, status: string, raw: object }>}
 */
const send = async ({
  accountSid,
  authToken,
  from,
  messagingServiceSid,
  to,
  body,
  statusCallback,
}) => {
  if (!accountSid || !authToken) throw new Error('twilio adapter: missing credentials');
  if (!to) throw new Error('twilio adapter: missing destination number');
  if (!from && !messagingServiceSid) {
    throw new Error('twilio adapter: a From number or Messaging Service SID is required');
  }

  const url = `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const form = new URLSearchParams();
  form.set('To', to);
  if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
  else form.set('From', from);
  form.set('Body', body == null ? '' : String(body));
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

module.exports = { name: 'twilio', send };
