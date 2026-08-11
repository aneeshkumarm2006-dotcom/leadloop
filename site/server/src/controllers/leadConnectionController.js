/**
 * leadConnectionController.js — F14 lead-connection HTTP handlers.
 *
 * One PUBLIC handler (`ingest`) mounted without auth (see the PUBLIC ROUTE
 * ALLOWLIST in app.js), plus authed board-scoped management. The admin gate
 * mirrors the F7/F13 controllers: org membership for reads, org admin for writes.
 *
 * The plaintext API key is returned exactly ONCE — from `createConnection` and
 * `rotateKey`. Every other response carries only the non-secret `keyId` +
 * `tokenLast4` for display; the key itself is never stored (only its sha256).
 */

const mongoose = require('mongoose');
const Board = require('../models/Board');
const Organisation = require('../models/Organisation');
const LeadConnection = require('../models/LeadConnection');
const LeadIngestLog = require('../models/LeadIngestLog');
const TaskGroup = require('../models/TaskGroup');
const { ingestLead, LeadIngestError } = require('../services/leadIngestService');
const { isValidSourceType, DEFAULT_SOURCE } = require('../services/sourceAdapters');
const { publicBaseUrl } = require('../utils/publicBaseUrl');

/**
 * Validate a requested landing group for a board. Returns the group's ObjectId
 * when `raw` is a real group ON THIS BOARD, or null (fall back to first group)
 * when unset. Throws { status, error } on a malformed / foreign group so a
 * connection can never point leads at another board's stage.
 */
const resolveLandingGroup = async (raw, boardId) => {
  if (raw === undefined || raw === null || raw === '') return null;
  if (!mongoose.Types.ObjectId.isValid(raw)) throw { status: 400, error: 'Invalid landing stage' };
  const grp = await TaskGroup.findOne({ _id: raw, board: boardId }).select('_id');
  if (!grp) throw { status: 400, error: 'Landing stage is not on this board' };
  return grp._id;
};

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

const isOrgMember = (org, userId) =>
  !!org && Array.isArray(org.members) && org.members.some((m) => m.toString() === userId);

// The ingest endpoint is a server API (not the React app), so its URL is built
// from the server base — same source the F7 inbound webhook URL uses.

/** Load board + org for a member (read). */
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

/** Load a connection + assert the caller is its board's workspace admin. */
const loadConnectionForAdmin = async (connectionId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(connectionId)) return { status: 404, error: 'Connection not found' };
  const connection = await LeadConnection.findById(connectionId);
  if (!connection) return { status: 404, error: 'Connection not found' };
  const ctx = await loadBoardAdmin(connection.boardId, userId);
  if (ctx.error) return ctx;
  return { connection, board: ctx.board };
};

/**
 * Non-secret connection shape for admin responses. Never includes the key.
 * `req` is threaded through only to resolve the public origin of `ingestUrl` —
 * the customer pastes that URL into Facebook / Zapier, so it has to be the
 * deployed origin and not `localhost`.
 */
const serializeConnection = (c, req) => ({
  _id: c._id,
  boardId: c.boardId,
  name: c.name,
  keyId: c.keyId,
  tokenLast4: c.tokenLast4 || '',
  enabled: !!c.enabled,
  sourceType: c.sourceType || DEFAULT_SOURCE,
  landingGroupId: c.landingGroupId || null,
  attributeSource: !!c.attributeSource,
  sourceTag: c.sourceTag || '',
  schemaLocked: !!c.schemaLocked,
  evolveSchema: c.evolveSchema !== false,
  fields: (c.fieldMap || []).map((f) => ({
    sourceKey: f.sourceKey,
    label: f.label,
    type: f.type,
    columnKey: f.columnKey,
  })),
  submissionCount: c.submissionCount || 0,
  lastSubmissionAt: c.lastSubmissionAt || null,
  ingestUrl: `${publicBaseUrl(req)}/api/leads/ingest`,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

// ===========================================================================
// PUBLIC — ingest
// ===========================================================================

/**
 * Read the key from `X-API-Key`, then `Authorization: Bearer …`, then the URL
 * (`/api/leads/in/:key` param or `?key=`). The URL forms exist for platforms
 * that only let you paste a destination URL and can't set an auth header —
 * Google Ads Lead Forms, Facebook, most portal/Zapier webhooks.
 */
const extractApiKey = (req) => {
  const header = req.get('x-api-key');
  if (header) return header.trim();
  const auth = req.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  if (req.params && req.params.key) return String(req.params.key).trim();
  if (req.query && req.query.key) return String(req.query.key).trim();
  return '';
};

/** A valid absolute http(s) URL, else null — the only shape `_redirect` honours. */
const safeRedirectUrl = (raw) => {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
};

/**
 * POST /api/leads/ingest (public, rate-limited, body ≤ 256KB).
 * Auth by API key header. Body is the lead's fields (or `{ payload: {...} }`) —
 * JSON or classic urlencoded form posts both parse (see the route).
 *
 * `_redirect` / `redirect`: when the body carries a valid http(s) URL under
 * either key AND the submission succeeds, respond `303 See Other` to it instead
 * of JSON — this is what makes a zero-JS `<form method="POST" action=…>` give
 * the visitor a thank-you page. Both keys are already excluded from schema
 * inference (`_`-prefix rule / IGNORED_KEYS), so they never become columns.
 * Errors always stay JSON.
 */
const ingest = async (req, res) => {
  try {
    const apiKey = extractApiKey(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    // Accept a bare payload OR a `{ payload: {...} }` envelope (parity with the
    // form-submit route), so both integration styles just work.
    const payload =
      body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload
        : body;
    const redirectTo =
      safeRedirectUrl(body._redirect) ||
      safeRedirectUrl(body.redirect) ||
      safeRedirectUrl(payload._redirect) ||
      safeRedirectUrl(payload.redirect);
    const result = await ingestLead(apiKey, payload, {
      ip: req.ip || (req.socket && req.socket.remoteAddress) || '',
      userAgent: req.headers['user-agent'] || '',
    });
    if (redirectTo) return res.redirect(303, redirectTo);
    return res.status(201).json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof LeadIngestError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    console.error('lead ingest error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ===========================================================================
// ADMIN — board-scoped management
// ===========================================================================

/** GET /api/boards/:id/lead-connections (member) */
const listConnections = async (req, res) => {
  try {
    const ctx = await loadBoardForMember(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const connections = await LeadConnection.find({ boardId: req.params.id }).sort({ createdAt: -1 });
    return res.json({ connections: connections.map((c) => serializeConnection(c, req)) });
  } catch (err) {
    console.error('listConnections error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /api/boards/:id/lead-connections (admin). Returns the plaintext `apiKey`
 * ONCE — it is never retrievable again (only its hash is stored).
 */
const createConnection = async (req, res) => {
  try {
    const ctx = await loadBoardAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const body = req.body || {};
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Website form';
    const sourceType = isValidSourceType(body.sourceType) ? body.sourceType : DEFAULT_SOURCE;
    const landingGroupId = await resolveLandingGroup(body.landingGroupId, ctx.board._id);

    const { apiKey, keyId, tokenHash, tokenLast4 } = LeadConnection.generateApiKey();
    const connection = await LeadConnection.create({
      boardId: ctx.board._id,
      name,
      keyId,
      tokenHash,
      tokenLast4,
      sourceType,
      landingGroupId,
      attributeSource: body.attributeSource === undefined ? true : !!body.attributeSource,
      sourceTag: typeof body.sourceTag === 'string' ? body.sourceTag.trim() : '',
      createdBy: req.user.userId,
    });
    return res.status(201).json({ connection: serializeConnection(connection, req), apiKey });
  } catch (err) {
    if (err && err.status && err.error) return res.status(err.status).json({ error: err.error });
    console.error('createConnection error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/lead-connections/:cid/rotate (admin) — new key, returned once. */
const rotateKey = async (req, res) => {
  try {
    const ctx = await loadConnectionForAdmin(req.params.cid, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const { apiKey, keyId, tokenHash, tokenLast4 } = LeadConnection.generateApiKey();
    ctx.connection.keyId = keyId;
    ctx.connection.tokenHash = tokenHash;
    ctx.connection.tokenLast4 = tokenLast4;
    await ctx.connection.save();
    return res.json({ connection: serializeConnection(ctx.connection, req), apiKey });
  } catch (err) {
    console.error('rotateKey error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** PATCH /api/lead-connections/:cid (admin) — name / enabled / source config. */
const updateConnection = async (req, res) => {
  try {
    const ctx = await loadConnectionForAdmin(req.params.cid, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const { connection } = ctx;
    const body = req.body || {};

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      connection.name = name;
    }
    if (body.enabled !== undefined) connection.enabled = !!body.enabled;
    if (body.attributeSource !== undefined) connection.attributeSource = !!body.attributeSource;
    if (body.sourceTag !== undefined) connection.sourceTag = String(body.sourceTag || '').trim();
    if (body.evolveSchema !== undefined) connection.evolveSchema = !!body.evolveSchema;
    if (body.sourceType !== undefined && isValidSourceType(body.sourceType)) {
      connection.sourceType = body.sourceType;
    }
    if (body.landingGroupId !== undefined) {
      connection.landingGroupId = await resolveLandingGroup(body.landingGroupId, connection.boardId);
    }

    await connection.save();
    return res.json({ connection: serializeConnection(connection, req) });
  } catch (err) {
    if (err && err.status && err.error) return res.status(err.status).json({ error: err.error });
    console.error('updateConnection error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /api/lead-connections/:cid/reset-schema (admin). Clears the locked schema
 * so the NEXT submission re-defines the columns — used when the website form's
 * fields change. Existing board columns are left untouched (not destructive).
 */
const resetSchema = async (req, res) => {
  try {
    const ctx = await loadConnectionForAdmin(req.params.cid, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    ctx.connection.fieldMap = [];
    ctx.connection.schemaLocked = false;
    await ctx.connection.save();
    return res.json({ connection: serializeConnection(ctx.connection, req) });
  } catch (err) {
    console.error('resetSchema error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** DELETE /api/lead-connections/:cid (admin) → 204. */
const deleteConnection = async (req, res) => {
  try {
    const ctx = await loadConnectionForAdmin(req.params.cid, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    await ctx.connection.deleteOne();
    await LeadIngestLog.deleteMany({ connectionId: req.params.cid }).catch(() => {});
    return res.status(204).end();
  } catch (err) {
    console.error('deleteConnection error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** GET /api/lead-connections/:cid/submissions?limit=50 (member) — recent log. */
const listSubmissions = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.cid)) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    const connection = await LeadConnection.findById(req.params.cid);
    if (!connection) return res.status(404).json({ error: 'Connection not found' });
    const ctx = await loadBoardForMember(connection.boardId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const rows = await LeadIngestLog.find({ connectionId: connection._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ submissions: rows });
  } catch (err) {
    console.error('listSubmissions error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET /api/lead-connections?org=:orgId (member) — every lead connection across
 * the workspace's boards, for the Lead-Sources hub. The board name is joined in
 * so the hub can show "→ Board" without an extra round-trip per row.
 */
const listOrgConnections = async (req, res) => {
  try {
    const orgId = req.query.org;
    if (!mongoose.Types.ObjectId.isValid(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const org = await Organisation.findById(orgId);
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    if (!isOrgMember(org, req.user.userId)) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }
    const boards = await Board.find({ organisation: orgId }).select('_id name');
    const boardMap = new Map(boards.map((b) => [b._id.toString(), b.name]));
    const connections = await LeadConnection.find({
      boardId: { $in: boards.map((b) => b._id) },
    }).sort({ createdAt: -1 });
    return res.json({
      connections: connections.map((c) => ({
        ...serializeConnection(c, req),
        boardName: boardMap.get(c.boardId.toString()) || '',
      })),
    });
  } catch (err) {
    console.error('listOrgConnections error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  ingest,
  listConnections,
  listOrgConnections,
  createConnection,
  rotateKey,
  updateConnection,
  resetSchema,
  deleteConnection,
  listSubmissions,
};
