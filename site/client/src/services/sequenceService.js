import api from './api';

/**
 * sequenceService — Phase 4 email sequences (drip cadences). Board-scoped admin
 * CRUD + bulk enrollment ("mass email") + per-sequence stats/enrollments.
 */

export const listSequences = async (boardId) => {
  const { data } = await api.get(`/api/boards/${boardId}/sequences`);
  return data;
};
export const createSequence = async (boardId, payload) => {
  const { data } = await api.post(`/api/boards/${boardId}/sequences`, payload);
  return data;
};
export const getSequence = async (id) => {
  const { data } = await api.get(`/api/sequences/${id}`);
  return data;
};
export const updateSequence = async (id, payload) => {
  const { data } = await api.put(`/api/sequences/${id}`, payload);
  return data;
};
export const deleteSequence = async (id) => {
  await api.delete(`/api/sequences/${id}`);
};
export const enrollLeads = async (id, taskIds) => {
  const { data } = await api.post(`/api/sequences/${id}/enroll`, { taskIds });
  return data; // { enrolled, skipped: [{taskId, reason}] }
};
export const listEnrollments = async (id) => {
  const { data } = await api.get(`/api/sequences/${id}/enrollments`);
  return data;
};
export const getSequenceStats = async (id) => {
  const { data } = await api.get(`/api/sequences/${id}/stats`);
  return data;
};
export const stopEnrollment = async (enrollmentId) => {
  const { data } = await api.post(`/api/sequences/enrollments/${enrollmentId}/stop`);
  return data;
};
