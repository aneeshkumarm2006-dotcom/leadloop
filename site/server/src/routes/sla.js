/** sla.js — the speed-to-lead response clock (authed; admin gate in controller). */
const express = require('express');
const authMiddleware = require('../middleware/auth');
const { getSla, updateSla } = require('../controllers/slaController');

const router = express.Router();
router.use(authMiddleware);
router.get('/sla', getSla);
router.put('/sla', updateSla);

module.exports = router;
