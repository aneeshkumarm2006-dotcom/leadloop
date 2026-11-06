import api from './api';

/**
 * adConversionService.js — client for ad-platform conversion settings (Meta
 * Conversions API, Google Ads) and the per-lead send log.
 */

/** GET — redacted settings (the Meta token is never returned). */
export const getAdConversions = async (workspaceId) => {
  const { data } = await api.get(`/api/workspaces/${workspaceId}/ad-conversions`);
  return data.config;
};

/** PUT — partial update. Include `meta.accessToken` only to set/replace it. */
export const saveAdConversions = async (workspaceId, payload) => {
  const { data } = await api.put(`/api/workspaces/${workspaceId}/ad-conversions`, payload);
  return data.config;
};

/** POST — send one Meta TEST event (shows under Events Manager → Test events). */
export const sendMetaTestEvent = async (workspaceId, testEventCode) => {
  const { data } = await api.post(`/api/workspaces/${workspaceId}/ad-conversions/meta/test`, { testEventCode });
  return data;
};

/** GET — latest sends across the workspace. */
export const listConversionEvents = async (workspaceId, limit = 30) => {
  const { data } = await api.get(`/api/workspaces/${workspaceId}/ad-conversions/events`, { params: { limit } });
  return data.events || [];
};

/** GET — sends for one lead. */
export const listTaskConversions = async (taskId) => {
  const { data } = await api.get(`/api/tasks/${taskId}/conversions`);
  return data.events || [];
};
