import api from './api';

/**
 * workspaceService — workspace (formerly "org") API wrapper (Phase 1 / F3).
 *
 * The existing org endpoints keep their `/api/orgs` paths (the router is mounted
 * under both `/api/orgs` and `/api/workspaces`); the F3 grant + sharing
 * endpoints use the new `/api/workspaces` surface. `orgService.js` re-exports
 * everything here so existing imports keep working for one release.
 */

export const createOrg = async (name) => {
  const { data } = await api.post('/api/orgs', { name });
  return data.org;
};

export const getOrg = async (orgId) => {
  const { data } = await api.get(`/api/orgs/${orgId}`);
  return data.org;
};

export const joinOrg = async (inviteCode) => {
  const { data } = await api.post(`/api/orgs/join/${inviteCode}`);
  return data.org;
};

export const listMembers = async (orgId) => {
  const { data } = await api.get(`/api/orgs/${orgId}/members`);
  return data; // { members, adminId, adminIds }
};

export const changeRole = async (orgId, userId, role) => {
  const { data } = await api.put(`/api/orgs/${orgId}/members/${userId}/role`, { role });
  return data; // { message, adminIds }
};

export const removeMember = async (orgId, userId) => {
  const { data } = await api.delete(`/api/orgs/${orgId}/members/${userId}`);
  return data;
};

export const regenerateInvite = async (orgId) => {
  const { data } = await api.post(`/api/orgs/${orgId}/regenerate-invite`);
  return data.inviteCode;
};

export const sendInvite = async (orgId, email) => {
  const { data } = await api.post(`/api/orgs/${orgId}/send-invite`, { email });
  return data;
};

export const deleteOrg = async (orgId) => {
  const { data } = await api.delete(`/api/orgs/${orgId}`);
  return data;
};

// --- Workspaces inside an organisation (Phase 3.0) -------------------------

/** GET /api/orgs/:orgId/workspaces — list workspaces in the org. */
export const listWorkspaces = async (orgId) => {
  const { data } = await api.get(`/api/orgs/${orgId}/workspaces`);
  return data.workspaces || [];
};

/** POST /api/orgs/:orgId/workspaces — create a workspace (admin). */
export const createWorkspace = async (orgId, name) => {
  const { data } = await api.post(`/api/orgs/${orgId}/workspaces`, { name });
  return data.workspace;
};

/** PATCH /api/orgs/:orgId/workspaces/:wsId — rename / reorder (admin). */
export const updateWorkspace = async (orgId, wsId, patch) => {
  const { data } = await api.patch(`/api/orgs/${orgId}/workspaces/${wsId}`, patch);
  return data.workspace;
};

/** DELETE /api/orgs/:orgId/workspaces/:wsId — delete (admin); boards move to default. */
export const deleteWorkspace = async (orgId, wsId) => {
  await api.delete(`/api/orgs/${orgId}/workspaces/${wsId}`);
};

// --- Cross-workspace grants (F3) ------------------------------------------

/**
 * GET /api/workspaces/:id/grants — grants this workspace has issued (admin).
 */
export const listGrants = async (workspaceId) => {
  const { data } = await api.get(`/api/workspaces/${workspaceId}/grants`);
  return data.grants;
};

/**
 * POST /api/workspaces/:id/grants — issue a grant (admin).
 * payload: { resourceType, resourceId, granteeUserId | granteeEmail, role, expiresAt? }
 */
export const createGrant = async (workspaceId, payload) => {
  const { data } = await api.post(`/api/workspaces/${workspaceId}/grants`, payload);
  return data.grant;
};

/**
 * DELETE /api/workspaces/:id/grants/:gid — revoke a grant (admin).
 */
export const revokeGrant = async (workspaceId, grantId) => {
  const { data } = await api.delete(`/api/workspaces/${workspaceId}/grants/${grantId}`);
  return data;
};

/**
 * GET /api/workspaces/shared-with-me — boards shared TO me via a grant.
 * Returns `[{ workspace, board, role }]`.
 */
export const getSharedWithMe = async () => {
  const { data } = await api.get('/api/workspaces/shared-with-me');
  return data.shared;
};
