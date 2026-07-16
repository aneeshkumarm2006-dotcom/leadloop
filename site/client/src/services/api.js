import axios from 'axios';
import useToastStore from '../store/toastStore';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
});

// Public surfaces that must NOT carry a Bearer token — the OAuth callback (the
// browser returns to it from the provider) and the email tracking pixels/links
// (hit by mail clients). These are normally not requested via this client, but
// the bypass keeps the interceptor honest if they ever are (F8.6).
const PUBLIC_PATHS = [
  /\/api\/email-accounts\/oauth\/callback\//,
  /\/api\/email\/track\//,
  /\/api\/email\/inbound\//,
  /\/api\/webhooks\/in\//,
  /\/api\/sms\/(inbound|status)/,
  /\/api\/whatsapp\/(inbound|status)/,
  // F13 public form render + submit — hit by logged-out visitors / embeds.
  /\/f\//,
  // F14 public API lead ingest — server-to-server, but keep the interceptor
  // honest if it's ever hit from the client (no Bearer token attached).
  /\/api\/leads\/ingest/,
];

const isPublicPath = (url = '') => PUBLIC_PATHS.some((re) => re.test(url));

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('macan_token');
  if (token && !isPublicPath(config.url)) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Callers can opt out of the global toast by setting
    // `config.suppressErrorToast = true` on their request.
    const suppress = error.config?.suppressErrorToast;

    if (error.response) {
      const status = error.response.status;
      if (status === 401) {
        // Token invalid/expired — drop it so the app redirects to /login
        localStorage.removeItem('macan_token');
      } else if (!suppress && status >= 500) {
        useToastStore
          .getState()
          .error('Something went wrong on our end. Please try again.');
      }
    } else if (error.request && !suppress) {
      // No response at all — network error
      useToastStore
        .getState()
        .error('Network error. Check your connection and try again.');
    }
    return Promise.reject(error);
  }
);

export default api;
