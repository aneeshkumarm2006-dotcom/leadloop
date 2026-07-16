const express = require('express');
const authMiddleware = require('../middleware/auth');
const { getActivity } = require('../controllers/activityController');

const router = express.Router();

router.use(authMiddleware);

// GET /api/tasks/:taskId/activity?cursor=&limit=&actor=&type=
router.get('/tasks/:taskId/activity', getActivity);

module.exports = router;
