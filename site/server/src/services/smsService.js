/**
 * smsService.js — the shared "send an SMS" primitive (Phase 3, F10.2).
 *
 * One programmatic path used by BOTH the task SMS tab (a user replying from the
 * drawer) and the SEND_SMS automation action. For every send it:
 *   1. resolves the workspace's `SmsConfig` (decrypting the Auth Token, with the
 *      lazy previous-key re-encrypt from the rotation decision);
 *   2. normalises the destination to E.164 and validates it;
 *   3. checks `SmsOptOut` FIRST and blocks opted-out numbers (TCPA/CASL gate,
 *      shared with F11 WhatsApp);
 *   4. appends the "Reply STOP to opt out" footer unless the body already
 *      mentions STOP (gated by `config.appendOptOutFooter`);
 *   5. sends through the provider adapter and persists one `SmsMessage`, storing
 *      the Twilio SID. The `POST /api/sms/status` callbacks then walk its status.
 *
 * Never throws on a delivery failure — it returns a structured `{ ok, reason }`
 * so the action records a `failed`/`skipped` AutomationRunLog row and the
 * controller returns a clean 4xx/502.
 */

const SmsConfig = require('../models/SmsConfig');
const SmsMessage = require('../models/SmsMessage');
const SmsOptOut = require('../models/SmsOptOut');
const { getAdapter } = require('./smsAdapters');

const OPT_OUT_FOOTER = '\n\nReply STOP to opt out';

// Inbound keyword sets (Twilio's Advanced Opt-Out parity). Matched on the whole
// trimmed body, case-insensitively.
const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_KEYWORDS = new Set(['START', 'UNSTOP', 'YES']);

/**
 * Normalise a phone number to E.164. A bare 10-digit number is assumed NANP
 * (`+1…`); an 11-digit `1…` gets a leading `+`; anything already `+`-prefixed is
 * kept (digits only). Other lengths are passed through with a `+` so an
 * already-international number isn't mangled. Returns '' for empty/garbage.
 */
const toE164 = (raw) => {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (s.startsWith('+')) {
    const digits = s.slice(1).replace(/\D/g, '');
    return digits ? `+${digits}` : '';
  }
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
};

/** A loose E.164 sanity check (8–16 digits after the `+`). */
const isValidE164 = (e164) => /^\+\d{8,16}$/.test(e164 || '');

/** Last-10-digits key for tolerant matching across stored formats. */
const phoneKey = (raw) => {
  const digits = String(raw == null ? '' : raw).replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};

/** Whether two numbers refer to the same line (ignoring formatting/country). */
const phonesMatch = (a, b) => {
  const ka = phoneKey(a);
  const kb = phoneKey(b);
  return !!ka && ka === kb;
};

/** Classify an inbound body as a STOP / START command, or null for normal text. */
const classifyKeyword = (body) => {
  const word = String(body == null ? '' : body).trim().toUpperCase();
  if (STOP_KEYWORDS.has(word)) return 'stop';
  if (START_KEYWORDS.has(word)) return 'start';
  return null;
};

const statusCallbackUrl = () => {
  const base = process.env.TWILIO_WEBHOOK_BASE_URL || process.env.WEBHOOK_PUBLIC_BASE_URL || '';
  return base ? `${base.replace(/\/$/, '')}/api/sms/status` : undefined;
};

/**
 * Map a Twilio message status to our SmsMessage `status` enum.
 * queued/accepted/scheduled/sending/receiving → queued; sent → sent;
 * delivered → delivered; failed/undelivered → failed; received → received.
 */
const mapTwilioStatus = (s) => {
  const v = String(s == null ? '' : s).toLowerCase();
  if (v === 'delivered') return 'delivered';
  if (v === 'sent') return 'sent';
  if (v === 'failed' || v === 'undelivered') return 'failed';
  if (v === 'received') return 'received';
  return 'queued';
};

// --- Opt-out store helpers (shared with the inbound controller + F11) --------

// Opt-outs match on `phoneKey` (last-10 digits) — the SAME tolerant key the
// inbound resolver uses — so a STOP from an international/E.164 number blocks a
// send to the same line stored in national format (toE164 only canonicalises
// NANP, so an exact-E.164 match would let other countries slip the gate).

const isOptedOut = async (workspaceId, phone) => {
  const key = phoneKey(phone);
  if (!workspaceId || !key) return false;
  const row = await SmsOptOut.findOne({ workspaceId, phoneKey: key }).select('_id');
  return !!row;
};

const recordOptOut = async (workspaceId, phone) => {
  const key = phoneKey(phone);
  if (!workspaceId || !key) return null;
  // Idempotent upsert against the unique (workspaceId, phoneKey) index.
  return SmsOptOut.findOneAndUpdate(
    { workspaceId, phoneKey: key },
    { $setOnInsert: { workspaceId, phoneKey: key, phone: toE164(phone) || String(phone), optedOutAt: new Date() } },
    { upsert: true, new: true }
  );
};

const removeOptOut = async (workspaceId, phone) => {
  const key = phoneKey(phone);
  if (!workspaceId || !key) return false;
  const res = await SmsOptOut.deleteOne({ workspaceId, phoneKey: key });
  return res.deletedCount > 0;
};

/**
 * Send an SMS on a task.
 *
 * @param {object} opts
 * @param {string|ObjectId} opts.workspaceId
 * @param {string} opts.to                 — destination (any format; normalised)
 * @param {string} opts.body
 * @param {string|ObjectId} [opts.taskId]  — the task the message belongs to
 * @returns {Promise<{ ok:boolean, reason?:string, message?:object, status?:string, error?:string }>}
 *   reason ∈ no_sms_config | invalid_number | opted_out | send_error
 */
const send = async ({ workspaceId, to, body, taskId = null }) => {
  if (!workspaceId) return { ok: false, reason: 'no_sms_config' };

  const config = await SmsConfig.findOne({ workspaceId });
  if (!config || !config.isSendable()) return { ok: false, reason: 'no_sms_config' };

  const dest = toE164(to);
  if (!isValidE164(dest)) return { ok: false, reason: 'invalid_number' };

  // TCPA/CASL gate — blocked numbers never reach the provider.
  if (await isOptedOut(workspaceId, dest)) return { ok: false, reason: 'opted_out' };

  const { authToken, needsReEncrypt } = config.getDecryptedAuthToken();
  if (!authToken) return { ok: false, reason: 'no_sms_config' };
  // Lazy re-encrypt under the current key (rotation strategy) — best-effort.
  if (needsReEncrypt) {
    config.setAuthToken(authToken);
    config.updatedAt = new Date();
    config.save().catch(() => {});
  }

  let finalBody = body == null ? '' : String(body);
  if (config.appendOptOutFooter && !/stop/i.test(finalBody)) {
    finalBody += OPT_OUT_FOOTER;
  }

  const message = await SmsMessage.create({
    taskId,
    direction: 'out',
    from: config.defaultFrom || '',
    to: dest,
    body: finalBody,
    status: 'queued',
    sentAt: new Date(),
  });

  try {
    const adapter = getAdapter('twilio');
    const result = await adapter.send({
      accountSid: config.accountSid,
      authToken,
      from: config.defaultFrom,
      messagingServiceSid: config.messagingServiceSid,
      to: dest,
      body: finalBody,
      statusCallback: statusCallbackUrl(),
    });
    message.twilioSid = result.sid || null;
    message.status = mapTwilioStatus(result.status);
    message.statusUpdates.push({ status: result.status || message.status, at: new Date() });
    await message.save();
    return { ok: true, message, status: message.status };
  } catch (err) {
    message.status = 'failed';
    message.error = err.message;
    message.statusUpdates.push({ status: 'failed', at: new Date() });
    await message.save().catch(() => {});
    return { ok: false, reason: 'send_error', message, error: err.message };
  }
};

module.exports = {
  send,
  // Shared helpers (inbound controller / status callback / F11 reuse).
  toE164,
  isValidE164,
  phoneKey,
  phonesMatch,
  classifyKeyword,
  mapTwilioStatus,
  isOptedOut,
  recordOptOut,
  removeOptOut,
  STOP_KEYWORDS,
  START_KEYWORDS,
  OPT_OUT_FOOTER,
};
