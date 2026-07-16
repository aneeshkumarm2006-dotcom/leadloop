import api from './api';

/**
 * emailService.js — client wrapper for the F8 email + email-account endpoints.
 * (Distinct from the server-side service of the same name.) All calls go through
 * the authed `api` client; the public tracking pixels + OAuth callback are hit
 * by mail clients / the browser redirect, not by this app.
 */

// --- Connected mailboxes ---------------------------------------------------

/** GET /api/email-accounts?workspaceId= — the current user's mailboxes. */
export const listAccounts = async (workspaceId) => {
  const { data } = await api.get('/api/email-accounts', {
    params: workspaceId ? { workspaceId } : {},
  });
  return data.accounts || [];
};

/**
 * POST /api/email-accounts/connect/:provider → { url }. Returns the provider
 * consent URL the caller should redirect the browser to.
 */
export const connectProvider = async (provider, workspaceId) => {
  const { data } = await api.post(`/api/email-accounts/connect/${provider}`, { workspaceId });
  return data.url;
};

/** DELETE /api/email-accounts/:id — disconnect a mailbox. */
export const disconnectAccount = async (accountId) => {
  await api.delete(`/api/email-accounts/${accountId}`);
  return true;
};

// --- Task email thread -----------------------------------------------------

/** GET /api/tasks/:taskId/emails — the task's email thread. */
export const listTaskEmails = async (taskId) => {
  const { data } = await api.get(`/api/tasks/${taskId}/emails`);
  return data.emails || [];
};

/**
 * POST /api/tasks/:taskId/emails — compose + send.
 * payload: { to:[], cc?:[], bcc?:[], subject, body, attachments?, inReplyTo?, threadId? }
 */
export const sendTaskEmail = async (taskId, payload) => {
  const { data } = await api.post(`/api/tasks/${taskId}/emails`, payload);
  return data;
};

/** POST /api/emails/attachments — upload a file, returns { url, name, mime, size }. */
export const uploadAttachment = async (file) => {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/api/emails/attachments', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.attachment;
};
