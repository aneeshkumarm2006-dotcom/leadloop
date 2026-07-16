const express = require('express');
const authMiddleware = require('../middleware/auth');
const { getDashboardStats } = require('../controllers/boardController');

const router = express.Router();

router.use(authMiddleware);

// GET /api/dashboard/stats?org=:orgId
router.get('/stats', getDashboardStats);

module.exports = router;
