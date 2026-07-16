const mongoose = require('mongoose');
const Board = require('../models/Board');
const Task = require('../models/Task');
const TaskGroup = require('../models/TaskGroup');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');
const Organisation = require('../models/Organisation');
const {
  boardTemplates,
  getBoardTemplate,
  materializeTemplateColumns,
  materializeTemplateGroups,
  buildStarterForm,
  buildDefaultColumns,
  buildPrimaryOnlyColumns,
} = require('../utils/boardTemplates');
const Form = require('../models/Form');
const Workspace = require('../models/Workspace');
const { ensureDefaultWorkspace } = require('./workspaceController');
const { grantedBoardAccessForUser, resolveBoardGrantRole } = require('../middleware/roleCheck');

const VALID_VISIBILITIES = ['public', 'private'];

/**
 * Resolve whether the current user is the admin of the given org.
 */
const isOrgAdmin = (org, userId) =>
  !!org &&
  (
    (org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId))
  );

/**
 * Confirm the user is a member of the org. Returns the org doc or null.
 */
const loadOrgForMember = async (orgId, userId) => {
  const org = await Organisation.findById(orgId);
  if (!org) return { org: null, isMember: false };
  const isMember = org.members.some((m) => m.toString() === userId);
  return { org, isMember };
};

/**
 * Load a board + its org, validating that the current user is a member.
 * Returns { board, org, isAdmin } or { status, error } on failure.
 */
const loadBoardContext = async (boardId, userId) => {
  if (!boardId || !mongoose.Types.ObjectId.isValid(boardId)) {
    return { status: 400, error: 'Invalid board id' };
  }
  const board = await Board.findById(boardId);
  if (!board) return { status: 404, error: 'Board not found' };

  const org = await Organisation.findById(board.organisation);
  if (!org) return { status: 404, error: 'Organisation not found' };

  const isMember = org.members.some((m) => m.toString() === userId);
  if (!isMember) {
    return { status: 403, error: 'Not a member of this organisation' };
  }
  const orgAdmin = isOrgAdmin(org, userId);
  // Phase 3.2 — a non-admin's grant role decides board access. An editor grant
  // is treated as board-scoped admin (can edit tasks/columns); org-only actions
  // (rename/delete board) still gate on org admin separately. A viewer grant is
  // read-only. No grant + private board → denied.
  let grantRole = null;
  if (!orgAdmin) {
    grantRole = await resolveBoardGrantRole(userId, board);
    if (board.visibility === 'private' && !grantRole) {
      return { status: 403, error: 'Access denied' };
    }
  }
  const canEdit = orgAdmin || grantRole === 'editor';
  return { board, org, isAdmin: canEdit, isOrgAdmin: orgAdmin, grantRole };
};

const DEFAULT_STATUSES = [
  { key: 'not_started',   name: 'Not Started',   color: '#6B7280', order: 0, isDefault: true  },
  { key: 'working_on_it', name: 'Working on it', color: '#D97706', order: 1, isDefault: false },
  { key: 'done',          name: 'Done',          color: '#16A34A', order: 2, isDefault: false },
  { key: 'stuck',         name: 'Stuck',         color: '#DC2626', order: 3, isDefault: false },
];

/**
 * GET /api/boards?org=:orgId
 *
 * All org members can see all boards. Sorted by updatedAt desc.
 */
const getBoards = async (req, res) => {
  try {
    const orgId = req.query.org;
    if (!orgId) {
      return res.status(400).json({ error: 'Organisation ID required' });
    }

    const userId = req.user.userId;
    const { org, isMember } = await loadOrgForMember(orgId, userId);
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    if (!isMember) {
      return res.status(403).json({ error: 'Not a member of this organisation' });
    }

    // Phase 3.0 — make sure the default workspace exists and every board in the
    // org is assigned to one (non-destructive lazy migration).
    await ensureDefaultWorkspace(orgId, userId);

    const admin = isOrgAdmin(org, userId);
    // Phase 3.2 — non-admins see public boards PLUS any board explicitly granted
    // to them (per-board / per-folder / per-workspace grant). Admins see all.
    let grantedAccess = new Map();
    let boardQuery = { organisation: orgId };
    if (!admin) {
      grantedAccess = await grantedBoardAccessForUser(userId);
      boardQuery = {
        organisation: orgId,
        $or: [{ visibility: 'public' }, { _id: { $in: [...grantedAccess.keys()] } }],
      };
    }
    const boards = await Board.find(boardQuery).sort({ order: 1, updatedAt: -1 });

    // Lazy heal: pre-migration boards may have an empty `statuses` array,
    // which causes the client's status picker to fall back to legacy enum
    // options that the task API can't resolve. Seed defaults on first read.
    for (const board of boards) {
      if (!Array.isArray(board.statuses) || board.statuses.length === 0) {
        board.statuses = DEFAULT_STATUSES.map((s) => ({ ...s }));
        if (!Array.isArray(board.labels)) board.labels = [];
        await board.save();
      }
    }

    // Phase 3.1 — attach each board's folder (the server "Workspace" model is
    // the folder layer) so the sidebar can group boards and the Content tab can
    // show the folder name.
    const folders = await Workspace.find({ organisation: orgId }).select('name').lean();
    const folderNameById = new Map(folders.map((f) => [f._id.toString(), f.name]));
    const out = boards.map((b) => {
      const obj = typeof b.toObject === 'function' ? b.toObject() : b;
      const fid = obj.workspace ? obj.workspace.toString() : null;
      // Phase 3.2 — the caller's effective role on this board (admins edit all;
      // others get their grant role, else 'viewer' for a public board).
      const accessRole = admin ? 'admin' : grantedAccess.get(obj._id.toString()) || 'viewer';
      return {
        ...obj,
        folderId: fid,
        folderName: fid ? folderNameById.get(fid) || null : null,
        accessRole,
      };
    });

    return res.json({ boards: out });
  } catch (err) {
    console.error('getBoards error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Resolve the ObjectIds of all "done" statuses across an org's boards.
 * Used by analytics aggregations that previously matched the enum string
 * `'done'` directly.
 */
const findDoneStatusIdsForOrg = async (orgId) => {
  const boards = await Board.find({ organisation: orgId })
    .select('_id statuses')
    .lean();
  const ids = [];
  for (const b of boards) {
    for (const s of b.statuses || []) {
      if (s.key === 'done') ids.push(s._id);
    }
  }
  return ids;
};

/**
 * GET /api/dashboard/stats?org=:orgId
 *
 * Returns: { totalBoards, completedTasks, pendingTasks, completionRate }
 * Admins see org-wide stats. Regular users see stats scoped to tasks they
 * are assigned to within the org's public boards.
 */
const getDashboardStats = async (req, res) => {
  try {
    const orgId = req.query.org;
    if (!orgId) {
      return res.status(400).json({ error: 'Organisation ID required' });
    }

    const userId = req.user.userId;
    const { org, isMember } = await loadOrgForMember(orgId, userId);
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    if (!isMember) {
      return res.status(403).json({ error: 'Not a member of this organisation' });
    }

    const orgBoardIds = await Board.distinct('_id', { organisation: orgId });
    const taskFilter = { board: { $in: orgBoardIds }, isPersonal: { $ne: true } };

    const doneStatusIds = await findDoneStatusIdsForOrg(orgId);

    const [completedTasks, pendingTasks, totalBoards] = await Promise.all([
      Task.countDocuments({
        ...taskFilter,
        status: { $in: doneStatusIds.length ? doneStatusIds : ['done'] },
      }),
      Task.countDocuments({
        ...taskFilter,
        status: { $nin: doneStatusIds.length ? doneStatusIds : ['done'] },
      }),
      Board.countDocuments({ organisation: orgId }),
    ]);

    const totalTasks = completedTasks + pendingTasks;
    const completionRate =
      totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

    return res.json({
      totalBoards,
      completedTasks,
      pendingTasks,
      completionRate,
    });
  } catch (err) {
    console.error('getDashboardStats error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /api/boards
 *
 * Body: { name, visibility, organisation }
 * Admin-only. Validates input, attaches orgId and createdBy. New boards
 * are seeded with the four default statuses so the existing UI flow
 * (StatusMenu / Chip) keeps working.
 */
const createBoard = async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      name,
      visibility = 'private',
      organisation,
      description = '',
    } = req.body;

    if (!organisation) {
      return res.status(400).json({ error: 'Organisation ID required' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Board name is required' });
    }
    if (!VALID_VISIBILITIES.includes(visibility)) {
      return res.status(400).json({ error: 'Invalid visibility value' });
    }

    const org = await Organisation.findById(organisation);
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    if (!isOrgAdmin(org, userId)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const lastBoard = await Board.findOne({ organisation })
      .sort({ order: -1 })
      .select('order')
      .lean();
    const nextBoardOrder = (lastBoard?.order ?? -1) + 1;

    // Template path: when `?template=<id>` is provided, look up the
    // template and seed `board.columns` from it. Flips `useFlexibleColumns`
    // on so the new board uses the F1 code path from the first request.
    const templateId = req.query.template || req.body.template;
    let template = null;
    let templateColumns = [];
    let useFlexibleColumns = false;
    if (templateId) {
      template = getBoardTemplate(templateId);
      if (!template) {
        return res.status(400).json({ error: `Unknown template id: ${templateId}` });
      }
      templateColumns = materializeTemplateColumns(template);
      useFlexibleColumns = true;
    }

    // Resolve the workspace this board belongs to (Phase 3.0): the requested
    // workspace if it's valid and in this org, else the org's default workspace.
    const def = await ensureDefaultWorkspace(organisation, userId);
    let workspaceId = def._id;
    const reqWs = req.body.workspace;
    if (reqWs && mongoose.Types.ObjectId.isValid(reqWs)) {
      const ws = await Workspace.findOne({ _id: reqWs, organisation });
      if (ws) workspaceId = ws._id;
    }

    const board = await Board.create({
      name: name.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      visibility,
      organisation,
      workspace: workspaceId,
      createdBy: userId,
      order: nextBoardOrder,
      statuses: DEFAULT_STATUSES.map((s) => ({ ...s })),
      labels: [],
      columns: templateColumns,
      useFlexibleColumns,
    });

    // Non-template boards start blank on the flexible-columns engine: only the
    // primary "Name" column. The user adds the columns they actually want
    // (Status, Priority, etc.) on the spot via "+ Add column" — we no longer
    // force a preset Status/Priority/Owner/Due set onto every new board.
    if (!templateId) {
      board.columns = buildPrimaryOnlyColumns();
      board.useFlexibleColumns = true;
      await board.save();
    }

    // Seed the template's pipeline-stage groups (e.g. New Lead → Contacted → …)
    // so a CRM board opens with its pipeline ready, not a blank board.
    if (template) {
      const groups = materializeTemplateGroups(template);
      if (groups.length > 0) {
        await TaskGroup.insertMany(
          groups.map((g) => ({ name: g.name, board: board._id, order: g.order }))
        );
      }

      // Auto-create the template's starter public intake form (PLAN.md §1.1),
      // mapping its fields to the board's real column ids. Non-fatal on error.
      const starter = buildStarterForm(template, board);
      if (starter) {
        try {
          await Form.create({
            boardId: board._id,
            name: starter.name,
            welcomeMessage: starter.welcomeMessage,
            fieldMap: starter.fieldMap,
            enabled: true,
          });
        } catch (formErr) {
          console.error('createBoard: starter form seed failed:', formErr?.message || formErr);
        }
      }
    }

    return res.status(201).json({ board });
  } catch (err) {
    console.error('createBoard error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * PUT /api/boards/:id
 *
 * Body: { name?, visibility? }
 * Admin-only for the owning org.
 */
const updateBoard = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, visibility, description, workspace } = req.body;

    const board = await Board.findById(id);
    if (!board) return res.status(404).json({ error: 'Board not found' });

    const org = await Organisation.findById(board.organisation);
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    if (!isOrgAdmin(org, userId)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (typeof name === 'string') {
      if (!name.trim()) {
        return res.status(400).json({ error: 'Board name cannot be empty' });
      }
      board.name = name.trim();
    }
    if (typeof visibility === 'string') {
      if (!VALID_VISIBILITIES.includes(visibility)) {
        return res.status(400).json({ error: 'Invalid visibility value' });
      }
      board.visibility = visibility;
    }
    if (typeof description === 'string') {
      board.description = description.trim();
    }
    // Phase 3.1 — move the board to a folder (the "Workspace" model). Must be a
    // folder in this same org.
    if (workspace !== undefined) {
      if (workspace === null || workspace === '') {
        return res.status(400).json({ error: 'A folder is required' });
      }
      if (!mongoose.Types.ObjectId.isValid(workspace)) {
        return res.status(400).json({ error: 'Invalid folder id' });
      }
      const folder = await Workspace.findOne({ _id: workspace, organisation: board.organisation });
      if (!folder) {
        return res.status(400).json({ error: 'Folder does not belong to this workspace' });
      }
      board.workspace = folder._id;
    }

    await board.save();
    return res.json({ board });
  } catch (err) {
    console.error('updateBoard error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * DELETE /api/boards/:id
 *
 * Admin-only. Cascade deletes all TaskGroups, Tasks and Comments belonging
 * to this board.
 */
const deleteBoard = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const board = await Board.findById(id);
    if (!board) return res.status(404).json({ error: 'Board not found' });

    const org = await Organisation.findById(board.organisation);
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    if (!isOrgAdmin(org, userId)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const taskIds = await Task.distinct('_id', { board: id });
    if (taskIds.length > 0) {
      await Comment.deleteMany({ task: { $in: taskIds } });
      await Notification.deleteMany({ task: { $in: taskIds } });
    }
    await Task.deleteMany({ board: id });
    await TaskGroup.deleteMany({ board: id });
    await Board.deleteOne({ _id: id });

    return res.json({ success: true });
  } catch (err) {
    console.error('deleteBoard error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /api/boards/:id/enable-columns
 *
 * Admin-only. Converts a legacy (fixed-column) board to the flexible-columns
 * engine: seeds default columns mirroring the legacy fields and backfills
 * every existing task's `columnValues` from those fields so the DataGrid
 * shows the current data. Idempotent — a no-op if the board is already on
 * the flexible engine.
 */
const enableFlexibleColumns = async (req, res) => {
  try {
    const ctx = await loadBoardContext(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    if (!ctx.isAdmin) return res.status(403).json({ error: 'Admin access required' });

    const { board } = ctx;

    // Idempotency: already converted → return unchanged.
    if (board.useFlexibleColumns || (board.columns && board.columns.length > 0)) {
      return res.json({ board });
    }

    board.columns = buildDefaultColumns(board);
    board.useFlexibleColumns = true;
    await board.save();

    // Map legacy column keys → their freshly-assigned column `_id`s.
    const colIdByKey = {};
    for (const col of board.columns) colIdByKey[col.key] = col._id.toString();
    const statusOptionIds = new Set(
      (board.statuses || []).map((s) => s._id.toString())
    );

    // Backfill every board task (top-level AND subitems share the board ref).
    // bulkWrite bypasses the per-doc pre-save sync, which is correct here —
    // we write values derived *from* the legacy fields, so no re-projection
    // is needed. Personal tasks have no board, so they're excluded.
    const tasks = await Task.find({ board: board._id })
      .select('status priority assignedTo dueDate labels')
      .lean();

    const ops = [];
    for (const task of tasks) {
      const set = {};
      if (colIdByKey.status && task.status != null) {
        const sid = task.status.toString();
        if (statusOptionIds.has(sid)) {
          set[`columnValues.${colIdByKey.status}`] = sid;
        }
      }
      if (colIdByKey.priority && task.priority) {
        set[`columnValues.${colIdByKey.priority}`] = task.priority;
      }
      if (colIdByKey.assignees) {
        set[`columnValues.${colIdByKey.assignees}`] = (task.assignedTo || []).map((u) =>
          u.toString()
        );
      }
      if (colIdByKey.due_date) {
        set[`columnValues.${colIdByKey.due_date}`] = task.dueDate
          ? new Date(task.dueDate).toISOString()
          : null;
      }
      if (colIdByKey.tags) {
        set[`columnValues.${colIdByKey.tags}`] = (task.labels || []).map((l) =>
          l.toString()
        );
      }
      if (Object.keys(set).length > 0) {
        ops.push({ updateOne: { filter: { _id: task._id }, update: { $set: set } } });
      }
    }
    if (ops.length > 0) await Task.bulkWrite(ops);

    return res.json({ board });
  } catch (err) {
    console.error('enableFlexibleColumns error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// Labels + Statuses CRUD (admin-only)
// ---------------------------------------------------------------------------

/**
 * Shared admin guard for any /labels or /statuses sub-route.
 */
const requireBoardAdmin = async (req, res) => {
  const ctx = await loadBoardContext(req.params.id, req.user.userId);
  if (ctx.error) {
    res.status(ctx.status).json({ error: ctx.error });
    return null;
  }
  if (!ctx.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return ctx;
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const sanitizeColor = (value, fallback = '#6B7280') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return HEX_RE.test(trimmed) ? trimmed : fallback;
};

const sanitizeName = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 60);
};

const nextOrder = (collection) =>
  collection.length === 0
    ? 0
    : Math.max(...collection.map((c) => c.order || 0)) + 1;

const serializeBoardChips = (board) => ({
  labels: (board.labels || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
  statuses: (board.statuses || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
});

// --- Labels ----------------------------------------------------------------

const listLabels = async (req, res) => {
  try {
    const ctx = await loadBoardContext(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    return res.json({ labels: serializeBoardChips(ctx.board).labels });
  } catch (err) {
    console.error('listLabels error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const addLabel = async (req, res) => {
  try {
    const ctx = await requireBoardAdmin(req, res);
    if (!ctx) return;
    const { board } = ctx;
    const name = sanitizeName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Label name is required' });
    const color = sanitizeColor(req.body?.color);
    board.labels.push({ name, color, order: nextOrder(board.labels) });
    await board.save();
    return res.status(201).json({ labels: serializeBoardChips(board).labels });
  } catch (err) {
    console.error('addLabel error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const updateLabel = async (req, res) => {
  try {
    const ctx = await requireBoardAdmin(req, res);
    if (!ctx) return;
    const { board } = ctx;
    const { lid } = req.params;
    const label = board.labels.id(lid);
    if (!label) return res.status(404).json({ error: 'Label not found' });
    if (typeof req.body?.name === 'string') {
      const name = sanitizeName(req.body.name);
      if (!name) return res.status(400).json({ error: 'Label name cannot be empty' });
      label.name = name;
    }
    if (typeof req.body?.color === 'string') {
      label.color = sanitizeColor(req.body.color, label.color);
    }
    await board.save();
    return res.json({ labels: serializeBoardChips(board).labels });
  } catch (err) {
    console.error('updateLabel error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const deleteLabel = async (req, res) => {
  try {
    const ctx = await requireBoardAdmin(req, res);
    if (!ctx) return;
    const { board } = ctx;
    const { lid } = req.params;
    const label = board.labels.id(lid);
    if (!label) return res.status(404).json({ error: 'Label not found' });
    board.labels.pull({ _id: lid });
    await board.save();
    // Detach this label id from every task on the board.
    await Task.updateMany(
      { board: board._id },
      { $pull: { labels: lid } }
    );
    return res.json({ labels: serializeBoardChips(board).labels });
  } catch (err) {
    console.error('deleteLabel error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const reorderLabels = async (req, res) => {
  try {
    const ctx = await requireBoardAdmin(req, res);
    if (!ctx) return;
    const { board } = ctx;
    const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : [];
    const lookup = new Map(orderedIds.map((id, i) => [id.toString(), i]));
    for (const lab of board.labels) {
      const idx = lookup.get(lab._id.toString());
      if (idx !== undefined) lab.order = idx;
    }
    await board.save();
    return res.json({ labels: serializeBoardChips(board).labels });
  } catch (err) {
    console.error('reorderLabels error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// --- Statuses --------------------------------------------------------------

const listStatuses = async (req, res) => {
  try {
    const ctx = await loadBoardContext(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    return res.json({ statuses: serializeBoardChips(ctx.board).statuses });
  } catch (err) {
    console.error('listStatuses error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const addStatus = async (req, res) => {
  try {
    const ctx = await requireBoardAdmin(req, res);
    if (!ctx) return;
    const { board } = ctx;
    const name = sanitizeName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Status name is required' });
    const color = sanitizeColor(req.body?.color);
    board.statuses.push({
      name,
      color,
      order: nextOrder(board.statuses),
      key: null,
      isDefault: false,
    });
    await board.save();
    return res.status(201).json({ statuses: serializeBoardChips(board).statuses });
  } catch (err) {
    console.error('addStatus error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const updateStatus = async (req, res) => {
  try {
    const ctx = await requireBoardAdmin(req, res);
    if (!ctx) return;
    const { board } = ctx;
    const { sid } = req.params;
    const status = board.statuses.id(sid);
    if (!status) return res.status(404).json({ error: 'Status not found' });
    if (typeof req.body?.name === 'string') {
      const name = sanitizeName(req.body.name);
      if (!name) return res.status(400).json({ error: 'Status name cannot be empty' });
      status.name = name;
    }
    if (typeof req.body?.color === 'string') {
      status.color = sanitizeColor(req.body.color, status.color);
    }
    if (typeof req.body?.isDefault === 'boolean' && req.body.isDefault) {
      // Only one status can be the default; clear the others.
      for (const s of board.statuses) s.isDefault = false;
      status.isDefault = true;
    }
    await board.save();
    return res.json({ statuses: serializeBoardChips(board).statuses });
  } catch (err) {
    console.error('updateStatus error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const deleteStatus = async (req, res) => {
  try {
    const ctx = await requireBoardAdmin(req, res);
    if (!ctx) return;
    const { board } = ctx;
    const { sid } = req.params;
    const status = board.statuses.id(sid);
    if (!status) return res.status(404).json({ error: 'Status not found' });
    if (status.isDefault) {
      return res
        .status(400)
        .json({ error: 'Cannot delete the default status. Reassign another status as default first.' });
    }
    // Reassign any tasks currently using this status to the board's default.
    const fallback = board.statuses.find((s) => s.isDefault && s._id.toString() !== sid);
    if (fallback) {
      await Task.updateMany(
        { board: board._id, status: sid },
        { $set: { status: fallback._id } }
      );
    }
    board.statuses.pull({ _id: sid });
    await board.save();
    return res.json({ statuses: serializeBoardChips(board).statuses });
  } catch (err) {
    console.error('deleteStatus error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const reorderStatuses = async (req, res) => {
  try {
    const ctx = await requireBoardAdmin(req, res);
    if (!ctx) return;
    const { board } = ctx;
    const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : [];
    const lookup = new Map(orderedIds.map((id, i) => [id.toString(), i]));
    for (const s of board.statuses) {
      const idx = lookup.get(s._id.toString());
      if (idx !== undefined) s.order = idx;
    }
    await board.save();
    return res.json({ statuses: serializeBoardChips(board).statuses });
  } catch (err) {
    console.error('reorderStatuses error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * PUT /api/boards/reorder
 *
 * Body: { organisation, orderedIds: [boardId,...] }
 * Reorders boards within an organisation. Any user who is a member of the
 * organisation can reorder boards (mirrors the read permission for getBoards).
 */
const reorderBoards = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { organisation, orderedIds } = req.body || {};
    if (!organisation) {
      return res.status(400).json({ error: 'Organisation ID required' });
    }
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds must be an array' });
    }

    const { org, isMember } = await loadOrgForMember(organisation, userId);
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    if (!isMember) {
      return res.status(403).json({ error: 'Not a member of this organisation' });
    }

    const admin = isOrgAdmin(org, userId);
    const visibilityFilter = admin ? {} : { visibility: 'public' };
    const currentIds = await Board.distinct('_id', { organisation, ...visibilityFilter });
    const currentSet = new Set(currentIds.map((id) => id.toString()));
    const orderedSet = new Set(orderedIds.map((id) => String(id)));
    if (
      orderedIds.length !== currentIds.length ||
      ![...orderedSet].every((id) => currentSet.has(id))
    ) {
      return res
        .status(400)
        .json({ error: 'orderedIds must list every visible board in the organisation exactly once' });
    }

    const ops = orderedIds.map((id, idx) => ({
      updateOne: {
        filter: { _id: id, organisation },
        update: { $set: { order: idx } },
      },
    }));
    if (ops.length > 0) await Board.bulkWrite(ops);

    const boards = await Board.find({ organisation }).sort({ order: 1, updatedAt: -1 });
    return res.json({ boards });
  } catch (err) {
    console.error('reorderBoards error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET /api/boards/:id/connectable
 *
 * Boards a `connect_boards` column on this board may target. Pre-F3 that's
 * every OTHER board in the same workspace; F3 adds boards reachable through an
 * active WorkspaceGrant (flagged `workspace.shared: true`). Member-gated. The
 * column list is included so the client can offer source-column choices when
 * building a mirror.
 *
 * Returns: { connectable: [{ board, workspace }] }
 */
const getConnectableBoards = async (req, res) => {
  try {
    const userId = req.user.userId;
    const ctx = await loadBoardContext(req.params.id, userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const visibilityFilter = ctx.isAdmin ? {} : { visibility: 'public' };
    const sameWsBoards = await Board.find({
      organisation: ctx.board.organisation,
      _id: { $ne: ctx.board._id },
      ...visibilityFilter,
    })
      .select('name visibility columns organisation')
      .sort({ order: 1, updatedAt: -1 })
      .lean();

    const ownWorkspace = {
      _id: ctx.org._id,
      name: ctx.org.displayName || ctx.org.name || 'Workspace',
      shared: false,
    };
    const connectable = sameWsBoards.map((board) => ({ board, workspace: ownWorkspace }));

    // F3: boards in OTHER workspaces the caller can reach via an active grant.
    const grantedAccess = await grantedBoardAccessForUser(userId); // Map<boardId, role>
    const grantedIds = [...grantedAccess.keys()].filter(
      (id) => id !== ctx.board._id.toString()
    );
    if (grantedIds.length) {
      const grantedBoards = await Board.find({
        _id: { $in: grantedIds },
        organisation: { $ne: ctx.board.organisation },
      })
        .select('name visibility columns organisation')
        .lean();
      const wsIds = [...new Set(grantedBoards.map((b) => b.organisation.toString()))];
      const orgs = await Organisation.find({ _id: { $in: wsIds } })
        .select('name displayName')
        .lean();
      const orgById = new Map(orgs.map((o) => [o._id.toString(), o]));
      for (const board of grantedBoards) {
        const org = orgById.get(board.organisation.toString());
        connectable.push({
          board,
          workspace: {
            _id: org ? org._id : board.organisation,
            name: org ? org.displayName || org.name || 'Workspace' : 'Shared workspace',
            shared: true,
          },
        });
      }
    }

    return res.json({ connectable });
  } catch (err) {
    console.error('getConnectableBoards error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET /api/boards/templates
 *
 * Returns the built-in template list. Authenticated route — any logged-in
 * user can browse templates; only admins can create boards from them
 * (enforced in createBoard).
 */
const listBoardTemplates = async (req, res) => {
  try {
    return res.json({
      templates: boardTemplates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        columns: t.columns,
        groups: Array.isArray(t.groups) ? t.groups : [],
      })),
    });
  } catch (err) {
    console.error('listBoardTemplates error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getBoards,
  getDashboardStats,
  createBoard,
  updateBoard,
  deleteBoard,
  enableFlexibleColumns,
  reorderBoards,
  listBoardTemplates,
  getConnectableBoards,
  // labels
  listLabels,
  addLabel,
  updateLabel,
  deleteLabel,
  reorderLabels,
  // statuses
  listStatuses,
  addStatus,
  updateStatus,
  deleteStatus,
  reorderStatuses,
  // exported for analytics/dashboard
  findDoneStatusIdsForOrg,
};
