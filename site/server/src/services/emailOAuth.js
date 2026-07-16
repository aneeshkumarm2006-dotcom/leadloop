/**
 * emailOAuth.js — provider OAuth dance for connecting mailboxes (Phase 3, F8.3).
 *
 * Dependency-free (built-in `fetch` + `jsonwebtoken` for the state token): build
 * the consent URL, exchange the callback code for tokens, fetch the connected
 * address, and refresh expired access tokens. Gmail (Google) and Microsoft 365
 * are supported; both store an encrypted refresh token on the `EmailAccount`.
 *
 * The `state` carried through the redirect is a short-lived signed JWT binding
 * the connect to `{ userId, workspaceId, provider }`, verified on the callback
 * so a public OAuth callback can't be replayed against another user/workspace.
 */

const jwt = require('jsonwebtoken');

const PUBLIC_BASE_URL = () =>
  process.env.WEBHOOK_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const redirectUri = (provider) => `${PUBLIC_BASE_URL()}/api/email-accounts/oauth/callback/${provider}`;

// --- Provider definitions --------------------------------------------------
const PROVIDERS = {
  gmail: {
    authBase: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'openid',
      'email',
      'profile',
    ],
    clientIdEnv: 'GMAIL_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GMAIL_OAUTH_CLIENT_SECRET',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  microsoft: {
    authBase: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: ['offline_access', 'openid', 'email', 'profile', 'Mail.ReadWrite', 'Mail.Send', 'User.Read'],
    clientIdEnv: 'MS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
    extraAuthParams: {},
  },
};

const getConfig = (provider) => {
  const def = PROVIDERS[provider];
  if (!def) throw new Error(`Unsupported email provider: ${provider}`);
  const clientId = process.env[def.clientIdEnv];
  const clientSecret = process.env[def.clientSecretEnv];
  if (!clientId || !clientSecret) {
    const err = new Error(`${provider} OAuth is not configured (${def.clientIdEnv}/${def.clientSecretEnv})`);
    err.code = 'OAUTH_NOT_CONFIGURED';
    throw err;
  }
  return { ...def, clientId, clientSecret };
};

const isSupportedProvider = (provider) => Object.prototype.hasOwnProperty.call(PROVIDERS, provider);

// --- State token -----------------------------------------------------------
const signState = ({ userId, workspaceId, provider }) =>
  jwt.sign({ userId, workspaceId, provider, kind: 'email_oauth' }, process.env.JWT_SECRET, { expiresIn: '15m' });

const verifyState = (state) => {
  const decoded = jwt.verify(state, process.env.JWT_SECRET);
  if (decoded.kind !== 'email_oauth') throw new Error('Invalid OAuth state');
  return decoded;
};

// --- Authorize URL ---------------------------------------------------------
const getAuthUrl = ({ provider, userId, workspaceId }) => {
  const cfg = getConfig(provider);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(provider),
    response_type: 'code',
    scope: cfg.scopes.join(' '),
    state: signState({ userId, workspaceId, provider }),
    ...cfg.extraAuthParams,
  });
  return `${cfg.authBase}?${params.toString()}`;
};

// --- Token exchange / refresh ---------------------------------------------
const postForm = async (url, form) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OAuth token request failed (${res.status}): ${data.error_description || data.error || 'unknown'}`);
  }
  return data;
};

/** Exchange an authorization code for tokens + the connected address. */
const exchangeCode = async (provider, code) => {
  const cfg = getConfig(provider);
  const data = await postForm(cfg.tokenUrl, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(provider),
  });

  const tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    scope: data.scope || cfg.scopes.join(' '),
  };

  const address = await fetchAddress(provider, data.access_token).catch(() => '');
  return { tokens, address };
};

/** Look up the connected mailbox's primary address. */
const fetchAddress = async (provider, accessToken) => {
  const cfg = getConfig(provider);
  const res = await fetch(cfg.userInfoUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return '';
  const data = await res.json().catch(() => ({}));
  return data.email || data.mail || data.userPrincipalName || '';
};

/**
 * Refresh an account's access token using its stored refresh token. Persists the
 * new access token (+ expiry) on the account and lazily re-encrypts both tokens
 * under the current key when the refresh token was read via the previous key.
 * Returns the fresh access token. Throws if the account has no refresh token.
 */
const refreshAccessToken = async (account) => {
  const cfg = getConfig(account.provider);
  const decrypted = account.getDecryptedTokens();
  if (!decrypted.refreshToken) throw new Error('No refresh token on account');

  const data = await postForm(cfg.tokenUrl, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: decrypted.refreshToken,
    grant_type: 'refresh_token',
  });

  account.setTokens({
    accessToken: data.access_token,
    // Providers may rotate the refresh token; keep the new one if present, and
    // re-encrypt the existing one under the current key when rotation is due.
    refreshToken: data.refresh_token || (decrypted.needsReEncrypt ? decrypted.refreshToken : undefined),
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    scope: data.scope || decrypted.scope,
  });
  account.status = 'active';
  account.lastError = null;
  await account.save();
  return data.access_token;
};

/**
 * Return a valid access token for the account, refreshing first if it's expired.
 * Marks the account `error` (and rethrows) if a refresh fails.
 */
const ensureAccessToken = async (account) => {
  const decrypted = account.getDecryptedTokens();
  if (!account.isAccessTokenExpired() && decrypted.accessToken) {
    if (decrypted.needsReEncrypt) {
      // Lazy rotation: re-encrypt under the current key on this read.
      account.setTokens({ accessToken: decrypted.accessToken, refreshToken: decrypted.refreshToken });
      await account.save();
    }
    return decrypted.accessToken;
  }
  try {
    return await refreshAccessToken(account);
  } catch (err) {
    account.status = 'error';
    account.lastError = err.message;
    await account.save().catch(() => {});
    throw err;
  }
};

module.exports = {
  isSupportedProvider,
  getAuthUrl,
  exchangeCode,
  refreshAccessToken,
  ensureAccessToken,
  verifyState,
  redirectUri,
  PROVIDERS,
};
