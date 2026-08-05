import api from './api';

export const getCurrentUser = async () => {
  const { data } = await api.get('/auth/me');
  return data.user;
};

// --- Email + password auth --------------------------------------------------
// These use the shared `api` axios instance. `suppressErrorToast` keeps the
// global toast quiet so the auth screen can render errors inline instead.

export const register = async ({ name, email, password }) => {
  const { data } = await api.post(
    '/auth/register',
    { name, email, password },
    { suppressErrorToast: true }
  );
  return data;
};

export const verifyEmail = async ({ email, code }) => {
  const { data } = await api.post(
    '/auth/verify',
    { email, code },
    { suppressErrorToast: true }
  );
  return data;
};

export const resendCode = async ({ email }) => {
  const { data } = await api.post(
    '/auth/resend',
    { email },
    { suppressErrorToast: true }
  );
  return data;
};

export const loginWithPassword = async ({ email, password }) => {
  const { data } = await api.post(
    '/auth/login',
    { email, password },
    { suppressErrorToast: true }
  );
  return data;
};

export const forgotPassword = async ({ email }) => {
  const { data } = await api.post(
    '/auth/forgot',
    { email },
    { suppressErrorToast: true }
  );
  return data;
};

export const resetPassword = async ({ email, code, newPassword }) => {
  const { data } = await api.post(
    '/auth/reset',
    { email, code, newPassword },
    { suppressErrorToast: true }
  );
  return data;
};

export const logout = async () => {
  try {
    await api.post('/auth/logout');
  } catch (err) {
    // Stateless logout — ignore network errors, we still drop the token client-side
  }
};
