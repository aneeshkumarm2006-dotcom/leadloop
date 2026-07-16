import api from './api';

/**
 * intakeService.js — client wrapper for the F9 Lead Intake policy endpoints
 * (board-scoped). All calls go through the authed `api` client.
 */

/**
 * GET /api/boards/:boardId/intake-policy — the board's policy (or a default
 * skeleton when none exists yet) plus `meta` (typed columns, members, templates)
 * for the form, and `isAdmin`.
 */
export const getIntakePolicy = async (boardId) => {
  const { data } = await api.get(`/api/boards/${boardId}/intake-policy`);
  return data; // { policy, meta, isAdmin }
};

/**
 * PUT /api/boards/:boardId/intake-policy — upsert the full policy (admin only).
 */
export const saveIntakePolicy = async (boardId, payload) => {
  const { data } = await api.put(`/api/boards/${boardId}/intake-policy`, payload);
  return data.policy;
};

/**
 * GET /api/boards/:boardId/intake-events?limit=10 — the last N executed intakes
 * (resolved owner, stage, welcome-email status, follow-up subitem).
 */
export const getIntakeEvents = async (boardId, limit = 10) => {
  const { data } = await api.get(`/api/boards/${boardId}/intake-events`, {
    params: { limit },
  });
  return data.events || [];
};
