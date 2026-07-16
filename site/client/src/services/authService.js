import api from './api';

export const getCurrentUser = async () => {
  const { data } = await api.get('/auth/me');
  return data.user;
};

export const logout = async () => {
  try {
    await api.post('/auth/logout');
  } catch (err) {
    // Stateless logout — ignore network errors, we still drop the token client-side
  }
};
