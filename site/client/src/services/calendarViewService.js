import api from './api';

/**
 * calendarViewService — wraps the F12 saved calendar view endpoints.
 *
 *   GET    /api/calendar-views?workspaceId=         listViews
 *   POST   /api/calendar-views                      createView
 *   PATCH  /api/calendar-views/:id                  updateView
 *   DELETE /api/calendar-views/:id                  deleteView
 *   GET    /api/calendar-views/:id/events?from=&to= getEvents
 *
 * The shared filter shape is `[{ columnId, op: 'eq'|'in'|'between', value }]`.
 */

export const listViews = async (workspaceId) => {
  const { data } = await api.get('/api/calendar-views', {
    params: { workspaceId },
  });
  return data.views;
};

export const createView = async (payload) => {
  const { data } = await api.post('/api/calendar-views', payload);
  return data.view;
};

export const updateView = async (id, payload) => {
  const { data } = await api.patch(`/api/calendar-views/${id}`, payload);
  return data.view;
};

export const deleteView = async (id) => {
  const { data } = await api.delete(`/api/calendar-views/${id}`);
  return data;
};

/**
 * Fetch normalized events for a view within an optional date range.
 * Returns `{ events: [{ id, title, start, end, color, resourceId }],
 *            warning?: 'column_missing', resources?: [{ id, title }] }`.
 */
export const getEvents = async (viewId, { from, to } = {}) => {
  const params = {};
  if (from) params.from = from instanceof Date ? from.toISOString() : from;
  if (to) params.to = to instanceof Date ? to.toISOString() : to;
  const { data } = await api.get(`/api/calendar-views/${viewId}/events`, {
    params,
  });
  return data; // { events, warning?, resources? }
};
