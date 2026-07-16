import api from './api';

/**
 * GET /api/tasks/:taskId/activity
 *
 * @param {string} taskId
 * @param {object} [opts]
 * @param {string} [opts.cursor] - ISO timestamp returned as `nextCursor` from a previous page
 * @param {number} [opts.limit]  - page size (defaults to 50 on the server)
 * @param {string} [opts.actor]  - filter by actor user id
 * @param {string} [opts.type]   - filter by activity type
 * @returns {Promise<{ items: object[], nextCursor: string | null }>}
 */
export const getActivity = async (taskId, opts = {}) => {
  const params = {};
  if (opts.cursor) params.cursor = opts.cursor;
  if (opts.limit) params.limit = opts.limit;
  if (opts.actor) params.actor = opts.actor;
  if (opts.type) params.type = opts.type;
  const { data } = await api.get(`/api/tasks/${taskId}/activity`, { params });
  return data;
};
