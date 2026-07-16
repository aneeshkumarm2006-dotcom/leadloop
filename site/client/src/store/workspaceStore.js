import { create } from 'zustand';
import * as workspaceService from '../services/workspaceService';
import * as authService from '../services/authService';

/**
 * workspaceStore — the active workspace, the user's workspace list, members,
 * and (F3) cross-workspace grants + boards shared with the user.
 *
 * Renamed from `orgStore.js`; `orgStore.js` re-exports this store's default so
 * existing `import useOrgStore from '../store/orgStore'` keeps working for one
 * release. The localStorage key stays `macan_current_org` — do NOT rename it
 * (Risks §JWT renaming) so existing sessions survive the surface rename.
 */
const CURRENT_ORG_KEY = 'macan_current_org';

const useWorkspaceStore = create((set, get) => ({
  currentOrg: null,
  orgs: [],
  members: [],
  adminId: null,
  adminIds: [],
  // F3: boards shared TO this user from other workspaces ([{ workspace, board, role }]).
  sharedBoards: [],
  // F3: grants the current workspace has issued (admin view).
  grants: [],
  loading: false,

  /**
   * Hydrate orgs list from a user object (usually from authStore).
   * Also restores the last-selected currentOrg from localStorage, or defaults
   * to the first org.
   */
  setOrgsFromUser: (user) => {
    const orgs = Array.isArray(user?.organisations) ? user.organisations : [];
    const savedId = localStorage.getItem(CURRENT_ORG_KEY);
    const current =
      orgs.find((o) => o._id === savedId) || orgs[0] || null;

    if (current) {
      localStorage.setItem(CURRENT_ORG_KEY, current._id);
    }
    set({ orgs, currentOrg: current });
  },

  /**
   * Re-fetch the list of organisations the current user belongs to.
   * Uses /auth/me since there is no dedicated "my orgs" endpoint.
   */
  fetchOrgs: async () => {
    set({ loading: true });
    try {
      const user = await authService.getCurrentUser();
      const orgs = Array.isArray(user?.organisations) ? user.organisations : [];
      const savedId = localStorage.getItem(CURRENT_ORG_KEY);
      const current =
        orgs.find((o) => o._id === savedId) || orgs[0] || null;
      if (current) {
        localStorage.setItem(CURRENT_ORG_KEY, current._id);
      }
      set({ orgs, currentOrg: current, loading: false });
      return orgs;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  setCurrentOrg: (orgId) => {
    const org =
      get().orgs.find((o) => o._id === orgId) ||
      get().sharedBoards.map((s) => s.workspace).find((w) => w && w._id === orgId);
    if (org) {
      localStorage.setItem(CURRENT_ORG_KEY, org._id);
      set({ currentOrg: org });
    }
  },

  createOrg: async (name) => {
    const org = await workspaceService.createOrg(name);
    const orgs = [...get().orgs, org];
    localStorage.setItem(CURRENT_ORG_KEY, org._id);
    set({ orgs, currentOrg: org });
    return org;
  },

  joinOrg: async (inviteCode) => {
    const org = await workspaceService.joinOrg(inviteCode);
    const orgs = get().orgs.some((o) => o._id === org._id)
      ? get().orgs
      : [...get().orgs, org];
    localStorage.setItem(CURRENT_ORG_KEY, org._id);
    set({ orgs, currentOrg: org });
    return org;
  },

  fetchMembers: async (orgId) => {
    set({ loading: true });
    try {
      const data = await workspaceService.listMembers(orgId);
      set({ members: data.members, adminId: data.adminId, adminIds: data.adminIds || [], loading: false });
      return data;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  clearOrgs: () => {
    localStorage.removeItem(CURRENT_ORG_KEY);
    set({
      currentOrg: null,
      orgs: [],
      members: [],
      adminId: null,
      adminIds: [],
      sharedBoards: [],
      grants: [],
    });
  },

  /**
   * Permanently delete an organisation. Owner-only on the server.
   * Drops the org from local state and re-points currentOrg at the next
   * available org (or null if this was the last one). Returns the new
   * currentOrg so callers can route appropriately.
   */
  deleteOrg: async (orgId) => {
    await workspaceService.deleteOrg(orgId);
    const orgs = get().orgs.filter((o) => o._id !== orgId);
    const nextCurrent =
      get().currentOrg?._id === orgId ? orgs[0] || null : get().currentOrg;
    if (nextCurrent) {
      localStorage.setItem(CURRENT_ORG_KEY, nextCurrent._id);
    } else {
      localStorage.removeItem(CURRENT_ORG_KEY);
    }
    set({
      orgs,
      currentOrg: nextCurrent,
      members: [],
      adminId: null,
      adminIds: [],
    });
    return nextCurrent;
  },

  // --- Cross-workspace sharing (F3) ----------------------------------------

  /**
   * Boards shared TO the current user from other workspaces. Powers the navbar
   * "Shared with me" section. Returns `[{ workspace, board, role }]`.
   */
  fetchSharedBoards: async () => {
    try {
      const sharedBoards = await workspaceService.getSharedWithMe();
      set({ sharedBoards: Array.isArray(sharedBoards) ? sharedBoards : [] });
      return sharedBoards;
    } catch (err) {
      set({ sharedBoards: [] });
      throw err;
    }
  },

  /**
   * Grants the given workspace has issued (admin only). Cached on `grants`.
   */
  fetchGrants: async (workspaceId) => {
    const grants = await workspaceService.listGrants(workspaceId);
    set({ grants: Array.isArray(grants) ? grants : [] });
    return grants;
  },

  /**
   * Issue a grant, then refresh the cached grants list for the workspace.
   */
  createGrant: async (workspaceId, payload) => {
    const grant = await workspaceService.createGrant(workspaceId, payload);
    await get().fetchGrants(workspaceId).catch(() => {});
    return grant;
  },

  /**
   * Revoke a grant and drop it from local state.
   */
  revokeGrant: async (workspaceId, grantId) => {
    await workspaceService.revokeGrant(workspaceId, grantId);
    set((s) => ({ grants: s.grants.filter((g) => g._id !== grantId) }));
  },
}));

export default useWorkspaceStore;
export { useWorkspaceStore };
