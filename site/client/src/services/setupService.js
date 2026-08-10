import api from './api';

/**
 * setupService — first-run wizard profile + the derived setup checklist.
 *
 * The checklist is computed on the SERVER from real workspace data (boards,
 * members, lead sources), so it is shared by the whole team and survives a new
 * device — unlike the old localStorage tour flag.
 */

/** GET /api/orgs/:id/setup — { profile, checklist, isAdmin }. */
export const getSetup = async (orgId) => {
  const { data } = await api.get(`/api/orgs/${orgId}/setup`);
  return data;
};

/** PATCH /api/orgs/:id/setup/profile — save wizard answers (admin). */
export const updateProfile = async (orgId, payload) => {
  const { data } = await api.patch(`/api/orgs/${orgId}/setup/profile`, payload);
  return data.profile;
};

/** POST /api/orgs/:id/setup/complete — mark the wizard finished (admin). */
export const completeWizard = async (orgId) => {
  const { data } = await api.post(`/api/orgs/${orgId}/setup/complete`);
  return data;
};

/** POST /api/orgs/:id/setup/dismiss — hide or restore the checklist (admin). */
export const dismissChecklist = async (orgId, dismissed = true) => {
  const { data } = await api.post(`/api/orgs/${orgId}/setup/dismiss`, { dismissed });
  return data.dismissed;
};

/** POST /api/orgs/:id/setup/step — tick a step with no server-side signal. */
export const markStep = async (orgId, stepId, done = true) => {
  const { data } = await api.post(`/api/orgs/${orgId}/setup/step`, { stepId, done });
  return data.checklist;
};

// --- Sample data ("Show me how it works") ----------------------------------

/** GET — how many demo leads exist in this workspace. */
export const getSampleData = async (orgId) => {
  const { data } = await api.get(`/api/orgs/${orgId}/setup/sample`);
  return data.sampleCount;
};

/** POST — seed demo leads onto a board (defaults to the first board). */
export const addSampleData = async (orgId, boardId) => {
  const { data } = await api.post(`/api/orgs/${orgId}/setup/sample`, boardId ? { boardId } : {});
  return data; // { created, sampleCount, boardId }
};

/** DELETE — remove every demo lead in the workspace. */
export const clearSampleData = async (orgId) => {
  const { data } = await api.delete(`/api/orgs/${orgId}/setup/sample`);
  return data.removed;
};
