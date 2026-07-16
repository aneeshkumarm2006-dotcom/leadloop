import api from './api';

/**
 * GET /api/analytics?org=:orgId&board=:boardId&range=:range
 * Admin-only. Returns aggregated analytics data for the organisation.
 */
export const getAnalytics = async ({ orgId, board = 'all', range = '30d' }) => {
  const { data } = await api.get('/api/analytics', {
    params: { org: orgId, board, range },
  });
  return data;
};
