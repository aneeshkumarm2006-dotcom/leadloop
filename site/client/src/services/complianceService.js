import api from './api';

/**
 * complianceService — consent records, the do-not-contact list, and the audit
 * export. The server enforces these rules on every send; this is the surface
 * for inspecting and managing them.
 */

export const listSuppressions = async (orgId) => {
  const { data } = await api.get('/api/compliance/suppressions', { params: { org: orgId } });
  return data.suppressions || [];
};

export const addSuppression = async (orgId, payload) => {
  const { data } = await api.post('/api/compliance/suppressions', { org: orgId, ...payload });
  return data.suppression;
};

export const removeSuppression = async (id) => {
  const { data } = await api.delete(`/api/compliance/suppressions/${id}`);
  return data.removed;
};

/** A lead's consent state per channel. */
export const getConsent = async (taskId) => {
  const { data } = await api.get(`/api/compliance/consent/${taskId}`);
  return data.consent || [];
};

export const setConsent = async (taskId, payload) => {
  const { data } = await api.post(`/api/compliance/consent/${taskId}`, payload);
  return data.consent;
};

/** The audit trail as a CSV Blob, for download. */
export const exportAudit = async (orgId) => {
  const { data } = await api.get('/api/compliance/export', {
    params: { org: orgId },
    responseType: 'blob',
  });
  return data;
};
