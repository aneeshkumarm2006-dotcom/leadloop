/**
 * adConnect.test.js — pure pieces of the one-click ad connections: OAuth state,
 * Meta webhook signature / parsing, TikTok webhook helpers, Google Ads + GTM
 * request builders, and the platform clients against a fake fetch.
 * Run: node --test src/services/adConnect.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.EMAIL_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);
process.env.JWT_SECRET = 'test-secret';
Object.assign(process.env, {
  META_APP_ID: '111',
  META_APP_SECRET: 'meta-secret',
  META_WEBHOOK_VERIFY_TOKEN: 'verify-me',
  TIKTOK_APP_ID: 'tt-app',
  TIKTOK_APP_SECRET: 'tt-secret',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'dev',
  GOOGLE_ADS_OAUTH_CLIENT_ID: 'g-cid',
  GOOGLE_ADS_OAUTH_CLIENT_SECRET: 'g-sec',
});

const jwt = require('jsonwebtoken');
const stateSvc = require('./adConnectState');
const metaGraph = require('./metaGraph');
const tiktokApi = require('./tiktokApi');
const googleAdsApi = require('./googleAdsApi');
const googleTagManager = require('./googleTagManager');
const { requestJson } = require('./adConnectHttp');

const fakeFetch = (handler) => {
  const calls = [];
  const fn = async (url, init = {}) => {
    let body = init.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = new URLSearchParams(body);
      }
    }
    calls.push({ url: String(url), init, body });
    const { status = 200, json } = handler(String(url), init, body) || {};
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
};

// --- state ------------------------------------------------------------------------

test('state: signed, bound to user/workspace/platform, nonce single-use hash', () => {
  const { state, nonceHash } = stateSvc.signState({ userId: 'u1', workspaceId: 'w1', platform: 'google', gtm: true });
  const d = stateSvc.verifyState(state);
  assert.deepEqual([d.userId, d.workspaceId, d.platform, d.gtm], ['u1', 'w1', 'google', true]);
  assert.equal(stateSvc.nonceMatches(d, nonceHash), true);
  assert.equal(stateSvc.nonceMatches(d, stateSvc.hashNonce('other')), false);
  assert.equal(stateSvc.nonceMatches(d, null), false);
});

test('state: rejects tampering, other kinds, other secrets, expiry, unknown platform', () => {
  const { state } = stateSvc.signState({ userId: 'u1', workspaceId: 'w1', platform: 'meta' });
  assert.throws(() => stateSvc.verifyState(`${state}x`));
  assert.throws(() => stateSvc.verifyState(state, { secret: 'nope' }));
  const emailState = jwt.sign({ kind: 'email_oauth', userId: 'u', workspaceId: 'w', provider: 'gmail', nonce: 'n' }, 'test-secret');
  assert.throws(() => stateSvc.verifyState(emailState), /Invalid OAuth state/);
  const expired = stateSvc.signState({ userId: 'u', workspaceId: 'w', platform: 'meta' }, { expiresIn: -10 }).state;
  assert.throws(() => stateSvc.verifyState(expired));
  assert.throws(() => stateSvc.signState({ userId: 'u', workspaceId: 'w', platform: 'linkedin' }));
  const none = jwt.sign({ kind: 'ad_connect_oauth', platform: 'meta', nonce: 'n' }, '', { algorithm: 'none' });
  assert.throws(() => stateSvc.verifyState(none));
});

// --- Meta -------------------------------------------------------------------------

test('meta: webhook signature over the RAW body (constant-time, strict format)', () => {
  const raw = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));
  const sig = `sha256=${crypto.createHmac('sha256', 'meta-secret').update(raw).digest('hex')}`;
  assert.equal(metaGraph.verifySignature(raw, sig), true);
  assert.equal(metaGraph.verifySignature(Buffer.from(`${raw} `), sig), false);
  assert.equal(metaGraph.verifySignature(raw, sig.replace('sha256=', 'sha1=')), false);
  assert.equal(metaGraph.verifySignature(raw, ''), false);
  assert.equal(metaGraph.verifySignature(raw, undefined), false);
  assert.equal(metaGraph.verifySignature(raw.toString(), sig), false); // must be bytes
  assert.equal(metaGraph.verifySignature(raw, sig, ''), false); // no secret → never valid
});

test('meta: hub.challenge only with the right verify token', () => {
  const q = { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' };
  assert.equal(metaGraph.verifyChallenge(q), '12345');
  assert.equal(metaGraph.verifyChallenge({ ...q, 'hub.verify_token': 'nope' }), null);
  assert.equal(metaGraph.verifyChallenge({ ...q, 'hub.challenge': '<script>' }), null);
  assert.equal(metaGraph.verifyChallenge(q, ''), null);
});

test('meta: leadgen changes parsed; junk ids and other fields ignored', () => {
  const out = metaGraph.parseLeadgenChanges({
    object: 'page',
    entry: [
      {
        id: '555',
        changes: [
          { field: 'leadgen', value: { leadgen_id: '9001', page_id: '555', form_id: '77', ad_id: '88', created_time: 1 } },
          { field: 'feed', value: { leadgen_id: '1' } },
          { field: 'leadgen', value: { leadgen_id: '../me', page_id: '555' } },
        ],
      },
    ],
  });
  assert.deepEqual(out, [{ pageId: '555', leadgenId: '9001', formId: '77', adId: '88', createdTime: 1 }]);
  assert.deepEqual(metaGraph.parseLeadgenChanges({ object: 'user', entry: [] }), []);
  assert.deepEqual(metaGraph.parseLeadgenChanges(null), []);
});

test('meta: auth URL uses config_id for Login for Business, scopes otherwise', () => {
  delete process.env.META_LOGIN_CONFIG_ID;
  let u = new URL(metaGraph.authUrl({ state: 's', redirectUri: 'https://api.x/cb' }));
  assert.equal(u.hostname, 'www.facebook.com');
  assert.match(u.searchParams.get('scope'), /leads_retrieval/);
  assert.equal(u.searchParams.get('config_id'), null);
  process.env.META_LOGIN_CONFIG_ID = 'cfg1';
  u = new URL(metaGraph.authUrl({ state: 's', redirectUri: 'https://api.x/cb' }));
  assert.equal(u.searchParams.get('config_id'), 'cfg1');
  assert.equal(u.searchParams.get('scope'), null);
  delete process.env.META_LOGIN_CONFIG_ID;
});

test('meta: code → long-lived token; graph calls carry appsecret_proof, token in header', async () => {
  const f = fakeFetch((url) => {
    if (url.includes('fb_exchange_token')) return { json: { access_token: 'LONG', expires_in: 5184000 } };
    if (url.includes('oauth/access_token')) return { json: { access_token: 'SHORT', expires_in: 3600 } };
    if (url.includes('/me/adaccounts')) return { json: { data: [{ id: 'act_1', account_id: '1', name: 'Acme', currency: 'CAD', business: { id: '9', name: 'B' } }] } };
    return { json: { id: '42', name: 'Jane' } };
  });
  const { accessToken, expiresAt } = await metaGraph.exchangeCode({ code: 'c', redirectUri: 'https://api.x/cb', fetchImpl: f });
  assert.equal(accessToken, 'LONG');
  assert.ok(expiresAt instanceof Date && expiresAt > new Date());
  const accounts = await metaGraph.listAdAccounts('LONG', { fetchImpl: f });
  assert.deepEqual(accounts, [{ id: 'act_1', accountId: '1', name: 'Acme', businessId: '9', currency: 'CAD' }]);
  const call = f.calls.find((c) => c.url.includes('/me/adaccounts'));
  assert.equal(call.init.headers.Authorization, 'Bearer LONG');
  assert.equal(new URL(call.url).searchParams.get('appsecret_proof'), metaGraph.appSecretProof('LONG'));
  assert.ok(!call.url.includes('access_token=LONG'));
});

test('http: refuses non-allow-listed hosts and plain http', async () => {
  await assert.rejects(requestJson('https://169.254.169.254/latest/meta-data', { fetchImpl: fakeFetch(() => ({})) }), /refusing/);
  await assert.rejects(requestJson('http://graph.facebook.com/x', { fetchImpl: fakeFetch(() => ({})) }), /refusing/);
  await assert.rejects(
    requestJson('https://graph.facebook.com/x', { fetchImpl: fakeFetch(() => ({ status: 401, json: { error: { message: 'expired', code: 190 } } })) }),
    (err) => err.code === 'platform_auth' && err.status === 401
  );
});

// --- TikTok -----------------------------------------------------------------------

test('tiktok: code exchange + body-level error mapping', async () => {
  const f = fakeFetch((url) =>
    url.includes('access_token') ? { json: { code: 0, data: { access_token: 'TT', advertiser_ids: [123, '456'] } } } : { json: { code: 40105, message: 'token expired' } }
  );
  const r = await tiktokApi.exchangeCode({ code: 'ac', fetchImpl: f });
  assert.deepEqual(r.advertiserIds, ['123', '456']);
  assert.deepEqual(f.calls[0].body, { app_id: 'tt-app', secret: 'tt-secret', auth_code: 'ac' });
  await assert.rejects(tiktokApi.listPixels('TT', '123', { fetchImpl: f }), (err) => err.code === 'platform_auth');
});

test('tiktok: auth URL', () => {
  const u = new URL(tiktokApi.authUrl({ state: 's1', redirectUri: 'https://api.x/cb/tiktok' }));
  assert.equal(u.hostname, 'business-api.tiktok.com');
  assert.equal(u.searchParams.get('app_id'), 'tt-app');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://api.x/cb/tiktok');
});

test('tiktok: webhook signature — absent → null, wrong/stale → false, right → true', () => {
  const raw = Buffer.from('{"lead_id":"1"}');
  const now = Date.now();
  const t = Math.floor(now / 1000);
  const s = crypto.createHmac('sha256', 'tt-secret').update(`${t}.${raw}`).digest('hex');
  assert.equal(tiktokApi.verifyWebhookSignature(raw, '', { now }), null);
  assert.equal(tiktokApi.verifyWebhookSignature(raw, `t=${t},s=${s}`, { now }), true);
  assert.equal(tiktokApi.verifyWebhookSignature(raw, `t=${t},s=${'0'.repeat(64)}`, { now }), false);
  assert.equal(tiktokApi.verifyWebhookSignature(raw, `t=${t - 3600},s=${s}`, { now }), false);
  assert.equal(tiktokApi.verifyWebhookSignature(raw, 'garbage', { now }), false);
});

test('tiktok: lead extraction tolerates envelopes, drops bad ids', () => {
  assert.deepEqual(
    tiktokApi.extractLeads({ advertiser_id: '9', leads: [{ lead_id: 'a1', field_data: [] }, { lead_id: '../x' }] }).map((l) => [l.leadId, l.advertiserId]),
    [['a1', '9']]
  );
  assert.equal(tiktokApi.extractLeads({ data: { leads: [{ lead_id: 'b2' }] } })[0].leadId, 'b2');
  assert.equal(tiktokApi.extractLeads({ lead: { lead_id: 'c3', advertiser_id: '7' } })[0].advertiserId, '7');
  assert.equal(tiktokApi.extractLeads({ lead_id: 'd4' })[0].leadId, 'd4');
  assert.deepEqual(tiktokApi.extractLeads({ nothing: true }), []);
  assert.deepEqual(tiktokApi.extractLeads(null), []);
});

// --- Google -----------------------------------------------------------------------

test('google: auth URL requests offline access, GTM scopes only when asked', () => {
  let u = new URL(googleAdsApi.authUrl({ state: 's', redirectUri: 'https://api.x/cb/google' }));
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('prompt'), 'consent');
  assert.equal(u.searchParams.get('client_id'), 'g-cid');
  assert.ok(!u.searchParams.get('scope').includes('tagmanager'));
  u = new URL(googleAdsApi.authUrl({ state: 's', redirectUri: 'https://api.x/cb/google', gtm: true }));
  for (const s of googleAdsApi.GTM_SCOPES) assert.ok(u.searchParams.get('scope').includes(s));
  assert.equal(googleAdsApi.hasGtmScopes(googleAdsApi.GTM_SCOPES), true);
  assert.equal(googleAdsApi.hasGtmScopes(googleAdsApi.BASE_SCOPES), false);
  assert.equal(googleAdsApi.hasGtmScopes(googleAdsApi.GTM_SCOPES.join(' ')), true);
});

test('google: conversion action create body', () => {
  assert.deepEqual(googleAdsApi.conversionActionCreate(googleAdsApi.CONVERSION_ACTIONS.qualified), {
    name: 'LeadLoop · Qualified lead',
    category: 'QUALIFIED_LEAD',
    type: 'UPLOAD_CLICKS',
    status: 'ENABLED',
    valueSettings: { defaultValue: 1, alwaysUseDefaultValue: false },
    countingType: 'ONE_PER_CLICK',
  });
  assert.equal(googleAdsApi.CONVERSION_ACTIONS.customer.category, 'CONVERTED_LEAD');
});

test('google: account discovery walks managers; clients get the manager as login id', async () => {
  const f = fakeFetch((url, init, body) => {
    if (url.includes('oauth2')) return { json: { access_token: 'at', expires_in: 3600 } };
    if (url.includes('listAccessibleCustomers')) return { json: { resourceNames: ['customers/1110001111', 'customers/2220002222'] } };
    if (url.includes('1110001111/googleAds:search')) {
      return {
        json: {
          results: [
            { customerClient: { id: '1110001111', descriptiveName: 'Agency MCC', manager: true, level: '0' } },
            { customerClient: { id: '3330003333', descriptiveName: 'Client A', manager: false, level: '1', currencyCode: 'CAD' } },
          ],
        },
      };
    }
    return { json: { results: [{ customerClient: { id: '2220002222', descriptiveName: 'Direct', manager: false, level: '0' } }] } };
  });
  const accounts = await googleAdsApi.client('1//rt-discovery', { fetchImpl: f }).listAccounts();
  const a = accounts.find((x) => x.customerId === '3330003333');
  assert.equal(a.loginCustomerId, '1110001111');
  assert.equal(a.manager, false);
  assert.equal(accounts.find((x) => x.customerId === '2220002222').loginCustomerId, '');
  assert.equal(accounts.find((x) => x.customerId === '1110001111').manager, true);
  const search = f.calls.find((c) => c.url.includes('1110001111/googleAds:search'));
  assert.equal(search.init.headers['login-customer-id'], '1110001111');
  assert.equal(search.init.headers['developer-token'], 'dev');
});

test('google: ensureConversionActions reuses existing, creates missing', async () => {
  const f = fakeFetch((url) => {
    if (url.includes('oauth2')) return { json: { access_token: 'at', expires_in: 3600 } };
    if (url.includes('googleAds:search')) {
      return { json: { results: [{ conversionAction: { name: 'LeadLoop · Qualified lead', resourceName: 'customers/3330003333/conversionActions/1', status: 'ENABLED' } }] } };
    }
    return { json: { results: [{ resourceName: 'customers/3330003333/conversionActions/2' }] } };
  });
  const out = await googleAdsApi.client('1//rt-actions', { fetchImpl: f }).ensureConversionActions('3330003333', '1110001111');
  assert.deepEqual(out, { qualified: 'customers/3330003333/conversionActions/1', customer: 'customers/3330003333/conversionActions/2' });
  const create = f.calls.find((c) => c.url.includes('conversionActions:mutate'));
  assert.equal(create.body.operations.length, 1);
  assert.equal(create.body.operations[0].create.category, 'CONVERTED_LEAD');
});

test('gtm: Custom HTML tag on All Pages; install creates, versions and publishes', async () => {
  const tag = googleTagManager.leadLoopTag('<script src="https://api.x/capture.js" data-site="site_abc" defer></script>');
  assert.equal(tag.type, 'html');
  assert.deepEqual(tag.firingTriggerId, ['2147479553']);
  assert.match(tag.parameter[0].value, /data-site="site_abc"/);

  const f = fakeFetch((url, init) => {
    if (url.includes('oauth2')) return { json: { access_token: 'at', expires_in: 3600 } };
    if (url.endsWith(':publish')) return { json: {} };
    if (url.endsWith(':create_version')) return { json: { containerVersion: { containerVersionId: '7' } } };
    if (url.endsWith('/tags') && init.method === 'POST') return { json: { tagId: '15' } };
    if (url.endsWith('/tags')) return { json: { tag: [] } };
    if (url.endsWith('/workspaces')) return { json: { workspace: [{ workspaceId: '3', name: 'Default Workspace' }] } };
    return { json: { publicId: 'GTM-ABC123' } };
  });
  const r = await googleTagManager.client('1//rt-gtm', { fetchImpl: f }).install({ accountId: '100', containerId: '200', snippetTag: 'x' });
  assert.deepEqual([r.containerPublicId, r.workspaceId, r.tagId, r.versionId], ['GTM-ABC123', '3', '15', '7']);
  assert.ok(f.calls.some((c) => c.url.endsWith('accounts/100/containers/200/versions/7:publish')));
  await assert.rejects(googleTagManager.client('1//rt-gtm', { fetchImpl: f }).install({ accountId: '1/../2', containerId: '2', snippetTag: 'x' }));
});
