import api from './api';

/**
 * GET /api/boards/:boardId/automations — list automations for a board.
 */
export const listAutomations = async (boardId) => {
  const { data } = await api.get(`/api/boards/${boardId}/automations`);
  return data.automations;
};

/**
 * POST /api/boards/:boardId/automations — create a new automation (admin only).
 */
export const createAutomation = async (boardId, payload) => {
  const { data } = await api.post(`/api/boards/${boardId}/automations`, payload);
  return data.automation;
};

/**
 * PUT /api/automations/:id — update an automation (admin only).
 */
export const updateAutomation = async (id, payload) => {
  const { data } = await api.put(`/api/automations/${id}`, payload);
  return data.automation;
};

/**
 * DELETE /api/automations/:id — delete an automation (admin only).
 */
export const deleteAutomation = async (id) => {
  const { data } = await api.delete(`/api/automations/${id}`);
  return data;
};

/**
 * POST /api/automations/:id/run-now — fire an automation immediately,
 * spawning one task. Updates lastRunAt but not nextRunAt.
 */
export const runAutomationNow = async (id) => {
  const { data } = await api.post(`/api/automations/${id}/run-now`);
  return data;
};

/**
 * GET /api/automations/:id/run-log — last 20 firings (most-recent-first) from
 * the automation's triggerHistory. Member-level access. (F4.6)
 */
export const getRunLog = async (id) => {
  const { data } = await api.get(`/api/automations/${id}/run-log`);
  return data.runLog || [];
};

/**
 * GET /api/automations/action-catalog — the F5 action registry
 * (`[{ type, configSchema, requires, disabled }]`). Drives the action picker;
 * `disabled` entries render greyed with "Available after Phase 3". (F5.7)
 */
export const getActionCatalog = async () => {
  const { data } = await api.get('/api/automations/action-catalog');
  return data.catalog || [];
};

/**
 * GET /api/automations/:id/run-log/actions — per-action AutomationRunLog audit
 * rows for one automation (most-recent-first). Member-level access. (F5.3)
 */
export const getActionRunLog = async (id) => {
  const { data } = await api.get(`/api/automations/${id}/run-log/actions`);
  return data.runLog || [];
};

/**
 * GET /api/automations/recipes — the F6 recipe catalogue. Optional `region`
 * filters to region-agnostic recipes plus those tagged for that region. Each
 * recipe carries a `requiresSetup` / `triggerDormant` summary. (F6.4)
 */
export const listRecipes = async (region) => {
  const { data } = await api.get('/api/automations/recipes', {
    params: region ? { region } : undefined,
  });
  return data.recipes || [];
};

/**
 * POST /api/automations/from-recipe/:slug — clone a recipe into a new, disabled
 * Automation on a board (admin). `payload = { boardId, overrides? }`. Returns
 * `{ automation, validation, warnings }`. (F6.4)
 */
export const createFromRecipe = async (slug, payload) => {
  const { data } = await api.post(`/api/automations/from-recipe/${slug}`, payload);
  return data;
};

/**
 * GET /api/automations/hub?orgId=… — account-wide list of every automation
 * across the org's boards + health stats (admin only). (Phase 1b)
 */
export const getHub = async (orgId) => {
  const { data } = await api.get('/api/automations/hub', { params: { orgId } });
  return data; // { automations, boards, stats }
};

/**
 * GET /api/automations/usage?orgId=…&from&to — run-log observability aggregates
 * for the org over a date range (admin only). (Phase 1b)
 */
export const getUsage = async (orgId, { from, to } = {}) => {
  const { data } = await api.get('/api/automations/usage', { params: { orgId, from, to } });
  return data;
};

/**
 * GET /api/automations/connections?orgId=… — real connected-status for each
 * native channel + its manage link (admin only). (Phase 1b §1b.4)
 */
export const getConnections = async (orgId) => {
  const { data } = await api.get('/api/automations/connections', { params: { orgId } });
  return data.channels;
};

// "Describe it" — AI draft from plain language. Returns { draft } | { fallback }.
// opts may carry { provider, model } to override the user's saved drafter model.
export const draftAutomation = async (text, opts = {}) => {
  const { data } = await api.post('/api/automations/draft', { text, ...opts });
  return data;
};
