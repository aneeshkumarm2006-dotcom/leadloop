/**
 * savedViewController.js — F13.4 saved table views (per-user board table config).
 *
 * Reads/creates are member-gated on the board's workspace; updates/deletes are
 * owner-only (a saved view is personal — there's no shared variant like the F12
 * calendar view). Persists the table's filter / group-by / sort / column
 * visibility so a user's layout survives across sessions (AC4).
 */

const mongoose = require('mongoose');
const Board = require('../models/Board');
const Organisation = require('../models/Organisation');
const SavedTableView = require('../models/SavedTableView');

const isOrgMember = (org, userId) =>
  !!org && Array.isArray(org.members) && org.members.some((m) => m.toString() === userId);

const normalizeSort = (raw) =>
  Array.isArray(raw)
    ? raw
        .filter((s) => s && s.columnId)
        .map((s) => ({ columnId: String(s.columnId), dir: s.dir === 'desc' ? 'desc' : 'asc' }))
    : [];

const serialize = (v) => ({
  _id: v._id,
  userId: v.userId,
  boardId: v.boardId,
  name: v.name,
  filter: Array.isArray(v.filter) ? v.filter : [],
  groupBy: v.groupBy || null,
  sort: Array.isArray(v.sort) ? v.sort : [],
  visibleColumnIds: Array.isArray(v.visibleColumnIds) ? v.visibleColumnIds : [],
  createdAt: v.createdAt,
  updatedAt: v.updatedAt,
});

/** Load board + org for a member. Returns `{ board, org }` or `{ status, error }`. */
const loadBoardForMember = async (boardId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(boardId)) return { status: 400, error: 'Invalid board id' };
  const board = await Board.findById(boardId).select('organisation');
  if (!board) return { status: 404, error: 'Board not found' };
  const org = await Organisation.findById(board.organisation);
  if (!org) return { status: 404, error: 'Organisation not found' };
  if (!isOrgMember(org, userId)) return { status: 403, error: 'Not a member of this workspace' };
  return { board, org };
};

/** GET /api/boards/:id/saved-views (member) — the caller's own views for the board. */
const list = async (req, res) => {
  try {
    const userId = req.user.userId;
    const ctx = await loadBoardForMember(req.params.id, userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const views = await SavedTableView.find({ userId, boardId: req.params.id }).sort({ createdAt: 1 });
    return res.json({ views: views.map(serialize) });
  } catch (err) {
    console.error('savedView.list error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/boards/:id/saved-views (member) */
const create = async (req, res) => {
  try {
    const userId = req.user.userId;
    const ctx = await loadBoardForMember(req.params.id, userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'name is required' });

    const view = await SavedTableView.create({
      userId,
      boardId: req.params.id,
      name,
      filter: Array.isArray(body.filter) ? body.filter : [],
      groupBy: body.groupBy ? String(body.groupBy) : null,
      sort: normalizeSort(body.sort),
      visibleColumnIds: Array.isArray(body.visibleColumnIds) ? body.visibleColumnIds.map(String) : [],
    });
    return res.status(201).json({ view: serialize(view) });
  } catch (err) {
    console.error('savedView.create error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** Load a view asserting the caller owns it. */
const loadOwnView = async (viewId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(viewId)) return { status: 404, error: 'View not found' };
  const view = await SavedTableView.findById(viewId);
  if (!view) return { status: 404, error: 'View not found' };
  if (view.userId.toString() !== userId) return { status: 403, error: 'Only the owner can edit this view' };
  return { view };
};

/** PATCH /api/saved-views/:id (owner) */
const update = async (req, res) => {
  try {
    const ctx = await loadOwnView(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const { view } = ctx;
    const body = req.body || {};

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      view.name = name;
    }
    if (body.filter !== undefined) view.filter = Array.isArray(body.filter) ? body.filter : [];
    if (body.groupBy !== undefined) view.groupBy = body.groupBy ? String(body.groupBy) : null;
    if (body.sort !== undefined) view.sort = normalizeSort(body.sort);
    if (body.visibleColumnIds !== undefined) {
      view.visibleColumnIds = Array.isArray(body.visibleColumnIds) ? body.visibleColumnIds.map(String) : [];
    }

    await view.save();
    return res.json({ view: serialize(view) });
  } catch (err) {
    console.error('savedView.update error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** DELETE /api/saved-views/:id (owner) → 204 */
const remove = async (req, res) => {
  try {
    const ctx = await loadOwnView(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    await ctx.view.deleteOne();
    return res.status(204).end();
  } catch (err) {
    console.error('savedView.remove error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { list, create, update, remove };
