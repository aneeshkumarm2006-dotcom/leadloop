/**
 * orgService — back-compat shim (Phase 1 / F3).
 *
 * The real implementation moved to `workspaceService.js` when Organisation was
 * renamed to "Workspace" at the API surface. This re-export keeps existing
 * `import * as orgService from '../services/orgService'` call sites working for
 * one release cycle. New code should import from `workspaceService.js`.
 */
export * from './workspaceService';
