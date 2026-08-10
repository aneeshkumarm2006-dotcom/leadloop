/** push.js — Web Push device registration (all authed). */
const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  getKey, subscribe, unsubscribe, updatePrefs, status, sendTest,
} = require('../controllers/pushController');

const router = express.Router();
router.use(authMiddleware);

router.get('/push/key', getKey);
router.get('/push/status', status);
router.post('/push/subscribe', subscribe);
router.post('/push/unsubscribe', unsubscribe);
router.put('/push/prefs', updatePrefs);
router.post('/push/test', sendTest);

module.exports = router;
