import api from './api';

/**
 * chartService.js — client wrapper for the F13 chart widget endpoints. The
 * `ChartWidget` primitive + the aggregated `data` payload are the shared chart
 * contract reused by F15 dashboards.
 */

/** GET /api/charts?boardId=|workspaceId= — list widgets in scope (member). */
export const listCharts = async ({ boardId, workspaceId } = {}) => {
  const params = {};
  if (boardId) params.boardId = boardId;
  if (workspaceId) params.workspaceId = workspaceId;
  const { data } = await api.get('/api/charts', { params });
  return data.charts || [];
};

/** POST /api/charts — create a widget (admin). Body carries boardId|workspaceId. */
export const createChart = async (payload) => {
  const { data } = await api.post('/api/charts', payload);
  return data.chart;
};

/** PATCH /api/charts/:id — update a widget (admin). */
export const updateChart = async (id, payload) => {
  const { data } = await api.patch(`/api/charts/${id}`, payload);
  return data.chart;
};

/** DELETE /api/charts/:id — remove a widget (admin, 204). */
export const deleteChart = async (id) => {
  await api.delete(`/api/charts/${id}`);
  return true;
};

/**
 * GET /api/charts/:id/data?from=&to= — aggregated series for the widget.
 * Returns the type-specific payload from chartDataService.aggregate.
 */
export const getChartData = async (id, { from, to } = {}) => {
  const params = {};
  if (from) params.from = from instanceof Date ? from.toISOString() : from;
  if (to) params.to = to instanceof Date ? to.toISOString() : to;
  const { data } = await api.get(`/api/charts/${id}/data`, { params });
  return data.data;
};
