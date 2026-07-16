/**
 * workspaceController.js (Phase 3.0) — CRUD for the real Workspace layer that
 * sits inside an Organisation: Organisation → Workspace → Board.
 *
 * Mounted under `/api/orgs/:orgId/workspaces` (nested so it can't collide with
 * the legacy `/api/workspaces` → orgs alias). Reads are member-gated, writes are
 * org-admin-gated.
 */
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');
const Board = require('../models/Board');
const Organisation = require('../models/Organisation');

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

const loadOrg = async (orgId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(orgId)) return { status: 400, error: 'Invalid org id' };
  const org = await Organisation.findById(orgId);
  if (!org) return { status: 404, error: 'Organisation not found' };
  const isMember = org.members.some((m) => m.toString() === userId);
  if (!isMember) return { status: 403, error: 'Not a member of this organisation' };
  return { org, isAdmin: isOrgAdmin(org, userId) };
};

/**
 * Ensure an org has its default "General" workspace and that every board in the
 * org is assigned to a workspace (non-destructive migration). Idempotent — safe
 * to call on every workspace list. Returns the default workspace doc.
 */
const ensureDefaultWorkspace = async (orgId, userId = null) => {
  let def = await Workspace.findOne({ organisation: orgId, isDefault: true });
  if (!def) {
    // Adopt an existing same-named workspace if present, else create one.
    def = await Workspace.findOne({ organisation: orgId, name: 'General' });
    if (def) {
      def.isDefault = true;
      await def.save();
    } else {
      def = await Workspace.create({
        organisation: orgId,
        name: 'General',
        order: 0,
        isDefault: true,
        createdBy: userId || undefined,
      });
    }
  }
  // Backfill: any board in this org without a workspace lands in the default.
  await Board.updateMany(
    { organisation: orgId, $or: [{ workspace: null }, { workspace: { $exists: false } }] },
    { $set: { workspace: def._id } }
  );
  return def;
};

const serialize = (w) => ({
  _id: w._id,
  organisation: w.organisation,
  name: w.name,
  order: w.order,
  isDefault: !!w.isDefault,
  createdAt: w.createdAt,
  updatedAt: w.updatedAt,
});

/** GET /api/orgs/:orgId/workspaces — list (member). Auto-heals the default. */
const listWorkspaces = async (req, res) => {
  try {
    const ctx = await loadOrg(req.params.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    await ensureDefaultWorkspace(req.params.orgId, req.user.userId);
    const workspaces = await Workspace.find({ organisation: req.params.orgId }).sort({
      order: 1,
      createdAt: 1,
    });
    return res.json({ workspaces: workspaces.map(serialize) });
  } catch (err) {
    console.error('listWorkspaces error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/orgs/:orgId/workspaces — create (admin). Body: { name }. */
const createWorkspace = async (req, res) => {
  try {
    const ctx = await loadOrg(req.params.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    if (!ctx.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'Workspace name is required' });

    await ensureDefaultWorkspace(req.params.orgId, req.user.userId);
    const last = await Workspace.findOne({ organisation: req.params.orgId })
      .sort({ order: -1 })
      .select('order')
      .lean();
    const ws = await Workspace.create({
      organisation: req.params.orgId,
      name,
      order: (last?.order ?? -1) + 1,
      createdBy: req.user.userId,
    });
    return res.status(201).json({ workspace: serialize(ws) });
  } catch (err) {
    console.error('createWorkspace error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** PATCH /api/orgs/:orgId/workspaces/:wsId — rename / reorder (admin). */
const updateWorkspace = async (req, res) => {
  try {
    const ctx = await loadOrg(req.params.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    if (!ctx.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const ws = await Workspace.findOne({ _id: req.params.wsId, organisation: req.params.orgId });
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    if (req.body.name !== undefined) {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'Workspace name cannot be empty' });
      ws.name = name;
    }
    if (typeof req.body.order === 'number') ws.order = req.body.order;
    await ws.save();
    return res.json({ workspace: serialize(ws) });
  } catch (err) {
    console.error('updateWorkspace error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * DELETE /api/orgs/:orgId/workspaces/:wsId — admin. Boards inside move to the
 * default workspace (no data loss). The default workspace can't be deleted.
 */
const deleteWorkspace = async (req, res) => {
  try {
    const ctx = await loadOrg(req.params.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    if (!ctx.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const ws = await Workspace.findOne({ _id: req.params.wsId, organisation: req.params.orgId });
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (ws.isDefault) return res.status(400).json({ error: 'The default workspace cannot be deleted' });

    const def = await ensureDefaultWorkspace(req.params.orgId, req.user.userId);
    await Board.updateMany({ workspace: ws._id }, { $set: { workspace: def._id } });
    await ws.deleteOne();
    return res.status(204).end();
  } catch (err) {
    console.error('deleteWorkspace error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  ensureDefaultWorkspace,
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
};
