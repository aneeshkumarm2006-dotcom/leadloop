/**
 * formController.js — F13.4 form HTTP handlers.
 *
 * Two PUBLIC handlers (`renderForm`, `submitForm`) mounted without auth (see the
 * PUBLIC ROUTE ALLOWLIST in app.js), and four authed, board-scoped management
 * handlers. Board management mirrors the F7 webhook controller's admin gate
 * (org membership for reads, org admin for writes).
 */

const mongoose = require('mongoose');
const Board = require('../models/Board');
const Organisation = require('../models/Organisation');
const Form = require('../models/Form');
const { submitForm: runSubmit, FormSubmitError } = require('../services/formSubmissionService');

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

const isOrgMember = (org, userId) =>
  !!org && Array.isArray(org.members) && org.members.some((m) => m.toString() === userId);

// The public form page `/f/:slug` is served by the FRONTEND (the React app), so
// its shareable URL must be built from CLIENT_URL — not the server base
// (WEBHOOK_PUBLIC_BASE_URL), which is for webhook callbacks. Trailing slash
// stripped so we don't emit `//f/...`.
const PUBLIC_BASE_URL = () =>
  (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Load board + org for a member (read). Returns `{ board, org }` or `{ status, error }`. */
const loadBoardForMember = async (boardId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(boardId)) return { status: 400, error: 'Invalid board id' };
  const board = await Board.findById(boardId);
  if (!board) return { status: 404, error: 'Board not found' };
  const org = await Organisation.findById(board.organisation);
  if (!org) return { status: 404, error: 'Organisation not found' };
  if (!isOrgMember(org, userId)) return { status: 403, error: 'Not a member of this workspace' };
  return { board, org };
};

/** Load board + org asserting the caller is a workspace admin (write). */
const loadBoardAdmin = async (boardId, userId) => {
  const ctx = await loadBoardForMember(boardId, userId);
  if (ctx.error) return ctx;
  if (!isOrgAdmin(ctx.org, userId)) return { status: 403, error: 'Admin access required' };
  return ctx;
};

let fieldSeq = 0;
const nextFieldId = () =>
  `f_${Date.now().toString(36)}_${(fieldSeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** Normalise an incoming `fieldMap` array into the stored shape. */
const sanitizeFieldMap = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw.map((f) => ({
    formFieldId: f && f.formFieldId ? String(f.formFieldId) : nextFieldId(),
    label: f && typeof f.label === 'string' ? f.label : '',
    type: f && typeof f.type === 'string' ? f.type : 'text',
    required: !!(f && f.required),
    columnId: f && f.columnId ? String(f.columnId) : null,
    options: f && Array.isArray(f.options) ? f.options.map(String) : [],
  }));
};

/** Hex color guard (#rgb or #rrggbb). */
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Sanitise the public-form branding payload (Phase 1.7). Image fields must be
 * http(s) URLs; accentColor must be a hex string; headline is length-capped.
 * Anything invalid falls back to empty → default styling.
 */
const sanitizeBranding = (b) => {
  const x = b && typeof b === 'object' ? b : {};
  const url = (v) =>
    typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : '';
  return {
    logoUrl: url(x.logoUrl),
    coverUrl: url(x.coverUrl),
    accentColor:
      typeof x.accentColor === 'string' && HEX_RE.test(x.accentColor.trim())
        ? x.accentColor.trim()
        : '',
    headline: typeof x.headline === 'string' ? x.headline.slice(0, 120) : '',
  };
};

const brandingOut = (f) => ({
  logoUrl: f.branding?.logoUrl || '',
  coverUrl: f.branding?.coverUrl || '',
  accentColor: f.branding?.accentColor || '',
  headline: f.branding?.headline || '',
});

/** Full admin-facing form shape (includes the composed public URL). */
const serializeForm = (f) => ({
  _id: f._id,
  boardId: f.boardId,
  slug: f.slug,
  name: f.name,
  fieldMap: f.fieldMap || [],
  welcomeMessage: f.welcomeMessage || '',
  postSubmitRedirectUrl: f.postSubmitRedirectUrl || '',
  captchaEnabled: !!f.captchaEnabled,
  enabled: !!f.enabled,
  branding: brandingOut(f),
  sourceTag: f.sourceTag || '',
  sourceColumnId: f.sourceColumnId || null,
  publicUrl: `${PUBLIC_BASE_URL()}/f/${f.slug}`,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
});

/** Public, auth-free form config — no internal ids beyond what the page needs. */
const serializePublicForm = (f) => ({
  slug: f.slug,
  name: f.name,
  fieldMap: (f.fieldMap || []).map((field) => ({
    formFieldId: field.formFieldId,
    label: field.label,
    type: field.type,
    required: !!field.required,
    options: field.options || [],
  })),
  welcomeMessage: f.welcomeMessage || '',
  branding: brandingOut(f),
  captchaEnabled: !!f.captchaEnabled,
  captchaSiteKey: f.captchaEnabled ? process.env.TURNSTILE_SITE_KEY || null : null,
});

// ===========================================================================
// PUBLIC
// ===========================================================================

/** GET /f/:slug (public) → public form config JSON, or 404. */
const renderForm = async (req, res) => {
  try {
    const form = await Form.findOne({ slug: req.params.slug, enabled: true });
    if (!form) return res.status(404).json({ error: 'Form not found' });
    return res.json({ form: serializePublicForm(form) });
  } catch (err) {
    console.error('renderForm error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /f/:slug/submit (public, rate-limited) → create a task + audit row. */
const submitForm = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : body;
    const result = await runSubmit(req.params.slug, {
      payload,
      turnstileToken: body['cf-turnstile-response'] || body.turnstileToken,
      ip: req.ip || (req.socket && req.socket.remoteAddress) || '',
      userAgent: req.headers['user-agent'] || '',
    });
    return res.status(201).json({
      ok: true,
      taskId: result.taskId,
      redirectUrl: result.redirectUrl,
      welcomeMessage: result.welcomeMessage,
      warnings: result.warnings,
    });
  } catch (err) {
    if (err instanceof FormSubmitError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    console.error('submitForm error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ===========================================================================
// ADMIN — board-scoped management
// ===========================================================================

/** GET /api/boards/:id/forms (member) */
const listForms = async (req, res) => {
  try {
    const ctx = await loadBoardForMember(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const forms = await Form.find({ boardId: req.params.id }).sort({ createdAt: -1 });
    return res.json({ forms: forms.map(serializeForm) });
  } catch (err) {
    console.error('listForms error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/boards/:id/forms (admin) */
const createForm = async (req, res) => {
  try {
    const ctx = await loadBoardAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'name is required' });

    const form = await Form.create({
      boardId: ctx.board._id,
      name,
      fieldMap: sanitizeFieldMap(body.fieldMap),
      welcomeMessage: typeof body.welcomeMessage === 'string' ? body.welcomeMessage : '',
      postSubmitRedirectUrl: typeof body.postSubmitRedirectUrl === 'string' ? body.postSubmitRedirectUrl : '',
      captchaEnabled: body.captchaEnabled === true || body.captchaEnabled === 'true',
      enabled: body.enabled === undefined ? true : !!body.enabled,
      branding: sanitizeBranding(body.branding),
      sourceTag: typeof body.sourceTag === 'string' ? body.sourceTag.trim() : '',
      sourceColumnId: body.sourceColumnId ? String(body.sourceColumnId) : null,
    });
    return res.status(201).json({ form: serializeForm(form) });
  } catch (err) {
    console.error('createForm error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** Load a form + assert the caller is its board's workspace admin. */
const loadFormForAdmin = async (formId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(formId)) return { status: 404, error: 'Form not found' };
  const form = await Form.findById(formId);
  if (!form) return { status: 404, error: 'Form not found' };
  const ctx = await loadBoardAdmin(form.boardId, userId);
  if (ctx.error) return ctx;
  return { form, board: ctx.board };
};

/** GET /api/forms/:id (admin) — full form config, for the builder's edit mode. */
const getForm = async (req, res) => {
  try {
    const ctx = await loadFormForAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    return res.json({ form: serializeForm(ctx.form) });
  } catch (err) {
    console.error('getForm error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** PATCH /api/forms/:id (admin) */
const updateForm = async (req, res) => {
  try {
    const ctx = await loadFormForAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const { form } = ctx;
    const body = req.body || {};

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      form.name = name;
    }
    if (body.fieldMap !== undefined) form.fieldMap = sanitizeFieldMap(body.fieldMap);
    if (body.welcomeMessage !== undefined) form.welcomeMessage = String(body.welcomeMessage || '');
    if (body.postSubmitRedirectUrl !== undefined) form.postSubmitRedirectUrl = String(body.postSubmitRedirectUrl || '');
    if (body.captchaEnabled !== undefined) form.captchaEnabled = body.captchaEnabled === true || body.captchaEnabled === 'true';
    if (body.enabled !== undefined) form.enabled = !!body.enabled;
    if (body.branding !== undefined) form.branding = sanitizeBranding(body.branding);
    if (body.sourceTag !== undefined) form.sourceTag = String(body.sourceTag || '').trim();
    if (body.sourceColumnId !== undefined) form.sourceColumnId = body.sourceColumnId ? String(body.sourceColumnId) : null;

    await form.save();
    return res.json({ form: serializeForm(form) });
  } catch (err) {
    console.error('updateForm error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** DELETE /api/forms/:id (admin) → 204 */
const deleteForm = async (req, res) => {
  try {
    const ctx = await loadFormForAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    await ctx.form.deleteOne();
    return res.status(204).end();
  } catch (err) {
    console.error('deleteForm error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  renderForm,
  submitForm,
  listForms,
  getForm,
  createForm,
  updateForm,
  deleteForm,
};
