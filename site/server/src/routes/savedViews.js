const express = require('express');
const authMiddleware = require('../middleware/auth');
const { list, create, update, remove } = require('../controllers/savedViewController');

/**
 * Saved table view routes (Phase 4, F13.4). All authed; member gating (reads/
 * create) + owner gating (update/delete) live in the controller. Mounted under
 * `/api` in app.js so paths resolve as `/api/boards/:id/saved-views` and
 * `/api/saved-views/:id`.
 */
const router = express.Router();

router.use(authMiddleware);

router.get('/boards/:id/saved-views', list);
router.post('/boards/:id/saved-views', create);
router.patch('/saved-views/:id', update);
router.delete('/saved-views/:id', remove);

module.exports = router;
