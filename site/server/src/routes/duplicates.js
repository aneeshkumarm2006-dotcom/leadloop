/**
 * duplicates.js — the duplicate-lead queue. All routes authed; the controller
 * additionally requires workspace admin for the two resolving actions, since
 * merging permanently removes one of the two leads.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  listDuplicates,
  mergeDuplicate,
  dismissDuplicate,
} = require('../controllers/duplicateController');

const router = express.Router();
router.use(authMiddleware);

router.get('/duplicates', listDuplicates);
router.post('/duplicates/:id/merge', mergeDuplicate);
router.post('/duplicates/:id/dismiss', dismissDuplicate);

module.exports = router;
