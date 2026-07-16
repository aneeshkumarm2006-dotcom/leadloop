const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  list,
  create,
  update,
  remove,
  events,
} = require('../controllers/calendarViewController');

/**
 * Calendar view routes (Phase 4, F12.3). All authed; ownership / shared-admin
 * gating + the F3 board access check for `events` live in the controller.
 * Mounted under `/api` in app.js so paths resolve as `/api/calendar-views…`.
 */
const router = express.Router();

router.use(authMiddleware);

router.get('/calendar-views', list);
router.post('/calendar-views', create);
// `:id/events` is registered before the bare `:id` param routes for clarity;
// Express matches the more specific path first either way.
router.get('/calendar-views/:id/events', events);
router.patch('/calendar-views/:id', update);
router.delete('/calendar-views/:id', remove);

module.exports = router;
