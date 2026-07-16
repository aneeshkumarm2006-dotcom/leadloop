const express = require('express');
const authMiddleware = require('../middleware/auth');
const { getAnalytics } = require('../controllers/analyticsController');

const router = express.Router();

router.use(authMiddleware);

// GET /api/analytics?org=:orgId&board=:boardId&range=:range
router.get('/', getAnalytics);

module.exports = router;
