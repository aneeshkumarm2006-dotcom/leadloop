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
