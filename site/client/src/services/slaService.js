import api from './api';

/**
 * slaService — the speed-to-lead response clock. The server computes each
 * lead's state (pending / warning / breached) so every client agrees on the
 * clock regardless of device time.
 */

/** GET /api/sla?org= — { policy, summary, queue }. */
export const getSla = async (orgId) => {
  const { data } = await api.get('/api/sla', { params: { org: orgId } });
  return data;
};

/** PUT /api/sla — update the workspace policy (admin). */
export const updateSla = async (orgId, policy) => {
  const { data } = await api.put('/api/sla', { org: orgId, ...policy });
  return data.policy;
};

/** "3:12" / "1h 04m" — mirrors the server's formatter for the countdown UI. */
export const formatDuration = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
};
