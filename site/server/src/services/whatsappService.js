/**
 * whatsappService.js — the shared "send a WhatsApp message" primitive
 * (Phase 3, F11.2).
 *
 * The WhatsApp sibling of `smsService` (F10.2), used by BOTH the task WhatsApp
 * tab and the `SEND_WHATSAPP` automation action. The two extra rules WhatsApp
 * Business imposes over SMS:
 *
 *   1. **24-hour customer-service window.** A contact must have messaged us
 *      (inbound) within the last 24h for a free-form send to be allowed. OUTSIDE
 *      that window only an `approved` pre-registered template may be sent; a
 *      free-form / unapproved-template send is refused (AC1). An inbound reply
 *      re-opens the window (AC3).
 *   2. **Template-only sends** carry a Twilio Content SID + a `{ "1": … }`
 *      variable map instead of a free-form body (AC2).
 *
 * Everything else mirrors SMS: it resolves the workspace `WhatsAppConfig`
 * (decrypting the Auth Token with the rotation fallback), normalises the
 * destination to E.164, reuses the F10 `SmsOptOut` gate so STOP suppresses both
 * channels, sends through the provider adapter, and persists one
 * `WhatsAppMessage` (with the Twilio SID for the status callbacks to walk).
 *
 * Never throws on a delivery failure — it returns a structured `{ ok, reason }`
 * so the action records a `failed`/`skipped` row and the controller returns a
 * clean 4xx/502.
 */

const mongoose = require('mongoose');
const WhatsAppConfig = require('../models/WhatsAppConfig');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const { getAdapter } = require('./whatsappAdapters');
const {
  toE164,
  isValidE164,
  phoneKey,
  phonesMatch,
  classifyKeyword,
  mapTwilioStatus,
  isOptedOut,
  recordOptOut,
  removeOptOut,
} = require('./smsService');

const TWILIO_CONTENT_API_BASE = 'https://content.twilio.com/v1';
// The WhatsApp Business customer-service window (Meta) — 24 hours.
const WINDOW_MS = 24 * 60 * 60 * 1000;

const statusCallbackUrl = () => {
  const base = process.env.TWILIO_WEBHOOK_BASE_URL || process.env.WEBHOOK_PUBLIC_BASE_URL || '';
  return base ? `${base.replace(/\/$/, '')}/api/whatsapp/status` : undefined;
};

// --- Template helpers (pure — unit-tested) ---------------------------------

/**
 * Normalise a template-variable config into a string-keyed Twilio
 * `ContentVariables` map. `{ 1: 'Acme', 2: 0 }` → `{ '1': 'Acme', '2': '0' }`.
 */
const buildContentVariables = (variables) => {
  const out = {};
  if (variables && typeof variables === 'object' && !Array.isArray(variables)) {
    for (const [k, v] of Object.entries(variables)) {
      const key = String(k).trim();
      if (!key) continue;
      out[key] = v == null ? '' : String(v);
    }
  }
  return out;
};

/**
 * Substitute `{{1}}`/`{{name}}` placeholders in a template body with the
 * provided variables (for the human-readable copy stored on the WhatsAppMessage
 * + the chat bubble). An unmatched placeholder is left intact.
 */
const renderTemplateBody = (body, variables) => {
  const vars = variables || {};
  return String(body == null ? '' : body).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  );
};

/** Collapse a Twilio approval-request status to our enum. */
const mapApprovalStatus = (raw) => {
  const v = String(raw == null ? '' : raw).toLowerCase();
  if (v === 'approved') return 'approved';
  if (v === 'rejected') return 'rejected';
  return 'pending';
};

/** First non-empty `body` across a Twilio Content resource's `types` map. */
const extractTemplateBody = (types) => {
  if (!types || typeof types !== 'object') return '';
  for (const key of Object.keys(types)) {
    const t = types[key];
    if (t && typeof t.body === 'string' && t.body) return t.body;
  }
  return '';
};

/**
 * Map a Twilio Content API resource (+ its WhatsApp approval status) to the
 * local `WhatsAppTemplate` upsert shape. Pure — the I/O lives in `syncTemplates`.
 */
const mapContentToTemplate = (content, approvalStatus) => {
  const variables =
    content && content.variables && typeof content.variables === 'object' && !Array.isArray(content.variables)
      ? Object.keys(content.variables)
      : [];
  return {
    providerTemplateId: content.sid,
    name: content.friendly_name || '',
    language: content.language || 'en',
    body: extractTemplateBody(content.types),
    variables,
    status: mapApprovalStatus(approvalStatus),
  };
};

// --- 24-hour window --------------------------------------------------------

/** Whether `lastInboundAt` falls inside the 24h window relative to `nowMs`. */
const isWindowOpen = (lastInboundAt, nowMs = Date.now()) => {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= WINDOW_MS;
};

/**
 * The most-recent inbound WhatsApp timestamp for `contact` in this workspace, or
 * null when the contact has never replied. Scopes to the workspace by reusing
 * the F10 phone-column task scan (the contact's inbound messages land on those
 * tasks), unioned with the explicit `taskId` of the conversation being sent on.
 */
const lastInboundAt = async ({ workspaceId, contact, taskId = null }) => {
  const taskIds = new Set();
  if (taskId) taskIds.add(String(taskId));
  try {
    // Lazy require avoids any load-order coupling with the SMS resolver.
    const { findTasksByPhone } = require('./smsInboundResolver');
    const tasks = await findTasksByPhone(workspaceId, contact);
    for (const t of tasks) taskIds.add(String(t._id));
  } catch {
    /* best-effort scoping — fall back to the explicit task only */
  }
  if (taskIds.size === 0) return null;

  const latest = await WhatsAppMessage.findOne({
    taskId: { $in: [...taskIds] },
    direction: 'in',
  })
    .sort({ sentAt: -1 })
    .select('sentAt')
    .lean();
  return latest ? new Date(latest.sentAt) : null;
};

/**
 * Resolve a template ref (Twilio Content SID, local _id, or name) to the
 * workspace's `WhatsAppTemplate`, or null.
 */
const resolveTemplate = async (workspaceId, templateRef) => {
  const ref = String(templateRef == null ? '' : templateRef).trim();
  if (!ref) return null;
  const bySid = await WhatsAppTemplate.findOne({ workspaceId, providerTemplateId: ref });
  if (bySid) return bySid;
  if (mongoose.Types.ObjectId.isValid(ref)) {
    const byId = await WhatsAppTemplate.findOne({ _id: ref, workspaceId });
    if (byId) return byId;
  }
  return WhatsAppTemplate.findOne({ workspaceId, name: ref });
};

// --- Send ------------------------------------------------------------------

/**
 * Send a WhatsApp message on a task.
 *
 * @param {object} opts
 * @param {string|ObjectId} opts.workspaceId
 * @param {string} opts.to                  — destination (any format; normalised)
 * @param {string|ObjectId} [opts.taskId]   — the conversation task
 * @param {string} [opts.templateId]        — Content SID / template _id / name
 * @param {object} [opts.variables]         — `{ "1": "…" }` template variables
 * @param {string} [opts.body]              — free-form body (in-window only)
 * @param {string} [opts.mediaUrl]          — public media URL (image/document)
 * @returns {Promise<{ ok:boolean, reason?:string, message?:object, status?:string, error?:string, windowOpen?:boolean }>}
 *   reason ∈ no_whatsapp_config | invalid_number | opted_out | template_not_found
 *          | window_closed | template_not_approved | empty_message | send_error
 */
const send = async ({
  workspaceId,
  to,
  taskId = null,
  templateId = null,
  variables = {},
  body = '',
  mediaUrl = null,
}) => {
  if (!workspaceId) return { ok: false, reason: 'no_whatsapp_config' };

  const config = await WhatsAppConfig.findOne({ workspaceId });
  if (!config || !config.isSendable()) return { ok: false, reason: 'no_whatsapp_config' };

  const dest = toE164(to);
  if (!isValidE164(dest)) return { ok: false, reason: 'invalid_number' };

  // Shared TCPA/CASL gate (F10 opt-out store) — STOP blocks SMS AND WhatsApp.
  if (await isOptedOut(workspaceId, dest)) return { ok: false, reason: 'opted_out' };

  // Resolve the requested template (if any).
  let template = null;
  if (templateId) {
    template = await resolveTemplate(workspaceId, templateId);
    if (!template) return { ok: false, reason: 'template_not_found' };
  }

  // 24h window enforcement (AC1/AC3/AC4).
  const inboundAt = await lastInboundAt({ workspaceId, contact: dest, taskId });
  const windowOpen = isWindowOpen(inboundAt);
  if (!windowOpen) {
    if (!template) return { ok: false, reason: 'window_closed', windowOpen };
    if (template.status !== 'approved') {
      return { ok: false, reason: 'template_not_approved', windowOpen };
    }
  }

  const contentVariables = template ? buildContentVariables(variables) : null;
  const renderedBody = template
    ? renderTemplateBody(template.body, contentVariables)
    : body == null
      ? ''
      : String(body);

  if (!template && !renderedBody.trim() && !mediaUrl) {
    return { ok: false, reason: 'empty_message', windowOpen };
  }

  const { authToken, needsReEncrypt } = config.getDecryptedAuthToken();
  if (!authToken) return { ok: false, reason: 'no_whatsapp_config' };
  // Lazy re-encrypt under the current key (rotation strategy) — best-effort.
  if (needsReEncrypt) {
    config.setAuthToken(authToken);
    config.updatedAt = new Date();
    config.save().catch(() => {});
  }

  const message = await WhatsAppMessage.create({
    taskId,
    direction: 'out',
    from: config.whatsappSenderId || '',
    to: dest,
    body: renderedBody,
    mediaUrl: mediaUrl || null,
    status: 'queued',
    sentAt: new Date(),
  });

  try {
    const adapter = getAdapter('twilio');
    const result = await adapter.send({
      accountSid: config.accountSid,
      authToken,
      from: config.whatsappSenderId,
      to: dest,
      body: template ? undefined : renderedBody,
      contentSid: template ? template.providerTemplateId : undefined,
      contentVariables: template ? contentVariables : undefined,
      mediaUrl: mediaUrl || undefined,
      statusCallback: statusCallbackUrl(),
    });
    message.twilioSid = result.sid || null;
    message.status = mapTwilioStatus(result.status);
    message.statusUpdates.push({ status: result.status || message.status, at: new Date() });
    await message.save();
    return { ok: true, message, status: message.status, windowOpen };
  } catch (err) {
    message.status = 'failed';
    message.error = err.message;
    message.statusUpdates.push({ status: 'failed', at: new Date() });
    await message.save().catch(() => {});
    return { ok: false, reason: 'send_error', message, error: err.message, windowOpen };
  }
};

// --- Template sync (Twilio Content API) ------------------------------------

const fetchTwilioJson = async (url, auth) => {
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data && data.message) || `Twilio Content API error (HTTP ${res.status})`;
    const err = new Error(message);
    err.httpStatus = res.status;
    throw err;
  }
  return data;
};

/** Best-effort WhatsApp approval status for one Content SID (defaults pending). */
const fetchApprovalStatus = async (contentSid, auth) => {
  try {
    const data = await fetchTwilioJson(
      `${TWILIO_CONTENT_API_BASE}/Content/${encodeURIComponent(contentSid)}/ApprovalRequests`,
      auth
    );
    return (data && data.whatsapp && data.whatsapp.status) || 'pending';
  } catch {
    return 'pending';
  }
};

/**
 * Pull the workspace's Twilio Content templates and upsert local
 * `WhatsAppTemplate` rows (idempotent on the `(workspaceId, providerTemplateId)`
 * unique index). Returns `{ ok, templates, count }` or `{ ok:false, reason }`.
 */
const syncTemplates = async (workspaceId) => {
  if (!workspaceId) return { ok: false, reason: 'no_whatsapp_config' };
  const config = await WhatsAppConfig.findOne({ workspaceId });
  if (!config || !config.accountSid || !config.authToken) {
    return { ok: false, reason: 'no_whatsapp_config' };
  }
  const { authToken, needsReEncrypt } = config.getDecryptedAuthToken();
  if (!authToken) return { ok: false, reason: 'no_whatsapp_config' };
  if (needsReEncrypt) {
    config.setAuthToken(authToken);
    config.updatedAt = new Date();
    config.save().catch(() => {});
  }
  const auth = Buffer.from(`${config.accountSid}:${authToken}`).toString('base64');

  let contents = [];
  try {
    const data = await fetchTwilioJson(`${TWILIO_CONTENT_API_BASE}/Content?PageSize=50`, auth);
    contents = Array.isArray(data.contents) ? data.contents : [];
  } catch (err) {
    return { ok: false, reason: 'sync_error', error: err.message };
  }

  const now = new Date();
  const templates = [];
  for (const content of contents) {
    if (!content || !content.sid) continue;
    const approval = await fetchApprovalStatus(content.sid, auth);
    const mapped = mapContentToTemplate(content, approval);
    const doc = await WhatsAppTemplate.findOneAndUpdate(
      { workspaceId, providerTemplateId: mapped.providerTemplateId },
      { $set: { ...mapped, workspaceId, lastSyncedAt: now } },
      { upsert: true, new: true }
    );
    templates.push(doc);
  }
  return { ok: true, templates, count: templates.length };
};

module.exports = {
  send,
  syncTemplates,
  resolveTemplate,
  lastInboundAt,
  // Pure helpers (shared with the controller + unit tests).
  isWindowOpen,
  buildContentVariables,
  renderTemplateBody,
  mapContentToTemplate,
  mapApprovalStatus,
  extractTemplateBody,
  WINDOW_MS,
  // Re-exported phone/opt-out helpers (so the controller has one import).
  toE164,
  isValidE164,
  phoneKey,
  phonesMatch,
  classifyKeyword,
  mapTwilioStatus,
  isOptedOut,
  recordOptOut,
  removeOptOut,
};
