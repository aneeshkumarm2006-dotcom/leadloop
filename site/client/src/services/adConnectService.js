import api from './api';

/**
 * adConnectService.js — client for the one-click ad platform connections
 * ("Ads & tracking" hub). Every route is workspace-scoped and admin-only on the
 * server: `/api/workspaces/:id/ad-connect/...`.
 *
 * Tokens never reach the browser. OAuth `start` returns a provider URL the
 * browser is sent to; the provider redirects back to the server callback,
 * which then redirects to `/settings?tab=ads&connect=<platform>`.
 */

const base = (workspaceId) => `/api/workspaces/${workspaceId}/ad-connect`;

export const PLATFORMS = ['meta', 'google', 'tiktok'];

/* ------------------------------ Overview ------------------------------ */

/** GET /overview — everything the hub renders (statuses, websites, counts). */
export const getOverview = async (workspaceId) => {
  const { data } = await api.get(`${base(workspaceId)}/overview`);
  return data;
};

/* -------------------------------- OAuth -------------------------------- */

/**
 * POST /:platform/start → `{ url }`. 503 `{ code: 'not_configured' }` when the
 * server has no app credentials for that platform.
 */
export const startOAuth = async (workspaceId, platform, { gtm = false } = {}) => {
  if (!PLATFORMS.includes(platform)) throw new Error('Unknown platform');
  const body = platform === 'google' && gtm ? { gtm: true } : {};
  const { data } = await api.post(`${base(workspaceId)}/${platform}/start`, body, { suppressErrorToast: true });
  return data.url;
};

/**
 * POST /:platform/confirm `{ pendingId }` — binds the OAuth result the callback
 * parked under `pendingId` to this workspace. Must run before the
 * choose-accounts step. 403 `confirm_mismatch` / 410 `pending_expired`.
 */
export const confirmOAuth = async (workspaceId, platform, pendingId) => {
  if (!PLATFORMS.includes(platform)) throw new Error('Unknown platform');
  const { data } = await api.post(`${base(workspaceId)}/${platform}/confirm`, { pendingId }, { suppressErrorToast: true });
  return data;
};

/**
 * Only ever navigate to an https provider URL returned by our own API — never
 * a `javascript:` / data: URL, even if the response were tampered with.
 */
export const isSafeRedirectUrl = (url) => {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:';
  } catch {
    return false;
  }
};

/* --------------------------------- Meta -------------------------------- */

export const getMetaAssets = async (workspaceId) => {
  const { data } = await api.get(`${base(workspaceId)}/meta/assets`, { suppressErrorToast: true });
  return data;
};

export const getMetaPixels = async (workspaceId, adAccountId) => {
  const { data } = await api.get(`${base(workspaceId)}/meta/pixels`, {
    params: { adAccountId },
    suppressErrorToast: true,
  });
  return data.pixels || [];
};

/** body `{ businessId, adAccountId, pixelId?, createPixel?, pixelName? }` → `{ meta }` */
export const selectMeta = async (workspaceId, body) => {
  const { data } = await api.post(`${base(workspaceId)}/meta/select`, body, { suppressErrorToast: true });
  return data.meta;
};

/** body `{ pageIds, boardId }` → `{ pages, failed: [pageId] }` */
export const setMetaLeadAds = async (workspaceId, body) => {
  const { data } = await api.post(`${base(workspaceId)}/meta/lead-ads`, body, { suppressErrorToast: true });
  return {
    pages: Array.isArray(data?.pages) ? data.pages : [],
    failed: Array.isArray(data?.failed) ? data.failed.map(String) : [],
  };
};

export const disconnectMeta = async (workspaceId) => {
  const { data } = await api.post(`${base(workspaceId)}/meta/disconnect`, {}, { suppressErrorToast: true });
  return data;
};

/* -------------------------------- Google ------------------------------- */

export const getGoogleAccounts = async (workspaceId) => {
  const { data } = await api.get(`${base(workspaceId)}/google/accounts`, { suppressErrorToast: true });
  return data;
};

/**
 * body `{ customerId, loginCustomerId?, createConversionActions, enableAutoTagging, leadForms?: { enabled, boardId } }`
 * → `{ google, leadForm?: { webhookUrl, key } }` (key is plaintext, shown once).
 */
export const selectGoogle = async (workspaceId, body) => {
  const { data } = await api.post(`${base(workspaceId)}/google/select`, body, { suppressErrorToast: true });
  return data;
};

/** → `{ containers }`; rejects with 403 `{ code: 'needs_gtm_scope' }` when Tag Manager access is missing. */
export const getGtmContainers = async (workspaceId) => {
  const { data } = await api.get(`${base(workspaceId)}/google/gtm/containers`, { suppressErrorToast: true });
  return data.containers || [];
};

/** body `{ accountId, containerId, connectionId }` → `{ ok, containerPublicId, versionId, publishedAt }` */
export const installGtm = async (workspaceId, body) => {
  const { data } = await api.post(`${base(workspaceId)}/google/gtm/install`, body, { suppressErrorToast: true });
  return data;
};

export const disconnectGoogle = async (workspaceId) => {
  const { data } = await api.post(`${base(workspaceId)}/google/disconnect`, {}, { suppressErrorToast: true });
  return data;
};

/* -------------------------------- TikTok ------------------------------- */

export const getTikTokAssets = async (workspaceId) => {
  const { data } = await api.get(`${base(workspaceId)}/tiktok/assets`, { suppressErrorToast: true });
  return data;
};

export const getTikTokPixels = async (workspaceId, advertiserId) => {
  const { data } = await api.get(`${base(workspaceId)}/tiktok/pixels`, {
    params: { advertiserId },
    suppressErrorToast: true,
  });
  return data.pixels || [];
};

/** body `{ advertiserId, bcId?, pixelCode?, createPixel?, pixelName?, instantForms?: { enabled, boardId } }` → `{ tiktok }` */
export const selectTikTok = async (workspaceId, body) => {
  const { data } = await api.post(`${base(workspaceId)}/tiktok/select`, body, { suppressErrorToast: true });
  return data.tiktok;
};

/** body `{ testEventCode }` → `{ ok, error? }` */
export const testTikTok = async (workspaceId, testEventCode) => {
  const { data } = await api.post(`${base(workspaceId)}/tiktok/test`, { testEventCode }, { suppressErrorToast: true });
  return data;
};

export const disconnectTikTok = async (workspaceId) => {
  const { data } = await api.post(`${base(workspaceId)}/tiktok/disconnect`, {}, { suppressErrorToast: true });
  return data;
};

export const disconnectPlatform = (workspaceId, platform) => {
  if (platform === 'meta') return disconnectMeta(workspaceId);
  if (platform === 'google') return disconnectGoogle(workspaceId);
  if (platform === 'tiktok') return disconnectTikTok(workspaceId);
  return Promise.reject(new Error('Unknown platform'));
};

/* ------------------------------- Website ------------------------------- */

/** body `{ connectionId, url? }` → `{ checkedAt, url, checks, pagesSeen, lastSeenAt }` */
export const checkWebsite = async (workspaceId, body) => {
  const { data } = await api.post(`${base(workspaceId)}/website/check`, body, { suppressErrorToast: true });
  return data;
};

/** Downloads the pre-configured WordPress plugin zip (authed, so fetched as a blob). */
export const downloadWordpressPlugin = async (workspaceId, connectionId) => {
  const { data } = await api.get(
    `${base(workspaceId)}/website/${encodeURIComponent(connectionId)}/wordpress-plugin.zip`,
    { responseType: 'blob', suppressErrorToast: true },
  );
  const href = URL.createObjectURL(data);
  try {
    const a = document.createElement('a');
    a.href = href;
    a.download = 'leadloop-wordpress-plugin.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
};

/** body `{ connectionId, email, builder }` → `{ ok }` (rate limited 5/hour/workspace). */
export const emailDeveloper = async (workspaceId, body) => {
  const { data } = await api.post(`${base(workspaceId)}/website/email-developer`, body, { suppressErrorToast: true });
  return data;
};

/** Pull a human message out of an axios error, falling back to `fallback`. */
export const errorMessage = (err, fallback) => {
  const msg = err?.response?.data?.error;
  return typeof msg === 'string' && msg.trim() ? msg.trim().slice(0, 300) : fallback;
};

export const errorStatus = (err) => err?.response?.status || 0;

export const errorCode = (err) => {
  const code = err?.response?.data?.code;
  return typeof code === 'string' ? code : '';
};
