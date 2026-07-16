const express = require('express');
const authMiddleware = require('../middleware/auth');
const { requireOrgAdmin, requireOrgOwner } = require('../middleware/roleCheck');
const {
  createOrg,
  getOrg,
  joinOrg,
  listMembers,
  removeMember,
  changeRole,
  regenerateInvite,
  sendInvite,
  deleteOrg,
} = require('../controllers/orgController');
const {
  listGrants,
  createGrant,
  deleteGrant,
  getSharedWithMe,
} = require('../controllers/grantController');

const router = express.Router();

// All org/workspace routes require authentication. This router is mounted under
// BOTH /api/orgs and /api/workspaces (F3 surface rename — the collection stays
// `organisations`; the API exposes "Workspace").
router.use(authMiddleware);

// Create org
router.post('/', createOrg);

// Join via invite code
router.post('/join/:inviteCode', joinOrg);

// Boards/workspaces shared TO the current user via a grant.
// Must come BEFORE /:id so "shared-with-me" isn't parsed as a workspace id.
router.get('/shared-with-me', getSharedWithMe);

// Get org details
router.get('/:id', getOrg);

// List members
router.get('/:id/members', listMembers);

// Remove member (admin only)
router.delete('/:id/members/:userId', requireOrgAdmin, removeMember);

// Change member role (admin only)
router.put('/:id/members/:userId/role', requireOrgAdmin, changeRole);

// Regenerate invite code (admin only)
router.post('/:id/regenerate-invite', requireOrgAdmin, regenerateInvite);

// Send invite email (admin only)
router.post('/:id/send-invite', requireOrgAdmin, sendInvite);

// --- Cross-workspace grants (F3) ------------------------------------------
// All admin-only. `:id` is the grantor workspace.
router.get('/:id/grants', requireOrgAdmin, listGrants);
router.post('/:id/grants', requireOrgAdmin, createGrant);
router.delete('/:id/grants/:gid', requireOrgAdmin, deleteGrant);

// Delete the organisation (owner only — primary admin, not extra admins)
router.delete('/:id', requireOrgOwner, deleteOrg);

module.exports = router;
