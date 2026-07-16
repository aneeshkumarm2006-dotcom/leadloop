import api from './api';

/**
 * smsService.js — client wrapper for the F10 SMS endpoints. All calls go through
 * the authed `api` client; the public Twilio inbound/status callbacks are hit by
 * Twilio, not by this app.
 */

// --- Workspace SMS config (admin) ------------------------------------------

/** GET /api/workspaces/:id/sms-config — the redacted config (token never sent). */
export const getSmsConfig = async (workspaceId) => {
  const { data } = await api.get(`/api/workspaces/${workspaceId}/sms-config`);
  return data.config;
};

/**
 * PUT /api/workspaces/:id/sms-config — upsert. The Auth Token is write-only:
 * include `authToken` only to set/replace it; omit it to leave the stored one.
 */
export const saveSmsConfig = async (workspaceId, payload) => {
  const { data } = await api.put(`/api/workspaces/${workspaceId}/sms-config`, payload);
  return data.config;
};

/** GET /api/workspaces/:id/sms-opt-outs — numbers that have replied STOP. */
export const listOptOuts = async (workspaceId) => {
  const { data } = await api.get(`/api/workspaces/${workspaceId}/sms-opt-outs`);
  return data.optOuts || [];
};

// --- Task SMS thread -------------------------------------------------------

/** GET /api/tasks/:taskId/sms — the task's SMS conversation. */
export const listTaskSms = async (taskId) => {
  const { data } = await api.get(`/api/tasks/${taskId}/sms`);
  return data.messages || [];
};

/** POST /api/tasks/:taskId/sms — send a manual SMS. payload: { body, to? }. */
export const sendTaskSms = async (taskId, payload) => {
  const { data } = await api.post(`/api/tasks/${taskId}/sms`, payload);
  return data.message;
};
