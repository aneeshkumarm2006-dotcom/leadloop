/**
 * googleAdsApi.js — Google OAuth + Google Ads API calls behind "Sign in with
 * Google": account discovery (incl. accounts under a manager/MCC), conversion
 * action find-or-create, auto-tagging, and the account's Google tag id.
 *
 * Uploading conversions stays in googleAdsConversions.js (which this module
 * shares the OAuth client + access-token cache with).
 *
 * Env: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_OAUTH_CLIENT_ID/SECRET (fallback
 * GOOGLE_ADS_CLIENT_ID/SECRET), GOOGLE_ADS_API_VERSION.
 */

const { requestJson, PlatformError } = require('./adConnectHttp');
const googleAds = require('./googleAdsConversions');

const ADS = () => `https://googleads.googleapis.com/${googleAds.API_VERSION()}`;
const digits = (s) => String(s || '').replace(/\D/g, '');

const BASE_SCOPES = ['https://www.googleapis.com/auth/adwords', 'openid', 'email'];
const GTM_SCOPES = [
  'https://www.googleapis.com/auth/tagmanager.edit.containers',
  'https://www.googleapis.com/auth/tagmanager.edit.containerversions',
  'https://www.googleapis.com/auth/tagmanager.publish',
];

const isConfigured = () => googleAds.isOAuthConfigured();

const hasGtmScopes = (scopes) => {
  const set = new Set(Array.isArray(scopes) ? scopes : String(scopes || '').split(/\s+/));
  return GTM_SCOPES.every((s) => set.has(s));
};

// --- OAuth --------------------------------------------------------------------

const authUrl = ({ state, redirectUri, gtm = false }) => {
  const { clientId } = googleAds.oauthClient();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [...BASE_SCOPES, ...(gtm ? GTM_SCOPES : [])].join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
};

/** @returns {{ refreshToken, accessToken, scopes: string[], email }} */
const exchangeCode = async ({ code, redirectUri, fetchImpl }) => {
  const { clientId, clientSecret } = googleAds.oauthClient();
  const { json } = await requestJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }),
    fetchImpl,
    label: 'google',
  });
  if (!json || !json.refresh_token) {
    // prompt=consent should always yield one; without it we can't work offline.
    throw new PlatformError('google: no refresh token returned', { code: 'no_refresh_token' });
  }
  let email = '';
  try {
    const info = await requestJson('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${json.access_token}` },
      fetchImpl,
      label: 'google',
    });
    email = (info.json && info.json.email) || '';
  } catch (err) {
    console.warn('[google] userinfo lookup failed:', err.message);
  }
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    scopes: String(json.scope || '').split(/\s+/).filter(Boolean),
    email,
  };
};

// --- Ads API --------------------------------------------------------------------

const adsHeaders = (accessToken, loginCustomerId) => {
  const h = { Authorization: `Bearer ${accessToken}`, 'developer-token': String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim() };
  const login = digits(loginCustomerId);
  if (login) h['login-customer-id'] = login;
  return h;
};

/** Ads API client bound to one refresh token. */
const client = (refreshToken, { fetchImpl = fetch } = {}) => {
  const token = () => googleAds.accessToken(fetchImpl, { refreshToken });

  const search = async (customerId, query, loginCustomerId) => {
    const at = await token();
    const rows = [];
    let pageToken;
    for (let i = 0; i < 10; i += 1) {
      const { json } = await requestJson(`${ADS()}/customers/${digits(customerId)}/googleAds:search`, {
        method: 'POST',
        headers: adsHeaders(at, loginCustomerId),
        body: { query, ...(pageToken ? { pageToken } : {}) },
        fetchImpl,
        label: 'google',
      });
      for (const r of (json && json.results) || []) rows.push(r);
      pageToken = json && json.nextPageToken;
      if (!pageToken) break;
    }
    return rows;
  };

  const mutate = async (customerId, path, body, loginCustomerId) => {
    const at = await token();
    const { json } = await requestJson(`${ADS()}/customers/${digits(customerId)}/${path}`, {
      method: 'POST',
      headers: adsHeaders(at, loginCustomerId),
      body,
      fetchImpl,
      label: 'google',
    });
    return json;
  };

  const listAccessibleCustomers = async () => {
    const at = await token();
    const { json } = await requestJson(`${ADS()}/customers:listAccessibleCustomers`, { headers: adsHeaders(at), fetchImpl, label: 'google' });
    return ((json && json.resourceNames) || []).map((r) => digits(r)).filter((id) => id.length === 10);
  };

  /**
   * Every account the user can pick: directly accessible accounts, plus the
   * client accounts under each accessible manager (level ≤ 2). Managers are
   * listed (for context) but are not selectable for conversions.
   */
  const listAccounts = async ({ maxRoots = 25 } = {}) => {
    const roots = (await listAccessibleCustomers()).slice(0, maxRoots);
    const byId = new Map();
    for (const rootId of roots) {
      let rows;
      try {
        rows = await search(
          rootId,
          'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.level, ' +
            'customer_client.currency_code, customer_client.status FROM customer_client WHERE customer_client.level <= 2',
          rootId
        );
      } catch (err) {
        // Cancelled / suspended / not-enabled accounts error here — skip them.
        console.warn('[google] customer_client query skipped for a root account:', err.message);
        continue;
      }
      const rootRow = rows.find((r) => r.customerClient && digits(r.customerClient.id) === rootId);
      const rootIsManager = !!(rootRow && rootRow.customerClient.manager);
      for (const r of rows) {
        const c = r.customerClient || {};
        const id = digits(c.id);
        if (id.length !== 10) continue;
        const level = Number(c.level || 0);
        const entry = {
          customerId: id,
          name: c.descriptiveName || '',
          manager: !!c.manager,
          // Reaching a client through a manager needs that manager as login-customer-id.
          loginCustomerId: level > 0 && rootIsManager ? rootId : '',
          parentId: level > 0 ? rootId : '',
          level,
          currencyCode: c.currencyCode || '',
          autoTagging: null,
          status: c.status || '',
        };
        const prev = byId.get(id);
        // Prefer direct access (level 0) over access via a manager.
        if (!prev || entry.level < prev.level) byId.set(id, entry);
      }
    }
    return [...byId.values()].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  };

  const customerSettings = async (customerId, loginCustomerId) => {
    const rows = await search(
      customerId,
      'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.auto_tagging_enabled, ' +
        'customer.manager, customer.conversion_tracking_setting.conversion_tracking_id FROM customer',
      loginCustomerId
    );
    const c = (rows[0] && rows[0].customer) || {};
    const trackingId = c.conversionTrackingSetting && c.conversionTrackingSetting.conversionTrackingId;
    return {
      customerId: digits(c.id || customerId),
      name: c.descriptiveName || '',
      currencyCode: c.currencyCode || '',
      autoTagging: !!c.autoTaggingEnabled,
      manager: !!c.manager,
      conversionTrackingId: trackingId ? `AW-${digits(trackingId)}` : '',
    };
  };

  /**
   * Turn on auto-tagging (gclid on ad clicks).
   * VERIFY once the developer token is approved: REST path
   * `customers/{id}/customers:mutate` with `operation.update` + `updateMask`.
   */
  const enableAutoTagging = (customerId, loginCustomerId) =>
    mutate(
      customerId,
      'customers:mutate',
      { operation: { update: { resourceName: `customers/${digits(customerId)}`, autoTaggingEnabled: true }, updateMask: 'autoTaggingEnabled' } },
      loginCustomerId
    );

  /**
   * Find-or-create the two LeadLoop offline conversion actions. Returns
   * `{ qualified: resourceName, customer: resourceName }`.
   */
  const ensureConversionActions = async (customerId, loginCustomerId) => {
    const wanted = CONVERSION_ACTIONS;
    const names = Object.values(wanted).map((w) => `'${w.name.replace(/'/g, "\\'")}'`);
    const rows = await search(
      customerId,
      `SELECT conversion_action.resource_name, conversion_action.name, conversion_action.status FROM conversion_action WHERE conversion_action.name IN (${names.join(', ')})`,
      loginCustomerId
    );
    const out = {};
    const toCreate = [];
    for (const [stage, def] of Object.entries(wanted)) {
      const hit = rows.find((r) => r.conversionAction && r.conversionAction.name === def.name && r.conversionAction.status !== 'REMOVED');
      if (hit) out[stage] = hit.conversionAction.resourceName;
      else toCreate.push(stage);
    }
    if (toCreate.length) {
      const json = await mutate(
        customerId,
        'conversionActions:mutate',
        { operations: toCreate.map((stage) => ({ create: conversionActionCreate(wanted[stage]) })) },
        loginCustomerId
      );
      const results = (json && json.results) || [];
      toCreate.forEach((stage, i) => {
        if (results[i] && results[i].resourceName) out[stage] = results[i].resourceName;
      });
    }
    return out;
  };

  return { search, listAccessibleCustomers, listAccounts, customerSettings, enableAutoTagging, ensureConversionActions, accessToken: token };
};

const CONVERSION_ACTIONS = {
  qualified: { name: 'LeadLoop · Qualified lead', category: 'QUALIFIED_LEAD' },
  customer: { name: 'LeadLoop · Customer', category: 'CONVERTED_LEAD' },
};

/** The ConversionAction `create` body (pure — unit-tested). */
const conversionActionCreate = ({ name, category }) => ({
  name,
  category,
  type: 'UPLOAD_CLICKS',
  status: 'ENABLED',
  valueSettings: { defaultValue: 1, alwaysUseDefaultValue: false },
  countingType: 'ONE_PER_CLICK',
});

module.exports = {
  isConfigured,
  authUrl,
  exchangeCode,
  client,
  hasGtmScopes,
  conversionActionCreate,
  CONVERSION_ACTIONS,
  BASE_SCOPES,
  GTM_SCOPES,
};
