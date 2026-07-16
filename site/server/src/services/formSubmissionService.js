/**
 * formSubmissionService.js — public form submission → task (Phase 4, F13.2).
 *
 * The F13 counterpart to the F7 inbound webhook resolver
 * ([webhookInboundResolver.js](./webhookInboundResolver.js)): it resolves a
 * public `:slug` to its enabled `Form`, validates the submitted payload against
 * the form's `fieldMap`, optionally verifies a Cloudflare Turnstile token, maps
 * each field's value onto its bound board column, creates a task via the shared
 * `createTaskWithColumnValues` primitive, records a `Submission` audit row, and
 * fans out the same domain events so automations + the F9 intake policy wake up:
 *
 *   - `item.created`     — so ITEM_CREATED automations treat the lead like any
 *                          new item (parity with the webhook resolver);
 *   - `form.submitted`   — drives the F4 `FORM_SUBMITTED` trigger (the dispatcher
 *                          already subscribes), matched by `formId` (AC2);
 *   - `lead.intake`      — the F9 lead-intake-policy signal.
 *
 * AC5: when the target board has `useFlexibleColumns: false` (legacy), there are
 * no columns to map onto, so fields are folded into the legacy `name`/`note`
 * task fields and a documented `legacy_board_mapping` warning is returned — the
 * failure path is visible, never a silent drop.
 */

const Board = require('../models/Board');
const Form = require('../models/Form');
const Submission = require('../models/Submission');
const Task = require('../models/Task');
const eventBus = require('./eventBus');
const { createTaskWithColumnValues } = require('./taskCreation');

const asId = (v) => (v == null ? '' : v.toString());

class FormSubmitError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verify a Cloudflare Turnstile token. Skips cleanly (returns true) when
 * `TURNSTILE_SECRET` is unset so the feature degrades to "no captcha" rather
 * than blocking every submit. When a secret IS configured, a missing or
 * rejected token fails closed (the form opted into captcha).
 */
const verifyTurnstile = async (token, ip) => {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true; // captcha not provisioned — skip
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    return !!data.success;
  } catch (err) {
    // Fail closed: a captcha-enabled form must not let traffic through when the
    // verifier is unreachable.
    console.error('[form/submit] turnstile verify failed:', err?.message || err);
    return false;
  }
};

/** Coerce a raw submitted value per the FORM field type (light pre-coercion; the
 *  board column's own validator is the real gate when the task is created). */
const coerceValue = (type, raw) => {
  if (raw == null) return '';
  if (type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : '';
  }
  if (type === 'checkbox') return raw === true || raw === 'true' || raw === 'on';
  if (typeof raw === 'string') return raw.trim();
  return raw;
};

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Resolve a status/dropdown/tags option from a submitted value that may be the
 * option id OR its human label (public forms show labels). Returns the canonical
 * option id, or the original value when no option matches (the column validator
 * then surfaces it as a warning — never a silent miss).
 */
const matchOption = (col, value) => {
  const opts = (col.settings && Array.isArray(col.settings.options) && col.settings.options) || [];
  const s = value == null ? '' : String(value).trim();
  if (!s) return value;
  const byId = opts.find((o) => o && o.id != null && String(o.id) === s);
  if (byId) return String(byId.id);
  const byLabel = opts.find((o) => o && (o.label || '').toLowerCase() === s.toLowerCase());
  if (byLabel) return String(byLabel.id);
  return value;
};

/**
 * Map a submitted field value onto its target column's expected shape so a
 * public form (which shows labels) maps cleanly onto option-id-based columns.
 */
const resolveValueForColumn = (board, columnId, value) => {
  const col = (board.columns || []).find((c) => asId(c._id) === asId(columnId));
  if (!col) return value;
  if (col.type === 'status' || col.type === 'dropdown') return matchOption(col, value);
  if (col.type === 'tags') {
    const arr = Array.isArray(value)
      ? value
      : String(value).split(',').map((s) => s.trim()).filter(Boolean);
    return arr.map((x) => matchOption(col, x));
  }
  return value;
};

/**
 * Validate + coerce the payload against the form's fieldMap. Returns
 * `{ values: { [formFieldId]: coerced }, missingRequired: [label] }`.
 */
const validatePayload = (form, payload) => {
  const body = payload && typeof payload === 'object' ? payload : {};
  const values = {};
  const missingRequired = [];
  for (const field of form.fieldMap || []) {
    const raw = body[field.formFieldId];
    const coerced = coerceValue(field.type, raw);
    if (field.required && isEmpty(coerced)) {
      missingRequired.push(field.label || field.formFieldId);
      continue;
    }
    values[field.formFieldId] = coerced;
  }
  return { values, missingRequired };
};

/**
 * AC5 legacy mapping: with no board columns to target, fold the submitted
 * fields into the legacy `name` + `note` task fields. `name` prefers a field
 * labelled name/title, else the first non-empty value.
 */
const mapToLegacyFields = (form, values) => {
  const fields = form.fieldMap || [];
  let name = null;
  const named = fields.find((f) => /name|title|full.?name/i.test(f.label || ''));
  if (named && !isEmpty(values[named.formFieldId])) {
    name = String(values[named.formFieldId]).trim();
  }
  if (!name) {
    const firstFilled = fields.find((f) => !isEmpty(values[f.formFieldId]));
    if (firstFilled) name = String(values[firstFilled.formFieldId]).trim();
  }
  const noteLines = fields
    .filter((f) => !isEmpty(values[f.formFieldId]))
    .map((f) => `${f.label || f.formFieldId}: ${values[f.formFieldId]}`);
  return { name: name || 'Form submission', note: noteLines.join('\n') };
};

/**
 * Submit a form by its public slug.
 *
 * @param {string} slug
 * @param {Object} submission
 * @param {Object} submission.payload         - `{ [formFieldId]: value }`
 * @param {string} [submission.turnstileToken]- `cf-turnstile-response`
 * @param {string} [submission.ip]
 * @param {string} [submission.userAgent]
 * @returns {Promise<{ taskId, submissionId, warnings, redirectUrl, welcomeMessage }>}
 * @throws {FormSubmitError} 404 unknown/disabled slug; 422 board missing;
 *         400 captcha/required-field failure.
 */
const submitForm = async (slug, { payload = {}, turnstileToken, ip, userAgent } = {}) => {
  if (!slug) throw new FormSubmitError(404, 'Form not found');

  const form = await Form.findOne({ slug, enabled: true });
  if (!form) throw new FormSubmitError(404, 'Form not found');

  const board = await Board.findById(form.boardId).select(
    'statuses columns useFlexibleColumns organisation createdBy name'
  );
  if (!board) throw new FormSubmitError(422, 'This form is no longer connected to a board');

  // Captcha — only enforced when the form opted in AND a secret is configured.
  if (form.captchaEnabled) {
    const ok = await verifyTurnstile(turnstileToken, ip);
    if (!ok) throw new FormSubmitError(400, 'Captcha verification failed. Please try again.');
  }

  // Validate required fields up front — a missing required field rejects the
  // whole submission (no partial task) so the user gets a clear error.
  const { values, missingRequired } = validatePayload(form, payload);
  if (missingRequired.length > 0) {
    throw new FormSubmitError(400, `Missing required field(s): ${missingRequired.join(', ')}`, {
      missingRequired,
    });
  }

  let task;
  const warnings = [];

  if (board.useFlexibleColumns) {
    // Map each field's value onto its bound column. Empty values are left unset.
    const columnValues = {};
    for (const field of form.fieldMap || []) {
      if (!field.columnId) continue;
      const v = values[field.formFieldId];
      if (isEmpty(v)) continue;
      // Public forms show labels; resolve label→option-id for status/dropdown/tags.
      columnValues[asId(field.columnId)] = resolveValueForColumn(board, field.columnId, v);
    }
    // Phase 2.3 — auto-fill the lead source: stamp the form's source tag onto
    // its configured source column (unless a mapped field already set it).
    if (form.sourceTag && form.sourceColumnId) {
      const sid = asId(form.sourceColumnId);
      const onBoard = (board.columns || []).some((c) => asId(c._id) === sid);
      if (onBoard && columnValues[sid] === undefined) {
        columnValues[sid] = resolveValueForColumn(board, form.sourceColumnId, form.sourceTag);
      }
    }
    const created = await createTaskWithColumnValues({
      board,
      columnValues,
      createdBy: board.createdBy,
    });
    task = created.task;
    // Per-column validation misses surface (never silently dropped).
    if (Array.isArray(created.warnings)) warnings.push(...created.warnings);
  } else {
    // AC5 — legacy board: fold into name/note + a documented warning.
    const { name, note } = mapToLegacyFields(form, values);
    const created = await createTaskWithColumnValues({ board, name, createdBy: board.createdBy });
    task = created.task;
    if (note) {
      await Task.updateOne({ _id: task._id }, { $set: { note } }).catch((err) =>
        console.error('[form/submit] failed to set legacy note:', err?.message || err)
      );
    }
    warnings.push({
      reason: 'legacy_board_mapping',
      message:
        'Target board does not use flexible columns; fields were mapped to the legacy name/note fields instead of columns.',
    });
  }

  // Audit row — a failed audit write must not 500 the submission (the task is
  // the deliverable). Mirrors the webhook resolver's delivery-row handling.
  let submissionRow = null;
  try {
    submissionRow = await Submission.create({
      formId: form._id,
      payload,
      taskId: task._id,
      ip: ip || '',
      userAgent: userAgent || '',
    });
  } catch (err) {
    console.error('[form/submit] failed to write submission row:', err?.message || err);
  }

  // Fan out domain events (parity with the webhook resolver). The lead is a
  // real external submission (not automation-created), so ITEM_CREATED
  // automations run normally; `form.submitted` drives F4; `lead.intake` drives F9.
  const eventPayload = {
    taskId: task._id,
    boardId: board._id,
    formId: form._id,
    payload,
  };
  eventBus.emit('item.created', {
    taskId: task._id,
    boardId: board._id,
    groupId: task.group,
    statusId: task.status,
    createdByUserId: asId(board.createdBy),
  });
  eventBus.emit('form.submitted', eventPayload);
  eventBus.emit('lead.intake', eventPayload);

  return {
    taskId: task._id,
    submissionId: submissionRow ? submissionRow._id : null,
    warnings,
    redirectUrl: form.postSubmitRedirectUrl || '',
    welcomeMessage: form.welcomeMessage || '',
  };
};

module.exports = {
  submitForm,
  FormSubmitError,
  // Exported for unit tests.
  validatePayload,
  mapToLegacyFields,
  coerceValue,
  verifyTurnstile,
  resolveValueForColumn,
};
