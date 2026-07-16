import api from './api';

/**
 * savedViewService.js — client wrapper for the F13 saved table view endpoints
 * (per-user, board-scoped). The view shape carries the shared filter shape
 * `[{ columnId, op, value }]` plus `groupBy`, `sort: [{ columnId, dir }]`, and
 * `visibleColumnIds`.
 */

/** GET /api/boards/:boardId/saved-views — the caller's own views for a board. */
export const listSavedViews = async (boardId) => {
  const { data } = await api.get(`/api/boards/${boardId}/saved-views`);
  return data.views || [];
};

/** POST /api/boards/:boardId/saved-views — create a saved view. */
export const createSavedView = async (boardId, payload) => {
  const { data } = await api.post(`/api/boards/${boardId}/saved-views`, payload);
  return data.view;
};

/** PATCH /api/saved-views/:id — update a saved view (owner). */
export const updateSavedView = async (id, payload) => {
  const { data } = await api.patch(`/api/saved-views/${id}`, payload);
  return data.view;
};

/** DELETE /api/saved-views/:id — remove a saved view (owner, 204). */
export const deleteSavedView = async (id) => {
  await api.delete(`/api/saved-views/${id}`);
  return true;
};
