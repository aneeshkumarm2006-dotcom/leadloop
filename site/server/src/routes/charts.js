const express = require('express');
const authMiddleware = require('../middleware/auth');
const { list, create, update, remove, data } = require('../controllers/chartController');

/**
 * Chart widget routes (Phase 4, F13.4). All authed; member gating (reads/data)
 * + workspace-admin gating (create/update/delete) live in the controller.
 * Mounted under `/api` in app.js so paths resolve as `/api/charts…`.
 */
const router = express.Router();

router.use(authMiddleware);

router.get('/charts', list);
router.post('/charts', create);
// `:id/data` is registered before the bare `:id` routes for clarity; Express
// matches the more specific path first either way.
router.get('/charts/:id/data', data);
router.patch('/charts/:id', update);
router.delete('/charts/:id', remove);

module.exports = router;
