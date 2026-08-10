import api from './api';

/**
 * importService — CSV import. The file is read in the browser and its TEXT is
 * posted; parsing happens on the server so the mapping the preview shows is
 * produced by exactly the same code that later performs the import.
 */

/** POST /api/boards/:id/import/preview — parse + suggested mapping, nothing written. */
export const previewImport = async (boardId, csv) => {
  const { data } = await api.post(`/api/boards/${boardId}/import/preview`, { csv });
  return data;
};

/** POST /api/boards/:id/import — create the leads. */
export const runImport = async (boardId, { csv, mapping, groupId, skipExisting = true }) => {
  const { data } = await api.post(`/api/boards/${boardId}/import`, {
    csv,
    mapping,
    groupId,
    skipExisting,
  });
  return data; // { created, skipped, failed, failures }
};
