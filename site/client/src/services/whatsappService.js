import api from './api';

/**
 * whatsappService.js — client wrapper for the F11 WhatsApp endpoints. All calls
 * go through the authed `api` client; the public Twilio inbound/status callbacks
 * are hit by Twilio, not by this app.
 */

// --- Workspace WhatsApp config (admin) -------------------------------------

/** GET /api/workspaces/:id/whatsapp/config — redacted config (token never sent). */
export const getConfig = async (workspaceId) => {
  const { data } = await api.get(`/api/workspaces/${workspaceId}/whatsapp/config`);
  return data.config;
};

/**
 * PUT /api/workspaces/:id/whatsapp/config — upsert. The Auth Token is write-only:
 * include `authToken` only to set/replace it; omit it to leave the stored one.
 */
export const saveConfig = async (workspaceId, payload) => {
  const { data } = await api.put(`/api/workspaces/${workspaceId}/whatsapp/config`, payload);
  return data.config;
};

// --- Templates -------------------------------------------------------------

/** GET /api/workspaces/:id/whatsapp/templates — the synced templates (member). */
export const listTemplates = async (workspaceId) => {
  const { data } = await api.get(`/api/workspaces/${workspaceId}/whatsapp/templates`);
  return data.templates || [];
};

/** POST /api/workspaces/:id/whatsapp/templates/sync — pull from Twilio (admin). */
export const syncTemplates = async (workspaceId) => {
  const { data } = await api.post(`/api/workspaces/${workspaceId}/whatsapp/templates/sync`);
  return data;
};

// --- Task WhatsApp thread --------------------------------------------------

/** GET /api/tasks/:taskId/whatsapp — thread + 24h window state. */
export const listTaskWhatsApp = async (taskId) => {
  const { data } = await api.get(`/api/tasks/${taskId}/whatsapp`);
  return data; // { messages, windowOpen, lastInboundAt }
};

/**
 * POST /api/tasks/:taskId/whatsapp — send a manual WhatsApp message.
 * payload: { body?, templateId?, variables?, mediaUrl?, to? }.
 */
export const sendTaskWhatsApp = async (taskId, payload) => {
  const { data } = await api.post(`/api/tasks/${taskId}/whatsapp`, payload);
  return data; // { message, windowOpen }
};

/** POST /api/whatsapp/media — upload an attachment, returns { url, name, mime, size }. */
export const uploadMedia = async (file) => {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/api/whatsapp/media', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};
