const mongoose = require('mongoose');
const Organisation = require('../models/Organisation');
const Board = require('../models/Board');
const WorkspaceGrant = require('../models/WorkspaceGrant');

/**
 * requireOrgAdmin — Middleware that checks if the current user is the admin
 * of the organisation referenced by the request.
 *
 * Resolves orgId from (in order):
 *   1. req.params.id
 *   2. req.params.orgId
 *   3. req.body.orgId
 *   4. req.query.org
 *
 * Responds 403 if not admin, 404 if org not found, 400 if no orgId resolvable.
 */
const requireOrgAdmin = async (req, res, next) => {
  try {
    const orgId =
      req.params.id ||
      req.params.orgId ||
      req.body.orgId ||
      req.query.org;

    if (!orgId) {
      return res.status(400).json({ error: 'Organisation ID required' });
    }

    const org = await Organisation.findById(orgId);
    if (!org) {
      return res.status(404).json({ error: 'Organisation not found' });
    }

    const isMainAdmin = org.admin.toString() === req.user.userId;
    const isExtraAdmin = Array.isArray(org.admins) &&
      org.admins.some((a) => a.toString() === req.user.userId);

    if (!isMainAdmin && !isExtraAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Attach org for downstream handlers
    req.org = org;
    return next();
  } catch (err) {
    console.error('requireOrgAdmin error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * requireOrgOwner — Stricter variant of requireOrgAdmin. Only the organisation's
 * primary admin (org.admin) passes. Extra admins listed in org.admins[] do NOT.
 *
 * Used for destructive workspace-level actions (delete organisation, etc).
 */
const requireOrgOwner = async (req, res, next) => {
  try {
    const orgId =
      req.params.id ||
      req.params.orgId ||
      req.body.orgId ||
      req.query.org;

    if (!orgId) {
      return res.status(400).json({ error: 'Organisation ID required' });
    }

    const org = await Organisation.findById(orgId);
    if (!org) {
      return res.status(404).json({ error: 'Organisation not found' });
    }

    if (org.admin.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Only the organisation owner can perform this action' });
    }

    req.org = org;
    return next();
  } catch (err) {
    console.error('requireOrgOwner error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// F3 — WorkspaceGrant-aware resource access
// ---------------------------------------------------------------------------

const orgIsMember = (org, userId) =>
  !!org && Array.isArray(org.members) && org.members.some((m) => m.toString() === userId);

const orgIsAdmin = (org, userId) =>
  !!org &&
  (
    (org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId))
  );

/**
 * Match clause for a grant that is currently ACTIVE (never expires, or expires
 * in the future). Combined under `$and` so it composes with any caller filter
 * that already uses `$or`.
 */
const activeClause = () => ({
  $or: [
    { expiresAt: null },
    { expiresAt: { $exists: false } },
    { expiresAt: { $gt: new Date() } },
  ],
});

/**
 * Find active (non-expired) grants matching `filter`.
 */
const findActiveGrants = (filter) =>
  WorkspaceGrant.find({ $and: [filter, activeClause()] }).lean();

/**
 * All active grants for a user (any resource type). Used by shared-with-me and
 * the navbar's "Shared with me" section.
 */
const activeGrantsForUser = (userId) => findActiveGrants({ granteeUserId: userId });

/**
 * Resolve every board a user can reach via active grants into a
 * `Map<boardIdString, 'viewer' | 'editor'>` holding the strongest role.
 *
 *   - 'board' grants    → that board.
 *   - 'workspace' grants → every board in the granted workspace.
 *
 * Used by the F2 `connectable` endpoint (offer cross-workspace targets), the
 * link endpoint (authorise a cross-workspace link), and the mirror "Restricted"
 * fallback.
 */
const grantedBoardAccessForUser = async (userId) => {
  const grants = await activeGrantsForUser(userId);
  const access = new Map(); // boardId -> role

  const stronger = (a, b) => (a === 'editor' || b === 'editor' ? 'editor' : 'viewer');
  const note = (boardId, role) => {
    const id = boardId.toString();
    access.set(id, access.has(id) ? stronger(access.get(id), role) : role);
  };

  const wsRoleById = new Map();
  const folderRoleById = new Map();
  for (const g of grants) {
    if (g.resourceType === 'board') {
      note(g.resourceId, g.role);
    } else if (g.resourceType === 'workspace') {
      const wsId = g.resourceId.toString();
      wsRoleById.set(wsId, wsRoleById.has(wsId) ? stronger(wsRoleById.get(wsId), g.role) : g.role);
    } else if (g.resourceType === 'folder') {
      const fId = g.resourceId.toString();
      folderRoleById.set(fId, folderRoleById.has(fId) ? stronger(folderRoleById.get(fId), g.role) : g.role);
    }
  }

  if (wsRoleById.size > 0) {
    const boards = await Board.find({ organisation: { $in: [...wsRoleById.keys()] } })
      .select('organisation')
      .lean();
    for (const b of boards) {
      const role = wsRoleById.get(b.organisation.toString());
      if (role) note(b._id, role);
    }
  }

  // Phase 3.2 — folder grants cover every board in that folder (board.workspace).
  if (folderRoleById.size > 0) {
    const boards = await Board.find({ workspace: { $in: [...folderRoleById.keys()] } })
      .select('workspace')
      .lean();
    for (const b of boards) {
      const role = b.workspace ? folderRoleById.get(b.workspace.toString()) : null;
      if (role) note(b._id, role);
    }
  }

  return access;
};

/**
 * Resolve a user's strongest active grant role on a specific board, honouring
 * direct board grants, a folder grant on the board's folder, and a workspace
 * grant on the board's org. Returns 'editor' | 'viewer' | null. One query —
 * cheap enough for the board hot path (loadBoardContext).
 *
 * `board` must carry `_id`, `organisation`, and (optionally) `workspace`.
 */
const resolveBoardGrantRole = async (userId, board) => {
  if (!board) return null;
  const clauses = [
    { resourceType: 'board', resourceId: board._id },
    { resourceType: 'workspace', resourceId: board.organisation },
  ];
  if (board.workspace) clauses.push({ resourceType: 'folder', resourceId: board.workspace });
  const grants = await findActiveGrants({ granteeUserId: userId, $or: clauses });
  if (grants.length === 0) return null;
  return grants.some((g) => g.role === 'editor') ? 'editor' : 'viewer';
};

/**
 * Does `userId` have access to `(resourceType, resourceId)` for the requested
 * action? Passes when EITHER:
 *   - the user is a member of the resource's workspace with sufficient role
 *     (read → any member; write → admin/owner), OR
 *   - an active WorkspaceGrant permits it (viewer → read; editor → read+write).
 *     A 'workspace'-type grant on a board's owning workspace also covers the
 *     board.
 */
const userHasResourceAccess = async (userId, resourceType, resourceId, { write = false } = {}) => {
  if (!resourceId || !mongoose.Types.ObjectId.isValid(resourceId)) return false;

  let owningWorkspaceId = null;
  let boardFolderId = null;
  if (resourceType === 'board') {
    const board = await Board.findById(resourceId).select('organisation workspace').lean();
    if (!board) return false;
    owningWorkspaceId = board.organisation.toString();
    boardFolderId = board.workspace ? board.workspace.toString() : null;
  } else if (resourceType === 'workspace') {
    owningWorkspaceId = resourceId.toString();
  } else if (resourceType === 'folder') {
    const Workspace = require('../models/Workspace');
    const folder = await Workspace.findById(resourceId).select('organisation').lean();
    if (!folder) return false;
    owningWorkspaceId = folder.organisation.toString();
  } else {
    return false;
  }

  // 1. Membership path — Organisation doc is the source of truth.
  const org = await Organisation.findById(owningWorkspaceId)
    .select('admin admins members')
    .lean();
  if (org) {
    if (write) {
      if (orgIsAdmin(org, userId)) return true;
    } else if (orgIsMember(org, userId)) {
      return true;
    }
  }

  // 2. Grant path — direct resource grant, or a workspace/folder grant covering it.
  const resourceClauses = [{ resourceType, resourceId }];
  if (resourceType === 'board') {
    resourceClauses.push({ resourceType: 'workspace', resourceId: owningWorkspaceId });
    if (boardFolderId) {
      resourceClauses.push({ resourceType: 'folder', resourceId: boardFolderId });
    }
  }
  const grants = await findActiveGrants({
    granteeUserId: userId,
    $or: resourceClauses,
  });
  return grants.some((g) => !write || g.role === 'editor');
};

/**
 * requireResourceAccess(resourceType, { write }) — generic per-resource gate
 * that honours both workspace membership and cross-workspace grants (F3.4).
 *
 * Resolves the resource id from `req.params` (resourceId / <type>Id / id /
 * boardId / workspaceId / orgId, in that order). Exported for use by any route
 * that needs grant-aware access — downstream features (F7, F8, F10–F13, F15)
 * mount it instead of re-deriving access ad hoc.
 */
const requireResourceAccess = (resourceType, { write = false } = {}) => async (req, res, next) => {
  try {
    const resourceId =
      req.params.resourceId ||
      req.params[`${resourceType}Id`] ||
      req.params.id ||
      req.params.boardId ||
      req.params.workspaceId ||
      req.params.orgId;

    if (!resourceId) {
      return res.status(400).json({ error: 'Resource ID required' });
    }

    const ok = await userHasResourceAccess(req.user.userId, resourceType, resourceId, { write });
    if (!ok) {
      return res.status(403).json({ error: 'Access denied' });
    }
    return next();
  } catch (err) {
    console.error('requireResourceAccess error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  requireOrgAdmin,
  requireOrgOwner,
  requireResourceAccess,
  // Shared grant-resolution helpers (used by controllers + services).
  userHasResourceAccess,
  grantedBoardAccessForUser,
  resolveBoardGrantRole,
  activeGrantsForUser,
  findActiveGrants,
};
