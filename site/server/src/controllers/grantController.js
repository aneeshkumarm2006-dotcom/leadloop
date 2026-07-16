/**
 * grantController.js — WorkspaceGrant CRUD + "shared with me" (Phase 1, F3).
 *
 * Routes (wired in routes/orgs.js, reachable under both /api/orgs and
 * /api/workspaces):
 *   GET    /api/workspaces/:id/grants            (admin)  — grants this ws issued
 *   POST   /api/workspaces/:id/grants            (admin)  — issue a grant
 *   DELETE /api/workspaces/:id/grants/:gid       (admin)  — revoke a grant
 *   GET    /api/workspaces/shared-with-me        (auth)   — boards shared TO me
 *
 * The admin routes are gated by `requireOrgAdmin` (caller must be an admin of
 * the grantor workspace `:id`). `:id` is therefore always the grantor.
 */

const mongoose = require('mongoose');
const WorkspaceGrant = require('../models/WorkspaceGrant');
const Organisation = require('../models/Organisation');
const Board = require('../models/Board');
const User = require('../models/User');
const { grantedBoardAccessForUser } = require('../middleware/roleCheck');

const RESOURCE_TYPES = WorkspaceGrant.RESOURCE_TYPES; // ['board', 'workspace']
const GRANT_ROLES = WorkspaceGrant.GRANT_ROLES; // ['viewer', 'editor']

/**
 * Resolve a display label for a grant's resource (board name / workspace name).
 */
const resolveResourceLabel = async (grant, boardCache, orgCache) => {
  if (grant.resourceType === 'board') {
    const id = grant.resourceId.toString();
    if (!boardCache.has(id)) {
      // eslint-disable-next-line no-await-in-loop
      boardCache.set(id, await Board.findById(id).select('name').lean());
    }
    const board = boardCache.get(id);
    return board ? board.name : '(deleted board)';
  }
  if (grant.resourceType === 'folder') {
    const Workspace = require('../models/Workspace');
    const folder = await Workspace.findById(grant.resourceId).select('name').lean();
    return folder ? folder.name : '(deleted folder)';
  }
  const id = grant.resourceId.toString();
  if (!orgCache.has(id)) {
    orgCache.set(id, await Organisation.findById(id).select('name displayName').lean());
  }
  const org = orgCache.get(id);
  return org ? org.displayName || org.name : '(deleted workspace)';
};

/**
 * GET /api/workspaces/:id/grants — list grants issued BY this workspace.
 */
const listGrants = async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const grants = await WorkspaceGrant.find({ workspaceId })
      .populate('granteeUserId', 'name email profilePic')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const boardCache = new Map();
    const orgCache = new Map();
    const enriched = [];
    for (const g of grants) {
      // eslint-disable-next-line no-await-in-loop
      const resourceLabel = await resolveResourceLabel(g, boardCache, orgCache);
      enriched.push({
        ...g,
        resourceLabel,
        isExpired: g.expiresAt ? new Date(g.expiresAt).getTime() <= Date.now() : false,
      });
    }

    return res.json({ grants: enriched });
  } catch (err) {
    console.error('listGrants error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /api/workspaces/:id/grants — issue (or refresh) a grant.
 * Body: { resourceType, resourceId, granteeUserId | granteeEmail, role, expiresAt? }
 *
 * `:id` is the grantor workspace. A 'board' resource must belong to it; a
 * 'workspace' resource must BE it (you can only share what you own). Re-issuing
 * a grant for the same (resource, grantee) updates the existing row in place.
 */
const createGrant = async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const {
      resourceType,
      resourceId,
      granteeUserId,
      granteeEmail,
      role = 'viewer',
      expiresAt = null,
    } = req.body || {};

    if (!RESOURCE_TYPES.includes(resourceType)) {
      return res.status(400).json({ error: `resourceType must be one of: ${RESOURCE_TYPES.join(', ')}` });
    }
    if (!GRANT_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${GRANT_ROLES.join(', ')}` });
    }
    if (!resourceId || !mongoose.Types.ObjectId.isValid(resourceId)) {
      return res.status(400).json({ error: 'A valid resourceId is required' });
    }

    // Validate the resource is owned by the grantor workspace.
    if (resourceType === 'board') {
      const board = await Board.findById(resourceId).select('organisation').lean();
      if (!board) return res.status(404).json({ error: 'Board not found' });
      if (board.organisation.toString() !== workspaceId.toString()) {
        return res.status(403).json({ error: 'You can only share boards in your own workspace' });
      }
    } else if (resourceType === 'folder') {
      const Workspace = require('../models/Workspace');
      const folder = await Workspace.findById(resourceId).select('organisation').lean();
      if (!folder) return res.status(404).json({ error: 'Folder not found' });
      if (folder.organisation.toString() !== workspaceId.toString()) {
        return res.status(403).json({ error: 'You can only share folders in your own workspace' });
      }
    } else if (resourceId.toString() !== workspaceId.toString()) {
      return res.status(400).json({ error: 'A workspace grant must reference the granting workspace' });
    }

    // Resolve the grantee — by id or by email (the Share modal works by email).
    let grantee = null;
    if (granteeUserId && mongoose.Types.ObjectId.isValid(granteeUserId)) {
      grantee = await User.findById(granteeUserId).select('_id name email').lean();
    } else if (granteeEmail && typeof granteeEmail === 'string') {
      const raw = granteeEmail.trim();
      // Try the email as given, then its lowercased form (Google emails are
      // usually already lowercase, but don't assume case).
      grantee =
        (await User.findOne({ email: raw }).select('_id name email').lean()) ||
        (raw !== raw.toLowerCase()
          ? await User.findOne({ email: raw.toLowerCase() }).select('_id name email').lean()
          : null);
    }
    if (!grantee) {
      return res.status(404).json({ error: 'No user found for the given grantee' });
    }
    if (grantee._id.toString() === req.user.userId) {
      return res.status(400).json({ error: 'You already have access to your own workspace' });
    }

    // Parse expiry — accept an ISO string or null.
    let expiresAtValue = null;
    if (expiresAt) {
      const d = new Date(expiresAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: 'expiresAt is not a valid date' });
      }
      expiresAtValue = d;
    }

    // Upsert: one logical grant per (workspace, resource, grantee). Re-issuing
    // updates role/expiry rather than stacking duplicate rows.
    const grant = await WorkspaceGrant.findOneAndUpdate(
      {
        workspaceId,
        resourceType,
        resourceId,
        granteeUserId: grantee._id,
      },
      {
        $set: { role, expiresAt: expiresAtValue, createdBy: req.user.userId },
        $setOnInsert: { createdAt: new Date() },
      },
      { new: true, upsert: true }
    );

    const populated = await WorkspaceGrant.findById(grant._id)
      .populate('granteeUserId', 'name email profilePic')
      .lean();

    return res.status(201).json({ grant: populated });
  } catch (err) {
    console.error('createGrant error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * DELETE /api/workspaces/:id/grants/:gid — revoke a grant. The grant must have
 * been issued by `:id` (an admin of workspace A cannot revoke workspace B's
 * grants).
 */
const deleteGrant = async (req, res) => {
  try {
    const { id: workspaceId, gid } = req.params;
    if (!mongoose.Types.ObjectId.isValid(gid)) {
      return res.status(400).json({ error: 'Invalid grant id' });
    }

    const grant = await WorkspaceGrant.findById(gid);
    if (!grant) return res.status(404).json({ error: 'Grant not found' });
    if (grant.workspaceId.toString() !== workspaceId.toString()) {
      return res.status(403).json({ error: 'This grant belongs to another workspace' });
    }

    await WorkspaceGrant.deleteOne({ _id: gid });
    return res.json({ message: 'Grant revoked' });
  } catch (err) {
    console.error('deleteGrant error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET /api/workspaces/shared-with-me — boards shared TO the calling user via an
 * active grant (board grants directly; workspace grants expanded to each board
 * in the granted workspace). Returns `[{ workspace, board, role }]`. The navbar
 * groups these into its "Shared with me" section.
 */
const getSharedWithMe = async (req, res) => {
  try {
    const userId = req.user.userId;
    const access = await grantedBoardAccessForUser(userId); // Map<boardId, role>
    const boardIds = [...access.keys()];
    if (boardIds.length === 0) return res.json({ shared: [] });

    const boards = await Board.find({ _id: { $in: boardIds } })
      .select('name visibility organisation columns useFlexibleColumns statuses labels')
      .lean();

    const wsIds = [...new Set(boards.map((b) => b.organisation.toString()))];
    const orgs = await Organisation.find({ _id: { $in: wsIds } })
      .select('name displayName region')
      .lean();
    const orgById = new Map(orgs.map((o) => [o._id.toString(), o]));

    const shared = boards.map((board) => ({
      workspace: orgById.get(board.organisation.toString()) || null,
      board,
      role: access.get(board._id.toString()) || 'viewer',
    }));

    return res.json({ shared });
  } catch (err) {
    console.error('getSharedWithMe error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  listGrants,
  createGrant,
  deleteGrant,
  getSharedWithMe,
};
