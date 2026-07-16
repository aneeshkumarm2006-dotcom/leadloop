/**
 * orgStore — back-compat shim (Phase 1 / F3).
 *
 * The store was renamed to `workspaceStore.js` when Organisation became
 * "Workspace" at the surface. This default re-export keeps existing
 * `import useOrgStore from '../store/orgStore'` call sites working for one
 * release cycle. New code should import from `workspaceStore.js`.
 */
export { default } from './workspaceStore';
