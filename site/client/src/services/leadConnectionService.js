import api from './api';

/**
 * leadConnectionService.js — client wrapper for the F14 lead-connection (API
 * key) endpoints. All board-scoped management goes through the authed `api`
 * client. The public ingest endpoint (`POST /api/leads/ingest`) is called
 * server-to-server by the customer's own website — never from this client — so
 * there is no wrapper for it here.
 */

/** GET /api/boards/:boardId/lead-connections — list a board's API keys (member). */
export const listConnections = async (boardId) => {
  const { data } = await api.get(`/api/boards/${boardId}/lead-connections`);
  return data.connections || [];
};

/**
 * POST /api/boards/:boardId/lead-connections — create a key (admin).
 * Returns `{ connection, apiKey }`; `apiKey` (plaintext) is shown ONCE.
 */
export const createConnection = async (boardId, payload = {}) => {
  const { data } = await api.post(`/api/boards/${boardId}/lead-connections`, payload);
  return data; // { connection, apiKey }
};

/**
 * POST /api/lead-connections/:cid/rotate — mint a new key (admin).
 * Returns `{ connection, apiKey }`; the old key stops working immediately.
 */
export const rotateKey = async (cid) => {
  const { data } = await api.post(`/api/lead-connections/${cid}/rotate`);
  return data; // { connection, apiKey }
};

/** PATCH /api/lead-connections/:cid — update name / enabled / source config (admin). */
export const updateConnection = async (cid, payload) => {
  const { data } = await api.patch(`/api/lead-connections/${cid}`, payload);
  return data.connection;
};

/**
 * POST /api/lead-connections/:cid/reset-schema — forget the locked schema so the
 * next submission re-defines the columns (admin). Existing board columns are
 * left intact.
 */
export const resetSchema = async (cid) => {
  const { data } = await api.post(`/api/lead-connections/${cid}/reset-schema`);
  return data.connection;
};

/** DELETE /api/lead-connections/:cid — remove a key (admin, 204). */
export const deleteConnection = async (cid) => {
  await api.delete(`/api/lead-connections/${cid}`);
  return true;
};

/** GET /api/lead-connections/:cid/submissions — recent ingest log (member). */
export const listSubmissions = async (cid, limit = 25) => {
  const { data } = await api.get(`/api/lead-connections/${cid}/submissions`, { params: { limit } });
  return data.submissions || [];
};
