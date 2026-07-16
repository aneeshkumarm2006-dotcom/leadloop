const express = require('express');
const authMiddleware = require('../middleware/auth');
const { search } = require('../controllers/searchController');

const router = express.Router();

router.use(authMiddleware);

// GET /api/search?q=:query&org=:orgId
router.get('/', search);

module.exports = router;
