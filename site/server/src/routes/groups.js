const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  getGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  reorderGroups,
} = require('../controllers/groupController');

const router = express.Router();

// All group routes require authentication
router.use(authMiddleware);

// Board-scoped
// GET    /api/boards/:boardId/groups — list groups for a board
// POST   /api/boards/:boardId/groups — create a group (admin-only)
router.get('/boards/:boardId/groups', getGroups);
router.post('/boards/:boardId/groups', createGroup);
// PUT    /api/boards/:boardId/groups/reorder — batch reorder groups
router.put('/boards/:boardId/groups/reorder', reorderGroups);

// Group-scoped
// PUT    /api/groups/:id  — update a group (admin-only)
// DELETE /api/groups/:id  — delete group + cascade (admin-only)
router.put('/groups/:id', updateGroup);
router.delete('/groups/:id', deleteGroup);

module.exports = router;
