import api from './api';

/**
 * duplicateService — the duplicate-lead queue.
 *
 * Detection happens on the server at ingest time and only ever RECORDS a
 * candidate; merging is always an explicit human action from this UI.
 */

/** GET /api/duplicates?org= — pending pairs with both sides' field values. */
export const listDuplicates = async (orgId) => {
  const { data } = await api.get('/api/duplicates', { params: { org: orgId } });
  return data.duplicates || [];
};

/**
 * POST /api/duplicates/:id/merge — merge a pair (admin).
 * @param {Object} choices  { [columnId]: 'primary' | 'duplicate' }
 * @param {string} keep     'existing' (default, keeps the older lead) | 'incoming'
 */
export const mergeDuplicate = async (id, choices = {}, keep = 'existing') => {
  const { data } = await api.post(`/api/duplicates/${id}/merge`, { choices, keep });
  return data;
};

/** POST /api/duplicates/:id/dismiss — different people; never re-raise (admin). */
export const dismissDuplicate = async (id) => {
  const { data } = await api.post(`/api/duplicates/${id}/dismiss`);
  return data;
};
