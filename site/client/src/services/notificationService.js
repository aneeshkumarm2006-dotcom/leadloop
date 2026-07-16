import api from './api';

/**
 * GET /api/notifications — latest 50 notifications for the current user.
 * Returns { notifications, unreadCount }.
 *
 * When `orgId` is supplied, the server scopes the response to that org
 * (plus personal-task notifications). Omit to fall back to the legacy
 * unfiltered view.
 */
export const getNotifications = async (orgId) => {
  const params = orgId ? { org: orgId } : undefined;
  const { data } = await api.get('/api/notifications', { params });
  return data;
};

/**
 * PUT /api/notifications/:id/read — mark a single notification as read.
 */
export const markAsRead = async (id) => {
  const { data } = await api.put(`/api/notifications/${id}/read`);
  return data.notification;
};

/**
 * PUT /api/notifications/read-all — mark every unread notification as read.
 * When `orgId` is supplied, only notifications for that org (plus
 * personal-task notifications) are affected.
 */
export const markAllAsRead = async (orgId) => {
  const params = orgId ? { org: orgId } : undefined;
  const { data } = await api.put('/api/notifications/read-all', null, { params });
  return data;
};

/**
 * DELETE /api/notifications/:id — delete a single notification.
 */
export const deleteNotification = async (id) => {
  const { data } = await api.delete(`/api/notifications/${id}`);
  return data;
};
