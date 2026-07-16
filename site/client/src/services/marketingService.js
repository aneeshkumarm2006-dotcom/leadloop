import api from './api';

/**
 * marketingService — Phase 2.3 campaigns CRUD + the Marketing/ROI report.
 * All endpoints are admin-only and org-scoped via `orgId`.
 */

export const listCampaigns = async (orgId, boardId) => {
  const { data } = await api.get('/api/marketing/campaigns', { params: { orgId, boardId } });
  return data.campaigns || [];
};

export const createCampaign = async (orgId, payload) => {
  const { data } = await api.post('/api/marketing/campaigns', payload, { params: { orgId } });
  return data.campaign;
};

export const updateCampaign = async (orgId, id, payload) => {
  const { data } = await api.patch(`/api/marketing/campaigns/${id}`, payload, { params: { orgId } });
  return data.campaign;
};

export const deleteCampaign = async (orgId, id) => {
  await api.delete(`/api/marketing/campaigns/${id}`, { params: { orgId } });
};

/**
 * GET /api/marketing/roi — per-source leads / won / conversion / spend /
 * cost-per-lead / cost-per-acquisition for a board + its source column.
 */
export const getRoi = async (orgId, { boardId, sourceColumnId, from, to } = {}) => {
  const { data } = await api.get('/api/marketing/roi', {
    params: { orgId, boardId, sourceColumnId, from, to },
  });
  return data; // { rows, totals, sourceColumnName, campaignCount, ... }
};
