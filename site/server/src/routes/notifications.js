const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} = require('../controllers/notificationController');

const router = express.Router();

// All notification routes require authentication
router.use(authMiddleware);

// GET    /api/notifications               — list user notifications (latest 50)
// PUT    /api/notifications/read-all      — mark all as read (must come before :id)
// PUT    /api/notifications/:id/read      — mark a single notification as read
// DELETE /api/notifications/:id           — delete a single notification
router.get('/', getNotifications);
router.put('/read-all', markAllAsRead);
router.put('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);

module.exports = router;
