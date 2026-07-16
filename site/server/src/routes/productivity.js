const express = require('express');
const authMiddleware = require('../middleware/auth');
const { getProductivity } = require('../controllers/productivityController');

const router = express.Router();

router.use(authMiddleware);

// GET /api/productivity?org=:orgId&range=:range
router.get('/', getProductivity);

module.exports = router;
