import api from './api';

/**
 * GET /api/productivity?org=:orgId&range=:range
 * Admin-only. Returns per-member productivity stats.
 */
export const getProductivity = async ({ orgId, range = '30d' }) => {
  const { data } = await api.get('/api/productivity', {
    params: { org: orgId, range },
  });
  return data;
};
