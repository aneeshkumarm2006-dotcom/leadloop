import api from './api';

/**
 * GET /api/tasks/:taskId/attachments — list files attached to a task.
 * Returns an array of { _id, url, name, mime, size, uploadedBy, createdAt }.
 */
export const getAttachments = async (taskId) => {
  const { data } = await api.get(`/api/tasks/${taskId}/attachments`);
  return data.attachments || [];
};

/**
 * POST /api/tasks/:taskId/attachments — upload a file to Cloudinary via the
 * server's multer middleware. Returns the created attachment subdoc.
 */
export const uploadAttachment = async (taskId, file) => {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post(
    `/api/tasks/${taskId}/attachments`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data.attachment;
};

/**
 * DELETE /api/tasks/:taskId/attachments/:attachmentId
 */
export const deleteAttachment = async (taskId, attachmentId) => {
  const { data } = await api.delete(
    `/api/tasks/${taskId}/attachments/${attachmentId}`
  );
  return data;
};
