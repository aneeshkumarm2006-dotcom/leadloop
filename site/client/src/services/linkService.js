import api from './api';

/**
 * linkService — cross-board connectivity endpoints (F2).
 *
 * Wraps the link / unlink / mirror / connectable routes. Mirrors the shape of
 * columnService / taskService so the board store can consume it the same way.
 */

/**
 * GET /api/boards/:id/connectable — boards a connect_boards column on this
 * board may target (same workspace; F3 adds granted boards). Each entry is
 * `{ board, workspace }` and `board.columns` is included for source-column
 * pickers.
 */
export const getConnectableBoards = async (boardId) => {
  const { data } = await api.get(`/api/boards/${boardId}/connectable`);
  return data.connectable;
};

/**
 * POST /api/tasks/:id/links/:columnId — add a link to a connect_boards column.
 * Returns `{ value: { links }, links }`.
 */
export const linkTask = async (taskId, columnId, { targetTaskId, targetBoardId }) => {
  const { data } = await api.post(`/api/tasks/${taskId}/links/${columnId}`, {
    targetTaskId,
    targetBoardId,
  });
  return data;
};

/**
 * DELETE /api/tasks/:id/links/:columnId/:targetTaskId — remove a link.
 * Returns `{ value: { links }, links }`.
 */
export const unlinkTask = async (taskId, columnId, targetTaskId) => {
  const { data } = await api.delete(
    `/api/tasks/${taskId}/links/${columnId}/${targetTaskId}`
  );
  return data;
};

/**
 * GET /api/tasks/:id/mirror/:columnId — the computed mirror value.
 */
export const getMirror = async (taskId, columnId) => {
  const { data } = await api.get(`/api/tasks/${taskId}/mirror/${columnId}`);
  return data.value;
};
