import { create } from 'zustand';
import * as notificationService from '../services/notificationService';

/**
 * useNotificationStore — tracks the current user's in-app notifications.
 *
 * Data is pulled via `fetchNotifications` on page load and after key
 * actions (task assign, comment add, status change). No WebSockets in v1,
 * so this is the only freshness mechanism.
 */
const useNotificationStore = create((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  error: null,

  /**
   * Pull the latest 50 notifications + unread count from the backend,
   * scoped to the supplied organisation. Pass null/undefined to fetch
   * unfiltered (legacy callers without org context).
   *
   * Silent on failure — the bell should never block the UI.
   */
  fetchNotifications: async (orgId) => {
    set({ loading: true, error: null });
    try {
      const { notifications, unreadCount } =
        await notificationService.getNotifications(orgId);
      set({
        notifications: notifications || [],
        unreadCount: unreadCount || 0,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: err });
    }
  },

  /**
   * Optimistically mark a single notification as read, then sync to server.
   * Rolls back on failure.
   */
  markRead: async (id) => {
    const prev = get().notifications;
    const prevUnread = get().unreadCount;
    const target = prev.find((n) => n._id === id);
    if (!target || target.isRead) return;
    set({
      notifications: prev.map((n) =>
        n._id === id ? { ...n, isRead: true } : n
      ),
      unreadCount: Math.max(0, prevUnread - 1),
    });
    try {
      await notificationService.markAsRead(id);
    } catch (err) {
      // Roll back on failure
      set({ notifications: prev, unreadCount: prevUnread });
      throw err;
    }
  },

  /**
   * Optimistically mark every unread notification as read. Scoped to the
   * supplied org so the bulk update on the server matches the org the user
   * is currently viewing.
   */
  markAllRead: async (orgId) => {
    const prev = get().notifications;
    const prevUnread = get().unreadCount;
    if (prevUnread === 0) return;
    set({
      notifications: prev.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    });
    try {
      await notificationService.markAllAsRead(orgId);
    } catch (err) {
      set({ notifications: prev, unreadCount: prevUnread });
      throw err;
    }
  },

  /**
   * Optimistically remove a notification from the list, then sync to server.
   * Rolls back on failure.
   */
  deleteNotification: async (id) => {
    const prev = get().notifications;
    const prevUnread = get().unreadCount;
    const target = prev.find((n) => n._id === id);
    set({
      notifications: prev.filter((n) => n._id !== id),
      unreadCount: target && !target.isRead
        ? Math.max(0, prevUnread - 1)
        : prevUnread,
    });
    try {
      await notificationService.deleteNotification(id);
    } catch (err) {
      set({ notifications: prev, unreadCount: prevUnread });
      throw err;
    }
  },

  clear: () => set({ notifications: [], unreadCount: 0, error: null }),
}));

export default useNotificationStore;
