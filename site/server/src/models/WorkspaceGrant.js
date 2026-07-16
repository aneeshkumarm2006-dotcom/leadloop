const mongoose = require('mongoose');

/**
 * WorkspaceGrant — a cross-workspace access grant (Phase 1 / F3).
 *
 * Lets Workspace A ("grantor", `workspaceId`) hand a named user in Workspace B
 * (`granteeUserId`) read or write access to a single board, or to an entire
 * workspace, without making them a member. This is what makes cross-workspace
 * `connect_boards` links (F2) legal: both sides resolve when an active,
 * non-expired grant exists.
 *
 *   resourceType: 'board'      → resourceId is a Board._id
 *   resourceType: 'workspace'  → resourceId is an Organisation._id (all boards)
 *   role:         'viewer'     → read-only
 *   role:         'editor'     → read + write
 *   expiresAt:    null         → never expires; a Date → inactive once passed
 *
 * Consumed by `requireResourceAccess` (middleware/roleCheck.js) and the F2
 * connectable / link / mirror paths. Cleaned up by orgCascade on workspace
 * delete (both as grantor and as the granted resource).
 */
// 'folder' (Phase 3.2) → resourceId is a Workspace._id (the folder layer); the
// grant covers every board inside that folder.
const RESOURCE_TYPES = ['board', 'workspace', 'folder'];
const GRANT_ROLES = ['viewer', 'editor'];

const workspaceGrantSchema = new mongoose.Schema({
  // Grantor workspace (the one that owns the shared resource).
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organisation',
    required: true,
  },
  resourceType: {
    type: String,
    enum: RESOURCE_TYPES,
    required: true,
  },
  // Board._id when resourceType === 'board'; Organisation._id when 'workspace'.
  resourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  // The external user receiving access.
  granteeUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  role: {
    type: String,
    enum: GRANT_ROLES,
    default: 'viewer',
  },
  expiresAt: {
    type: Date,
    default: null,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// "What is shared with me?" — the navbar + shared-with-me endpoint.
workspaceGrantSchema.index({ granteeUserId: 1, resourceType: 1 });
// "What has this workspace shared out?" — the grants admin table + cascade.
workspaceGrantSchema.index({ workspaceId: 1 });
// "Who can reach this board/workspace?" — resource-side cascade + access checks.
workspaceGrantSchema.index({ resourceId: 1 });

workspaceGrantSchema.statics.RESOURCE_TYPES = RESOURCE_TYPES;
workspaceGrantSchema.statics.GRANT_ROLES = GRANT_ROLES;

const WorkspaceGrant = mongoose.model('WorkspaceGrant', workspaceGrantSchema);
WorkspaceGrant.RESOURCE_TYPES = RESOURCE_TYPES;
WorkspaceGrant.GRANT_ROLES = GRANT_ROLES;

module.exports = WorkspaceGrant;
