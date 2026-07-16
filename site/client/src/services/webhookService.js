import api from './api';

/**
 * webhookService.js — client wrapper for the F7 webhook endpoints (admin,
 * board-scoped). All calls go through the authed `api` client; the public
 * inbound ingress (`/api/webhooks/in/:token`) is hit by external systems, not
 * by this app, so it has no wrapper here.
 */

/** GET /api/boards/:boardId/webhooks — list inbound + outbound endpoints. */
export const listEndpoints = async (boardId) => {
  const { data } = await api.get(`/api/boards/${boardId}/webhooks`);
  return data.endpoints || [];
};

/**
 * POST /api/boards/:boardId/webhooks — create an endpoint.
 * payload: { direction: 'in'|'out', url?, mapping?, eventTypes? }
 */
export const createEndpoint = async (boardId, payload) => {
  const { data } = await api.post(`/api/boards/${boardId}/webhooks`, payload);
  return data.endpoint;
};

/** PUT /api/boards/:boardId/webhooks/:wid — update mapping / url / enabled. */
export const updateEndpoint = async (boardId, wid, payload) => {
  const { data } = await api.put(`/api/boards/${boardId}/webhooks/${wid}`, payload);
  return data.endpoint;
};

/** DELETE /api/boards/:boardId/webhooks/:wid — remove an endpoint (204). */
export const deleteEndpoint = async (boardId, wid) => {
  await api.delete(`/api/boards/${boardId}/webhooks/${wid}`);
  return true;
};

/**
 * POST /api/boards/:boardId/webhooks/:wid/test — synthetic delivery.
 * Outbound → returns { direction:'out', delivery }. Inbound dry-run → pass
 * `{ sample }` and get back { direction:'in', columnValues, missing }.
 */
export const testEndpoint = async (boardId, wid, body = {}) => {
  const { data } = await api.post(`/api/boards/${boardId}/webhooks/${wid}/test`, body);
  return data;
};

/** GET /api/boards/:boardId/webhooks/:wid/deliveries — recent delivery log. */
export const listDeliveries = async (boardId, wid, limit = 50) => {
  const { data } = await api.get(
    `/api/boards/${boardId}/webhooks/${wid}/deliveries`,
    { params: { limit } }
  );
  return data.deliveries || [];
};
