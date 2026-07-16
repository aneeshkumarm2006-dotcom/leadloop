/**
 * chartController.js — F13.4 chart widget CRUD + data endpoint.
 *
 * A `ChartWidget` is scoped to one board (`boardId`) or a whole workspace
 * (`workspaceId`, cross-board — F15). Reads are member-gated, writes admin-gated,
 * on the owning workspace. `GET /api/charts/:id/data` runs the widget through
 * `chartDataService.aggregate` — the single aggregation path also used by F15.
 */

const mongoose = require('mongoose');
const Board = require('../models/Board');
const Organisation = require('../models/Organisation');
const ChartWidget = require('../models/ChartWidget');
const { aggregate } = require('../services/chartDataService');

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

const isOrgMember = (org, userId) =>
  !!org && Array.isArray(org.members) && org.members.some((m) => m.toString() === userId);

/**
 * Resolve a widget's owning workspace from a `{ boardId? , workspaceId? }` scope.
 * Board scope derives the workspace from the board; always returns the
 * `workspaceId` to persist (so F15 workspace queries can find board widgets too).
 * Returns `{ workspaceId, boardId, org }` or `{ status, error }`.
 */
const resolveScope = async ({ boardId, workspaceId }) => {
  if (boardId) {
    if (!mongoose.Types.ObjectId.isValid(boardId)) return { status: 400, error: 'Invalid boardId' };
    const board = await Board.findById(boardId).select('organisation');
    if (!board) return { status: 404, error: 'Board not found' };
    const org = await Organisation.findById(board.organisation);
    if (!org) return { status: 404, error: 'Organisation not found' };
    return { boardId: board._id, workspaceId: board.organisation, org };
  }
  if (workspaceId) {
    if (!mongoose.Types.ObjectId.isValid(workspaceId)) return { status: 400, error: 'Invalid workspaceId' };
    const org = await Organisation.findById(workspaceId);
    if (!org) return { status: 404, error: 'Workspace not found' };
    return { boardId: null, workspaceId: org._id, org };
  }
  return { status: 400, error: 'boardId or workspaceId is required' };
};

const sanitizeQuery = (raw) => {
  const q = raw && typeof raw === 'object' ? raw : {};
  const out = {
    columnId: q.columnId ? String(q.columnId) : null,
    aggregate: ChartWidget.AGGREGATES.includes(q.aggregate) ? q.aggregate : 'count',
    aggregateColumnId: q.aggregateColumnId ? String(q.aggregateColumnId) : null,
    splitBy: q.splitBy ? String(q.splitBy) : null,
    timeBucket: ChartWidget.TIME_BUCKETS.includes(q.timeBucket) ? q.timeBucket : 'month',
    filter: Array.isArray(q.filter) ? q.filter : [],
  };
  return out;
};

const sanitizeLayout = (raw) => {
  const l = raw && typeof raw === 'object' ? raw : {};
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  return { x: num(l.x, 0), y: num(l.y, 0), w: num(l.w, 4), h: num(l.h, 4) };
};

const sanitizeVisibility = (v) =>
  ChartWidget.VISIBILITIES.includes(v) ? v : 'everyone';

const serialize = (w) => ({
  _id: w._id,
  boardId: w.boardId,
  workspaceId: w.workspaceId,
  type: w.type,
  title: w.title || '',
  query: w.query || {},
  layout: w.layout || {},
  visibility: w.visibility || 'everyone',
  createdAt: w.createdAt,
  updatedAt: w.updatedAt,
});

/** GET /api/charts?boardId=|workspaceId= (member) */
const list = async (req, res) => {
  try {
    const scope = await resolveScope({ boardId: req.query.boardId, workspaceId: req.query.workspaceId });
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    if (!isOrgMember(scope.org, req.user.userId)) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }
    const filter = scope.boardId ? { boardId: scope.boardId } : { workspaceId: scope.workspaceId, boardId: null };
    // Phase 2.4 — members never see admins-only widgets ($ne also matches the
    // legacy docs that predate the `visibility` field).
    if (!isOrgAdmin(scope.org, req.user.userId)) {
      filter.visibility = { $ne: 'admins' };
    }
    const widgets = await ChartWidget.find(filter).sort({ createdAt: 1 });
    return res.json({ charts: widgets.map(serialize) });
  } catch (err) {
    console.error('chart.list error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/charts (admin) */
const create = async (req, res) => {
  try {
    const body = req.body || {};
    if (!ChartWidget.TYPES.includes(body.type)) {
      return res.status(400).json({ error: `type must be one of ${ChartWidget.TYPES.join(', ')}` });
    }
    const scope = await resolveScope({ boardId: body.boardId, workspaceId: body.workspaceId });
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    if (!isOrgAdmin(scope.org, req.user.userId)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const widget = await ChartWidget.create({
      boardId: scope.boardId,
      workspaceId: scope.workspaceId,
      type: body.type,
      title: typeof body.title === 'string' ? body.title : '',
      query: sanitizeQuery(body.query),
      layout: sanitizeLayout(body.layout),
      visibility: sanitizeVisibility(body.visibility),
    });
    return res.status(201).json({ chart: serialize(widget) });
  } catch (err) {
    console.error('chart.create error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** Load a widget + its workspace org, asserting the requested access level. */
const loadWidget = async (widgetId, userId, { write }) => {
  if (!mongoose.Types.ObjectId.isValid(widgetId)) return { status: 404, error: 'Chart not found' };
  const widget = await ChartWidget.findById(widgetId);
  if (!widget) return { status: 404, error: 'Chart not found' };
  const org = await Organisation.findById(widget.workspaceId);
  if (!org) return { status: 404, error: 'Workspace not found' };
  if (write) {
    if (!isOrgAdmin(org, userId)) return { status: 403, error: 'Admin access required' };
  } else {
    if (!isOrgMember(org, userId)) {
      return { status: 403, error: 'Not a member of this workspace' };
    }
    // Phase 2.4 — admins-only widgets are invisible to plain members.
    if (widget.visibility === 'admins' && !isOrgAdmin(org, userId)) {
      return { status: 403, error: 'This widget is restricted to admins' };
    }
  }
  return { widget, org };
};

/** PATCH /api/charts/:id (admin) */
const update = async (req, res) => {
  try {
    const ctx = await loadWidget(req.params.id, req.user.userId, { write: true });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const { widget } = ctx;
    const body = req.body || {};

    if (body.type !== undefined) {
      if (!ChartWidget.TYPES.includes(body.type)) {
        return res.status(400).json({ error: `type must be one of ${ChartWidget.TYPES.join(', ')}` });
      }
      widget.type = body.type;
    }
    if (body.title !== undefined) widget.title = String(body.title || '');
    if (body.query !== undefined) widget.query = sanitizeQuery(body.query);
    if (body.layout !== undefined) widget.layout = sanitizeLayout(body.layout);
    if (body.visibility !== undefined) widget.visibility = sanitizeVisibility(body.visibility);

    await widget.save();
    return res.json({ chart: serialize(widget) });
  } catch (err) {
    console.error('chart.update error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** DELETE /api/charts/:id (admin) → 204 */
const remove = async (req, res) => {
  try {
    const ctx = await loadWidget(req.params.id, req.user.userId, { write: true });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    await ctx.widget.deleteOne();
    return res.status(204).end();
  } catch (err) {
    console.error('chart.remove error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** GET /api/charts/:id/data?from=&to= (member) → aggregated series. */
const data = async (req, res) => {
  try {
    const ctx = await loadWidget(req.params.id, req.user.userId, { write: false });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const series = await aggregate(ctx.widget, { from: req.query.from, to: req.query.to });
    return res.json({ data: series });
  } catch (err) {
    console.error('chart.data error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { list, create, update, remove, data };
