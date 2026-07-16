const mongoose = require('mongoose');
const Board = require('../models/Board');
const Task = require('../models/Task');
const Organisation = require('../models/Organisation');
const CalendarView = require('../models/CalendarView');
const { matchesFilter } = require('../utils/columnFilter');
const { userHasResourceAccess } = require('../middleware/roleCheck');

/**
 * calendarViewController — CRUD + the normalized `events` builder for the
 * saved-per-user calendar views (Phase 4, F12.3).
 *
 * Routes (all authed, mounted under /api):
 *   GET    /api/calendar-views?workspaceId=        list (own + shared)
 *   POST   /api/calendar-views                     create (member)
 *   PATCH  /api/calendar-views/:id                 update (owner | admin-if-shared)
 *   DELETE /api/calendar-views/:id                 remove (owner | admin-if-shared) → 204
 *   GET    /api/calendar-views/:id/events?from=&to= events (F3 access check)
 */

const SOURCE_TYPES = ['date', 'timeline'];
const COLOR_TYPES = ['status', 'dropdown', 'tags', 'person'];
const RESOURCE_TYPES = ['status', 'dropdown', 'tags', 'person'];

const DEFAULT_COLOR = '#6B7280';
// Deterministic per-user palette for `person` color-by (no option colours).
const PERSON_PALETTE = [
  '#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED',
  '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#0D9488',
];

const isOrgAdmin = (org, userId) =>
  !!org &&
  (
    (org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId))
  );

const isOrgMember = (org, userId) =>
  !!org && Array.isArray(org.members) && org.members.some((m) => m.toString() === userId);

const personColor = (userId) => {
  const s = (userId == null ? '' : userId).toString();
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PERSON_PALETTE[h % PERSON_PALETTE.length];
};

/** Find a column subdoc on a board by its id-string. Returns null if absent. */
const findColumn = (board, columnId) => {
  if (!columnId || !board || !Array.isArray(board.columns)) return null;
  const target = columnId.toString();
  return board.columns.find((c) => c._id.toString() === target) || null;
};

/** A representation-agnostic read off a (possibly lean) task. */
const readValue = (task, columnId) => {
  const cv = task && task.columnValues;
  if (!cv || columnId == null) return undefined;
  const key = columnId.toString();
  if (typeof cv.get === 'function') return cv.get(key);
  return cv[key];
};

const serialize = (v) => ({
  _id: v._id,
  userId: v.userId,
  workspaceId: v.workspaceId,
  boardId: v.boardId,
  name: v.name,
  sourceColumnId: v.sourceColumnId,
  colorByColumnId: v.colorByColumnId,
  filter: Array.isArray(v.filter) ? v.filter : [],
  layout: v.layout,
  resourceColumnId: v.resourceColumnId,
  isShared: !!v.isShared,
  sortOrder: v.sortOrder || 0,
  createdAt: v.createdAt,
  updatedAt: v.updatedAt,
});

/**
 * Validate that the chosen source/color/resource columns exist on the board and
 * are of the right type. Returns `{ error }` or `{ ok: true }`. A null/empty id
 * for an optional column passes. Only called for board-scoped views.
 */
const validateColumnsForBoard = (board, { sourceColumnId, colorByColumnId, resourceColumnId, layout }) => {
  if (sourceColumnId) {
    const col = findColumn(board, sourceColumnId);
    if (!col) return { error: 'sourceColumnId is not a column on this board' };
    if (!SOURCE_TYPES.includes(col.type)) {
      return { error: `Source column must be a date or timeline column (got ${col.type})` };
    }
  }
  if (colorByColumnId) {
    const col = findColumn(board, colorByColumnId);
    if (!col) return { error: 'colorByColumnId is not a column on this board' };
    if (!COLOR_TYPES.includes(col.type)) {
      return { error: `Color-by column must be status/dropdown/tags/person (got ${col.type})` };
    }
  }
  if (resourceColumnId) {
    const col = findColumn(board, resourceColumnId);
    if (!col) return { error: 'resourceColumnId is not a column on this board' };
    if (!RESOURCE_TYPES.includes(col.type)) {
      return { error: `Resource column must be status/dropdown/tags/person (got ${col.type})` };
    }
  }
  if (layout === 'resource' && !resourceColumnId) {
    return { error: 'A resource layout requires a resourceColumnId' };
  }
  return { ok: true };
};

// ---------------------------------------------------------------------------
// list — GET /api/calendar-views?workspaceId=
// ---------------------------------------------------------------------------
const list = async (req, res) => {
  try {
    const userId = req.user.userId;
    const workspaceId = req.query.workspaceId;
    if (!workspaceId || !mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'workspaceId query param is required' });
    }
    const org = await Organisation.findById(workspaceId);
    if (!org) return res.status(404).json({ error: 'Workspace not found' });
    if (!isOrgMember(org, userId)) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const views = await CalendarView.find({
      workspaceId,
      $or: [{ userId }, { isShared: true }],
    }).sort({ sortOrder: 1, createdAt: 1 });

    return res.json({ views: views.map(serialize) });
  } catch (err) {
    console.error('calendarView.list error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// create — POST /api/calendar-views (member)
// ---------------------------------------------------------------------------
const create = async (req, res) => {
  try {
    const userId = req.user.userId;
    const body = req.body || {};
    const workspaceId = body.workspaceId;

    if (!workspaceId || !mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'name is required' });

    const org = await Organisation.findById(workspaceId);
    if (!org) return res.status(404).json({ error: 'Workspace not found' });
    if (!isOrgMember(org, userId)) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const layout = body.layout || 'month';
    if (!CalendarView.LAYOUTS.includes(layout)) {
      return res.status(400).json({ error: `layout must be one of ${CalendarView.LAYOUTS.join(', ')}` });
    }

    let boardId = null;
    if (body.boardId) {
      if (!mongoose.Types.ObjectId.isValid(body.boardId)) {
        return res.status(400).json({ error: 'Invalid boardId' });
      }
      const board = await Board.findById(body.boardId);
      if (!board) return res.status(404).json({ error: 'Board not found' });
      if (board.organisation.toString() !== workspaceId.toString()) {
        return res.status(400).json({ error: 'Board does not belong to this workspace' });
      }
      const check = validateColumnsForBoard(board, {
        sourceColumnId: body.sourceColumnId,
        colorByColumnId: body.colorByColumnId,
        resourceColumnId: body.resourceColumnId,
        layout,
      });
      if (check.error) return res.status(400).json({ error: check.error });
      boardId = board._id;
    } else if (layout === 'resource') {
      return res.status(400).json({ error: 'A resource layout requires a boardId + resourceColumnId' });
    }

    const view = await CalendarView.create({
      userId,
      workspaceId,
      boardId,
      name,
      sourceColumnId: body.sourceColumnId || null,
      colorByColumnId: body.colorByColumnId || null,
      filter: Array.isArray(body.filter) ? body.filter : [],
      layout,
      resourceColumnId: body.resourceColumnId || null,
      isShared: body.isShared === true || body.isShared === 'true',
      sortOrder: Number.isFinite(body.sortOrder) ? body.sortOrder : 0,
    });

    return res.status(201).json({ view: serialize(view) });
  } catch (err) {
    console.error('calendarView.create error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Load a view + its workspace, and resolve whether `userId` may mutate it.
 * Owner can always edit; a workspace admin can edit a SHARED view.
 */
const loadViewForMutation = async (viewId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(viewId)) return { status: 404, error: 'View not found' };
  const view = await CalendarView.findById(viewId);
  if (!view) return { status: 404, error: 'View not found' };
  const org = await Organisation.findById(view.workspaceId);
  const isOwner = view.userId.toString() === userId;
  const canEdit = isOwner || (view.isShared && isOrgAdmin(org, userId));
  if (!canEdit) {
    return { status: 403, error: 'Only the owner (or a workspace admin for shared views) can edit this view' };
  }
  return { view, org };
};

// ---------------------------------------------------------------------------
// update — PATCH /api/calendar-views/:id (owner | admin-if-shared)
// ---------------------------------------------------------------------------
const update = async (req, res) => {
  try {
    const userId = req.user.userId;
    const ctx = await loadViewForMutation(req.params.id, userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const { view } = ctx;
    const body = req.body || {};

    // Resolve the effective board (existing or changed) so column edits validate.
    let board = null;
    let nextBoardId = view.boardId;
    if (body.boardId !== undefined) {
      if (body.boardId === null || body.boardId === '') {
        nextBoardId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(body.boardId)) {
          return res.status(400).json({ error: 'Invalid boardId' });
        }
        board = await Board.findById(body.boardId);
        if (!board) return res.status(404).json({ error: 'Board not found' });
        if (board.organisation.toString() !== view.workspaceId.toString()) {
          return res.status(400).json({ error: 'Board does not belong to this workspace' });
        }
        nextBoardId = board._id;
      }
    } else if (view.boardId) {
      board = await Board.findById(view.boardId);
    }

    const nextLayout = body.layout !== undefined ? body.layout : view.layout;
    if (!CalendarView.LAYOUTS.includes(nextLayout)) {
      return res.status(400).json({ error: `layout must be one of ${CalendarView.LAYOUTS.join(', ')}` });
    }

    // Compute the effective column ids after the patch, then validate together.
    const nextCols = {
      sourceColumnId: body.sourceColumnId !== undefined ? body.sourceColumnId : view.sourceColumnId,
      colorByColumnId: body.colorByColumnId !== undefined ? body.colorByColumnId : view.colorByColumnId,
      resourceColumnId: body.resourceColumnId !== undefined ? body.resourceColumnId : view.resourceColumnId,
      layout: nextLayout,
    };
    if (nextBoardId && board) {
      const check = validateColumnsForBoard(board, nextCols);
      if (check.error) return res.status(400).json({ error: check.error });
    } else if (nextLayout === 'resource') {
      return res.status(400).json({ error: 'A resource layout requires a boardId + resourceColumnId' });
    }

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      view.name = name;
    }
    view.boardId = nextBoardId;
    view.layout = nextLayout;
    if (body.sourceColumnId !== undefined) view.sourceColumnId = body.sourceColumnId || null;
    if (body.colorByColumnId !== undefined) view.colorByColumnId = body.colorByColumnId || null;
    if (body.resourceColumnId !== undefined) view.resourceColumnId = body.resourceColumnId || null;
    if (body.filter !== undefined) view.filter = Array.isArray(body.filter) ? body.filter : [];
    if (body.isShared !== undefined) view.isShared = body.isShared === true || body.isShared === 'true';
    if (body.sortOrder !== undefined && Number.isFinite(body.sortOrder)) view.sortOrder = body.sortOrder;

    await view.save();
    return res.json({ view: serialize(view) });
  } catch (err) {
    console.error('calendarView.update error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// remove — DELETE /api/calendar-views/:id → 204 (owner | admin-if-shared)
// ---------------------------------------------------------------------------
const remove = async (req, res) => {
  try {
    const userId = req.user.userId;
    const ctx = await loadViewForMutation(req.params.id, userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    await ctx.view.deleteOne();
    return res.status(204).end();
  } catch (err) {
    console.error('calendarView.remove error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Resolve an event's color from the color-by column value.
 *   - status/dropdown : option id → that option's `color`
 *   - tags            : first tag id → its option `color`
 *   - person          : first user id → deterministic palette colour
 */
const resolveColor = (colorByColumn, value) => {
  if (!colorByColumn || value == null) return DEFAULT_COLOR;
  const { type, settings } = colorByColumn;
  if (type === 'person') {
    const first = Array.isArray(value) ? value[0] : value;
    return first ? personColor(first) : DEFAULT_COLOR;
  }
  const options = settings && Array.isArray(settings.options) ? settings.options : [];
  const optionColor = (id) => {
    const opt = options.find((o) => o && o.id != null && o.id.toString() === id.toString());
    return opt && opt.color ? opt.color : DEFAULT_COLOR;
  };
  if (type === 'tags') {
    const first = Array.isArray(value) ? value[0] : value;
    return first ? optionColor(first) : DEFAULT_COLOR;
  }
  // status / dropdown
  return optionColor(value);
};

/** Project a resourceId (string|null) from the resource column value. */
const resolveResourceId = (resourceColumn, value) => {
  if (!resourceColumn || value == null) return null;
  if (Array.isArray(value)) return value.length ? value[0].toString() : null;
  return value.toString();
};

/**
 * Resolve `{ start, end }` (ISO strings) from a source column value.
 *   - date     : single-day event (start === end).
 *   - timeline : { start, end } — end falls back to start when absent.
 * Returns null when there's no usable value (the task contributes no event).
 */
const resolveDates = (sourceColumn, value) => {
  if (value == null || value === '') return null;
  if (sourceColumn.type === 'timeline') {
    if (typeof value !== 'object') return null;
    const start = value.start || value.end;
    if (!start) return null;
    return { start: new Date(start).toISOString(), end: new Date(value.end || start).toISOString() };
  }
  // date
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return { start: iso, end: iso };
};

/** Does an [eventStart,eventEnd] overlap the requested [from,to] window? */
const overlapsRange = (startISO, endISO, fromMs, toMs) => {
  if (fromMs == null && toMs == null) return true;
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  if (toMs != null && s > toMs) return false;
  if (fromMs != null && e < fromMs) return false;
  return true;
};

// ---------------------------------------------------------------------------
// events — GET /api/calendar-views/:id/events?from=&to= (F3 access check)
// ---------------------------------------------------------------------------
const events = async (req, res) => {
  try {
    const userId = req.user.userId;
    const viewId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(viewId)) {
      return res.status(404).json({ error: 'View not found' });
    }
    const view = await CalendarView.findById(viewId);
    if (!view) return res.status(404).json({ error: 'View not found' });

    const org = await Organisation.findById(view.workspaceId);
    if (!org) return res.status(404).json({ error: 'Workspace not found' });

    // Only the owner or a workspace member may read a view's events. (Shared
    // views are workspace-wide; a personal view is its owner's alone.)
    const isOwner = view.userId.toString() === userId;
    if (!isOwner && !isOrgMember(org, userId)) {
      return res.status(403).json({ error: 'Not allowed to read this view' });
    }

    const fromMs = req.query.from ? new Date(req.query.from).getTime() : null;
    const toMs = req.query.to ? new Date(req.query.to).getTime() : null;
    const fromValid = fromMs != null && !Number.isNaN(fromMs) ? fromMs : null;
    const toValid = toMs != null && !Number.isNaN(toMs) ? toMs : null;

    // ---- Global view (no board): legacy dueDate source across the workspace.
    if (!view.boardId) {
      const boards = await Board.find({ organisation: view.workspaceId }).select('_id').lean();
      const boardIds = boards.map((b) => b._id);
      const tasks = await Task.find({ board: { $in: boardIds }, dueDate: { $ne: null } })
        .select('name dueDate priority board')
        .lean();
      const out = [];
      for (const t of tasks) {
        if (!t.dueDate) continue;
        const iso = new Date(t.dueDate).toISOString();
        if (!overlapsRange(iso, iso, fromValid, toValid)) continue;
        out.push({ id: t._id.toString(), title: t.name, start: iso, end: iso, color: DEFAULT_COLOR, resourceId: null });
      }
      return res.json({ events: out });
    }

    // ---- Board-scoped view: F3 access check on the board.
    const board = await Board.findById(view.boardId);
    if (!board) return res.json({ events: [], warning: 'column_missing' });

    if (!isOrgMember(org, userId)) {
      const granted = await userHasResourceAccess(userId, 'board', board._id, { write: false });
      if (!granted) return res.status(403).json({ error: 'No access to this board' });
    }

    // AC4: a source/color/resource column that no longer exists → warn, no crash.
    const sourceColumn = findColumn(board, view.sourceColumnId);
    if (view.sourceColumnId && !sourceColumn) {
      return res.json({ events: [], warning: 'column_missing' });
    }
    const colorByColumn = view.colorByColumnId ? findColumn(board, view.colorByColumnId) : null;
    if (view.colorByColumnId && !colorByColumn) {
      return res.json({ events: [], warning: 'column_missing' });
    }
    const resourceColumn = view.resourceColumnId ? findColumn(board, view.resourceColumnId) : null;
    if (view.layout === 'resource' && view.resourceColumnId && !resourceColumn) {
      return res.json({ events: [], warning: 'column_missing' });
    }
    if (!sourceColumn) {
      // No source configured at all — nothing to place on the calendar.
      return res.json({ events: [] });
    }

    const tasks = await Task.find({ board: board._id }).select('name columnValues').lean();
    const out = [];
    for (const t of tasks) {
      if (!matchesFilter(t, view.filter)) continue;
      const dates = resolveDates(sourceColumn, readValue(t, view.sourceColumnId));
      if (!dates) continue;
      if (!overlapsRange(dates.start, dates.end, fromValid, toValid)) continue;
      const color = colorByColumn
        ? resolveColor(colorByColumn, readValue(t, view.colorByColumnId))
        : DEFAULT_COLOR;
      const resourceId =
        view.layout === 'resource' && resourceColumn
          ? resolveResourceId(resourceColumn, readValue(t, view.resourceColumnId))
          : null;
      out.push({ id: t._id.toString(), title: t.name, start: dates.start, end: dates.end, color, resourceId });
    }

    // For a resource layout, surface the resource roster so the UI can render a
    // row per option/person even when it has no events in range.
    let resources;
    if (view.layout === 'resource' && resourceColumn) {
      if (resourceColumn.type === 'person') {
        resources = null; // person rows are resolved client-side from members
      } else {
        const opts = (resourceColumn.settings && resourceColumn.settings.options) || [];
        resources = opts.map((o) => ({ id: o.id != null ? o.id.toString() : null, title: o.label }));
      }
    }

    const payload = { events: out };
    if (resources) payload.resources = resources;
    return res.json(payload);
  } catch (err) {
    console.error('calendarView.events error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  list,
  create,
  update,
  remove,
  events,
  // exported for unit tests
  _internals: {
    resolveColor,
    resolveDates,
    resolveResourceId,
    overlapsRange,
    validateColumnsForBoard,
    personColor,
    findColumn,
  },
};
