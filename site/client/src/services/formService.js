import api from './api';

/**
 * formService.js — client wrapper for the F13 form endpoints.
 *
 * Board-scoped management goes through the authed `api` client. The public
 * render/submit calls (`/f/:slug`, `/f/:slug/submit`) are unauthenticated — the
 * `/f/` path is in api.js's PUBLIC_PATHS bypass so no Bearer token is attached
 * (a logged-out visitor or an embedded form must work without one).
 */

// --- Admin / board-scoped management ---------------------------------------

/** GET /api/boards/:boardId/forms — list a board's forms (member). */
export const listForms = async (boardId) => {
  const { data } = await api.get(`/api/boards/${boardId}/forms`);
  return data.forms || [];
};

/** GET /api/forms/:id — full form config for the builder's edit mode (admin). */
export const getForm = async (id) => {
  const { data } = await api.get(`/api/forms/${id}`);
  return data.form;
};

/** POST /api/boards/:boardId/forms — create a form (admin). */
export const createForm = async (boardId, payload) => {
  const { data } = await api.post(`/api/boards/${boardId}/forms`, payload);
  return data.form;
};

/** PATCH /api/forms/:id — update a form (admin). */
export const updateForm = async (id, payload) => {
  const { data } = await api.patch(`/api/forms/${id}`, payload);
  return data.form;
};

/** DELETE /api/forms/:id — remove a form (admin, 204). */
export const deleteForm = async (id) => {
  await api.delete(`/api/forms/${id}`);
  return true;
};

// --- Public (unauthenticated) ----------------------------------------------

/** GET /f/:slug — public form config (no auth). Throws 404 if missing/disabled. */
export const getPublicForm = async (slug) => {
  const { data } = await api.get(`/f/${slug}`);
  return data.form;
};

/**
 * POST /f/:slug/submit — submit a public form (no auth, rate-limited).
 * `payload` is `{ [formFieldId]: value }`; `turnstileToken` is the optional
 * `cf-turnstile-response`. Returns `{ ok, taskId, redirectUrl, welcomeMessage, warnings }`.
 */
export const submitPublicForm = async (slug, payload, turnstileToken) => {
  const body = { payload };
  if (turnstileToken) body['cf-turnstile-response'] = turnstileToken;
  const { data } = await api.post(`/f/${slug}/submit`, body);
  return data;
};
