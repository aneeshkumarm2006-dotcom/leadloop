import api from './api';

export const updateProfile = async ({ name }) => {
  const { data } = await api.put('/api/profile', { name });
  return data.user;
};

// Save AI drafter settings. Pass any subset of:
//   { anthropicKey, openaiKey, aiProvider, aiModel }
// A blank-string key clears it; omit a key to leave it untouched.
export const updateAiSettings = async (payload) => {
  const { data } = await api.put('/api/profile/ai', payload);
  return data.user;
};

export const uploadAvatar = async (file) => {
  const formData = new FormData();
  formData.append('avatar', file);
  const { data } = await api.post('/api/profile/upload-avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

export const deleteAccount = async () => {
  await api.delete('/api/profile');
};
