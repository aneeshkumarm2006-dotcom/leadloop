import api from './api';

/**
 * bookingService — Phase 4b Visit Booking. Admin CRUD for booking links +
 * the public (unauthenticated) booking flow.
 */

// ---- admin (auth) ----
export const listBookingLinks = async (boardId) => {
  const { data } = await api.get(`/api/boards/${boardId}/booking-links`);
  return data.links || [];
};
export const createBookingLink = async (boardId, payload) => {
  const { data } = await api.post(`/api/boards/${boardId}/booking-links`, payload);
  return data.link;
};
export const getBookingLink = async (id) => {
  const { data } = await api.get(`/api/booking-links/${id}`);
  return data.link;
};
export const updateBookingLink = async (id, payload) => {
  const { data } = await api.patch(`/api/booking-links/${id}`, payload);
  return data.link;
};
export const deleteBookingLink = async (id) => {
  await api.delete(`/api/booking-links/${id}`);
};
export const listBookings = async (linkId) => {
  const { data } = await api.get(`/api/booking-links/${linkId}/bookings`);
  return data.bookings || [];
};

// ---- booking workflows (org-scoped, admin) ----
export const listBookingWorkflows = async (orgId) => {
  const { data } = await api.get('/api/booking-workflows', { params: { org: orgId } });
  return data.workflows || [];
};
export const getBookingWorkflow = async (id) => {
  const { data } = await api.get(`/api/booking-workflows/${id}`);
  return data.workflow;
};
export const createBookingWorkflow = async (payload) => {
  const { data } = await api.post('/api/booking-workflows', payload);
  return data.workflow;
};
export const updateBookingWorkflow = async (id, payload) => {
  const { data } = await api.patch(`/api/booking-workflows/${id}`, payload);
  return data.workflow;
};
export const deleteBookingWorkflow = async (id) => {
  await api.delete(`/api/booking-workflows/${id}`);
};

// ---- public (no auth) ----
export const getPublicBooking = async (slug) => {
  const { data } = await api.get(`/book/${slug}`);
  return data;
};
export const getPublicSlots = async (slug) => {
  const { data } = await api.get(`/book/${slug}/slots`);
  return data; // { timezone, durationMinutes, days: [{date, weekday, slots}] }
};
export const submitBooking = async (slug, payload) => {
  const { data } = await api.post(`/book/${slug}/submit`, payload);
  return data;
};
export const cancelBooking = async (slug, token) => {
  const { data } = await api.post(`/book/${slug}/cancel/${token}`);
  return data;
};
