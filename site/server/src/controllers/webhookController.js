/**
 * webhookController.js — webhook HTTP handlers (Phase 3, F7.6).
 *
 * One public handler (`receiveInbound`) and five admin, board-scoped handlers
 * for managing endpoints + reading the delivery log. The public route is mounted
 * without `authMiddleware` (allowlist in app.js); the admin routes mount under
 * the authed `/api` surface and enforce board-admin access here.
 */

const mongoose = require('mongoose');
const Board = require('../models/Board');
const Organisation = require('../models/Organisation');
const WebhookEndpoint = require('../models/WebhookEndpoint');
const WebhookDelivery = require('../models/WebhookDelivery');
const { resolveInbound, WebhookResolveError } = require('../services/webhookInboundResolver');
const { dispatch } = require('../services/webhookDispatcher');
const { applyMapping } = require('../services/webhookInboundResolver');

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

/** Load board + org, asserting the caller is the board's workspace admin. */
const loadBoardAdmin = async (boardId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(boardId)) {
    return { status: 400, error: 'Invalid board id' };
  }
  const board = await Board.findById(boardId);
  if (!board) return { status: 404, error: 'Board not found' };
  const org = await Organisation.findById(board.organisation);
  if (!org) return { status: 404, error: 'Organisation not found' };
  const isMember = org.members.some((m) => m.toString() === userId);
  if (!isMember) return { status: 403, error: 'Not a member of this organisation' };
  if (!isOrgAdmin(org, userId)) return { status: 403, error: 'Admin access required' };
  return { board, org };
};

const PUBLIC_BASE_URL = () =>
  process.env.WEBHOOK_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

/**
 * Serialise an endpoint for an admin response. The `secret` is included (admins
 * need it to configure the receiving system / verify signatures); the public
 * `inboundUrl` is composed for inbound endpoints.
 */
const serializeEndpoint = (ep) => {
  const base = {
    _id: ep._id,
    boardId: ep.boardId,
    direction: ep.direction,
    secret: ep.secret,
    enabled: ep.enabled,
    createdBy: ep.createdBy,
    createdAt: ep.createdAt,
  };
  if (ep.direction === 'in') {
    base.token = ep.token;
    base.mapping = ep.mapping || {};
    base.inboundUrl = `${PUBLIC_BASE_URL()}/api/webhooks/in/${ep.token}`;
  } else {
    base.url = ep.url;
    base.eventTypes = ep.eventTypes || [];
  }
  return base;
};

const isHttpUrl = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/** Validate a `{ [columnId]: jsonPath }` mapping shape against the board. */
const sanitizeMapping = (board, raw) => {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const known = new Set((board.columns || []).map((c) => c._id.toString()));
  const out = {};
  for (const [cid, path] of Object.entries(raw)) {
    if (typeof path !== 'string' || !path.trim()) return null;
    // Unknown column ids are dropped (a deleted column shouldn't break the map).
    if (known.size > 0 && !known.has(String(cid))) continue;
    out[String(cid)] = path.trim();
  }
  return out;
};

// ===========================================================================
// PUBLIC — inbound ingress
// ===========================================================================
/**
 * POST /api/webhooks/in/:token (public, rate-limited, body ≤ 256KB).
 * Maps the JSON body onto a new task and returns 201 { taskId }.
 */
const receiveInbound = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await resolveInbound(req.params.token, body);
    return res.status(201).json({ taskId: result.taskId, warnings: result.warnings });
  } catch (err) {
    if (err instanceof WebhookResolveError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('receiveInbound error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ===========================================================================
// ADMIN — board-scoped management
// ===========================================================================
/** GET /api/boards/:id/webhooks */
const listEndpoints = async (req, res) => {
  try {
    const ctx = await loadBoardAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const endpoints = await WebhookEndpoint.find({ boardId: req.params.id }).sort({ createdAt: -1 });
    return res.json({ endpoints: endpoints.map(serializeEndpoint) });
  } catch (err) {
    console.error('listEndpoints error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/boards/:id/webhooks  body { direction, url?, mapping?, eventTypes? } */
const createEndpoint = async (req, res) => {
  try {
    const ctx = await loadBoardAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const { direction, url, mapping, eventTypes } = req.body || {};
    if (direction !== 'in' && direction !== 'out') {
      return res.status(400).json({ error: "direction must be 'in' or 'out'" });
    }

    const doc = {
      boardId: ctx.board._id,
      direction,
      createdBy: req.user.userId,
    };

    if (direction === 'out') {
      if (!url || !isHttpUrl(url)) {
        return res.status(400).json({ error: 'Outbound endpoint requires a valid http(s) url' });
      }
      doc.url = url.trim();
      doc.eventTypes = Array.isArray(eventTypes) ? eventTypes.map(String).filter(Boolean) : [];
    } else {
      const sanitized = sanitizeMapping(ctx.board, mapping);
      if (sanitized === null) {
        return res.status(400).json({ error: 'mapping must be an object of { columnId: jsonPath }' });
      }
      doc.mapping = sanitized;
    }

    const endpoint = await WebhookEndpoint.create(doc);
    return res.status(201).json({ endpoint: serializeEndpoint(endpoint) });
  } catch (err) {
    console.error('createEndpoint error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * PUT /api/boards/:id/webhooks/:wid — update mapping / url / eventTypes / enabled.
 * (Not in the original six but needed by the mapping editor to persist changes.)
 */
const updateEndpoint = async (req, res) => {
  try {
    const ctx = await loadBoardAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const endpoint = await WebhookEndpoint.findOne({ _id: req.params.wid, boardId: req.params.id });
    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

    const { mapping, url, eventTypes, enabled } = req.body || {};
    if (enabled !== undefined) endpoint.enabled = !!enabled;

    if (endpoint.direction === 'in' && mapping !== undefined) {
      const sanitized = sanitizeMapping(ctx.board, mapping);
      if (sanitized === null) {
        return res.status(400).json({ error: 'mapping must be an object of { columnId: jsonPath }' });
      }
      endpoint.mapping = sanitized;
    }
    if (endpoint.direction === 'out') {
      if (url !== undefined) {
        if (!isHttpUrl(url)) return res.status(400).json({ error: 'Invalid http(s) url' });
        endpoint.url = String(url).trim();
      }
      if (eventTypes !== undefined) {
        endpoint.eventTypes = Array.isArray(eventTypes) ? eventTypes.map(String).filter(Boolean) : [];
      }
    }

    await endpoint.save();
    return res.json({ endpoint: serializeEndpoint(endpoint) });
  } catch (err) {
    console.error('updateEndpoint error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** DELETE /api/boards/:id/webhooks/:wid → 204 */
const deleteEndpoint = async (req, res) => {
  try {
    const ctx = await loadBoardAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const deleted = await WebhookEndpoint.findOneAndDelete({
      _id: req.params.wid,
      boardId: req.params.id,
    });
    if (!deleted) return res.status(404).json({ error: 'Endpoint not found' });
    // Drop the delivery history for the removed endpoint.
    await WebhookDelivery.deleteMany({ endpointId: req.params.wid }).catch(() => {});
    return res.status(204).end();
  } catch (err) {
    console.error('deleteEndpoint error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /api/boards/:id/webhooks/:wid/test — synthetic delivery.
 *   - outbound: dispatch a synthetic envelope and return the delivery row.
 *   - inbound:  dry-run the mapping against `req.body.sample` (no task created),
 *               returning the resolved column values + any missing paths (AC5).
 */
const testEndpoint = async (req, res) => {
  try {
    const ctx = await loadBoardAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const endpoint = await WebhookEndpoint.findOne({ _id: req.params.wid, boardId: req.params.id });
    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

    if (endpoint.direction === 'out') {
      const envelope = {
        event: 'TEST',
        taskSnapshot: { id: null, name: 'Test webhook', columnValues: {} },
        board: { id: String(ctx.board._id), name: ctx.board.name },
        workspace: { id: String(ctx.board.organisation) },
        timestamp: new Date().toISOString(),
      };
      const delivery = await dispatch(endpoint, envelope);
      return res.json({
        direction: 'out',
        delivery: {
          _id: delivery._id,
          status: delivery.status,
          attempt: delivery.attempt,
          response: delivery.response,
          nextRetryAt: delivery.nextRetryAt,
        },
      });
    }

    // inbound dry-run
    const sample = req.body && typeof req.body.sample === 'object' ? req.body.sample : {};
    const { columnValues, missing } = applyMapping(endpoint.mapping, sample);
    return res.json({ direction: 'in', columnValues, missing });
  } catch (err) {
    console.error('testEndpoint error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** GET /api/boards/:id/webhooks/:wid/deliveries?limit=50 */
const listDeliveries = async (req, res) => {
  try {
    const ctx = await loadBoardAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const endpoint = await WebhookEndpoint.findOne({ _id: req.params.wid, boardId: req.params.id });
    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const deliveries = await WebhookDelivery.find({ endpointId: endpoint._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ deliveries });
  } catch (err) {
    console.error('listDeliveries error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  receiveInbound,
  listEndpoints,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  testEndpoint,
  listDeliveries,
};
