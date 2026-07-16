const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
} = require('../controllers/workspaceController');

/**
 * Workspace routes (Phase 3.0), nested under an organisation so they never
 * collide with the legacy `/api/workspaces` → orgs alias:
 *   GET    /api/orgs/:orgId/workspaces          list (member)
 *   POST   /api/orgs/:orgId/workspaces          create (admin)
 *   PATCH  /api/orgs/:orgId/workspaces/:wsId     rename/reorder (admin)
 *   DELETE /api/orgs/:orgId/workspaces/:wsId     delete (admin)
 *
 * Per-route membership/admin checks live in the controller (it already loads the
 * org), so this router only enforces authentication.
 */
const router = express.Router();
router.use(authMiddleware);

router.get('/:orgId/workspaces', listWorkspaces);
router.post('/:orgId/workspaces', createWorkspace);
router.patch('/:orgId/workspaces/:wsId', updateWorkspace);
router.delete('/:orgId/workspaces/:wsId', deleteWorkspace);

module.exports = router;
