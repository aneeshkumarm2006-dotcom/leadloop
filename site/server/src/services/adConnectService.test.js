/**
 * adConnectService.test.js — authz / state / idempotency rules of the one-click
 * ad connections, with stubbed model statics and a fake fetch (no DB/network).
 * Run: node --test src/services/adConnectService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.EMAIL_TOKEN_ENCRYPTION_KEY = 'c'.repeat(64);
process.env.JWT_SECRET = 'test-secret';
Object.assign(process.env, {
  META_APP_ID: '111',
  META_APP_SECRET: 'meta-secret',
  TIKTOK_APP_ID: 'tt-app',
  TIKTOK_APP_SECRET: 'tt-secret',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'dev',
  GOOGLE_ADS_OAUTH_CLIENT_ID: 'g-cid',
  GOOGLE_ADS_OAUTH_CLIENT_SECRET: 'g-sec',
  WEBHOOK_PUBLIC_BASE_URL: 'https://api.example.com',
});

require('../models');
const AdConversionConfig = require('../models/AdConversionConfig');
const Organisation = require('../models/Organisation');
const Board = require('../models/Board');
const AdLeadReceipt = require('../models/AdLeadReceipt');
const stateSvc = require('./adConnectState');
const svc = require('./adConnectService');

const WS = '6aece1bafafc81bd75d22e00';
const USER = '6aece1bafafc81bd75d22e01';
const OTHER = '6aece1bafafc81bd75d22e02';
const BOARD = '6aece1bafafc81bd75d22e89';

const stubs = [];
const stub = (obj, key, fn) => {
  const orig = obj[key];
  obj[key] = fn;
  stubs.push(() => {
    obj[key] = orig;
  });
};
test.afterEach(() => {
  while (stubs.length) stubs.pop()();
});
const lean = (v) => ({ select: () => ({ lean: async () => v }), lean: async () => v });

const fakeFetch = (handler) => {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const { status = 200, json } = handler(String(url), init) || {};
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
};

const newConfig = () => {
  const c = new AdConversionConfig({ workspaceId: WS });
  c.save = async function save() {
    return this;
  };
  return c;
};

const callbackQuery = (platform, userId = USER) => {
  const { state, nonceHash } = stateSvc.signState({ userId, workspaceId: WS, platform });
  return { query: { code: 'the-code', state }, nonceHash };
};

test('startOAuth: unknown platform 400; unconfigured platform 503 not_configured', async () => {
  await assert.rejects(svc.startOAuth({ platform: 'linkedin', workspaceId: WS, userId: USER }), (e) => e.status === 400);
  const saved = process.env.TIKTOK_APP_SECRET;
  delete process.env.TIKTOK_APP_SECRET;
  await assert.rejects(svc.startOAuth({ platform: 'tiktok', workspaceId: WS, userId: USER }), (e) => e.status === 503 && e.code === 'not_configured');
  process.env.TIKTOK_APP_SECRET = saved;
});

test('startOAuth: stores the nonce hash and returns the consent URL with our callback', async () => {
  let update;
  stub(AdConversionConfig, 'updateOne', async (q, u) => {
    update = { q, u };
  });
  const url = new URL(await svc.startOAuth({ platform: 'meta', workspaceId: WS, userId: USER }));
  assert.equal(url.searchParams.get('redirect_uri'), 'https://api.example.com/api/ad-connect/callback/meta');
  const decoded = stateSvc.verifyState(url.searchParams.get('state'));
  assert.equal(decoded.workspaceId, WS);
  assert.equal(update.u.$set['oauthNonces.meta'], stateSvc.hashNonce(decoded.nonce));
});

test('completeOAuth: user no longer admin → not_allowed (before any token exchange)', async () => {
  stub(Organisation, 'findById', () => lean({ _id: WS, admin: OTHER, admins: [] }));
  const f = fakeFetch(() => ({ json: {} }));
  const { query } = callbackQuery('meta');
  await assert.rejects(svc.completeOAuth({ platform: 'meta', query, fetchImpl: f }), (e) => e.code === 'not_allowed');
  assert.equal(f.calls.length, 0);
});

test('completeOAuth: platform mismatch / reused state are refused', async () => {
  stub(Organisation, 'findById', () => lean({ _id: WS, admin: USER, admins: [] }));
  const { query } = callbackQuery('meta');
  await assert.rejects(svc.completeOAuth({ platform: 'google', query }), (e) => e.code === 'failed');
  stub(AdConversionConfig, 'findOneAndUpdate', async () => null); // nonce already consumed
  await assert.rejects(svc.completeOAuth({ platform: 'meta', query }), (e) => e.code === 'expired');
});

// --- callback parks the grant; the starting admin must confirm ------------------------

const metaFetch = () =>
  fakeFetch((url) => {
    if (url.includes('fb_exchange_token')) return { json: { access_token: 'EAALONG', expires_in: 5184000 } };
    if (url.includes('oauth/access_token')) return { json: { access_token: 'EAASHORT' } };
    return { json: { id: '42', name: 'Jane Admin' } };
  });

/** Run the callback against an in-memory config; returns { config, pendingId }. */
const parkMetaGrant = async () => {
  stub(Organisation, 'findById', () => lean({ _id: WS, admin: OTHER, admins: [USER] }));
  const config = newConfig();
  const { query, nonceHash } = callbackQuery('meta');
  let filter;
  stub(AdConversionConfig, 'findOneAndUpdate', async (q) => {
    filter = q;
    return config;
  });
  const r = await svc.completeOAuth({ platform: 'meta', query, fetchImpl: metaFetch() });
  assert.equal(filter['oauthNonces.meta'], nonceHash);
  while (stubs.length) stubs.pop()();
  return { config, pendingId: r.pendingId, result: r };
};

/** Emulates the atomic findOneAndUpdate / findOne Mongo would run in confirmOAuth. */
const wireConfirm = (config) => {
  const matches = (q) =>
    Object.entries(q).every(([k, v]) => {
      if (k === 'workspaceId') return String(config.workspaceId) === String(v);
      const val = config.get(k);
      if (v && v.$gt) return val && new Date(val) > v.$gt;
      return val === v;
    });
  stub(AdConversionConfig, 'findOneAndUpdate', async (q) => (matches(q) ? config : null));
  stub(AdConversionConfig, 'findOne', (q) => ({ select: () => ({ lean: async () => (matches(q) ? { _id: 1 } : null) }) }));
  stub(require('../models/ConversionEvent'), 'aggregate', async () => []);
};

test('callback: exchanges but does NOT activate — grant parked encrypted with a one-time id', async () => {
  const { config, pendingId, result } = await parkMetaGrant();
  assert.equal(result.platform, 'meta');
  assert.match(pendingId, /^[0-9a-f]{48}$/);
  const p = config.pendingOAuth.meta;
  assert.equal(p.userId, USER);
  assert.equal(p.idHash, svc.hashKey(pendingId)); // only the hash is stored
  assert.ok(!p.grant.includes('EAALONG'));
  assert.ok(p.expiresAt - p.createdAt === 10 * 60 * 1000);
  // Nothing active yet.
  assert.equal(config.getMetaUserToken(), null);
  assert.equal(config.meta.connection.status, 'none');
  assert.equal(svc.hasPending(config, 'meta'), true);
  assert.equal(svc.serializeMeta(config).status, 'none');
});

test('confirm: the starting admin activates it (status authorized), slot cleared', async () => {
  const { config, pendingId } = await parkMetaGrant();
  wireConfirm(config);
  const out = await svc.confirmOAuth({ platform: 'meta', workspaceId: WS, userId: USER, pendingId });
  assert.equal(out.meta.status, 'authorized');
  assert.equal(out.meta.userName, 'Jane Admin');
  assert.ok(!JSON.stringify(out).includes('EAALONG'));
  assert.equal(config.getMetaUserToken(), 'EAALONG');
  assert.equal(config.meta.connection.method, 'oauth');
  assert.equal(config.meta.enabled, false); // still not live until assets are chosen
  assert.equal(config.pendingOAuth.meta, null);
});

test('confirm: another user (or another workspace) → 403 confirm_mismatch, nothing activated', async () => {
  const { config, pendingId } = await parkMetaGrant();
  wireConfirm(config);
  await assert.rejects(svc.confirmOAuth({ platform: 'meta', workspaceId: WS, userId: OTHER, pendingId }), (e) => e.status === 403 && e.code === 'confirm_mismatch');
  await assert.rejects(
    svc.confirmOAuth({ platform: 'meta', workspaceId: '6aece1bafafc81bd75d22eff', userId: USER, pendingId }),
    (e) => e.status === 403 && e.code === 'confirm_mismatch'
  );
  assert.equal(config.getMetaUserToken(), null);
  assert.ok(config.pendingOAuth.meta); // the rightful admin can still confirm
});

test('confirm: expired → 410 pending_expired', async () => {
  const { config, pendingId } = await parkMetaGrant();
  config.pendingOAuth.meta.expiresAt = new Date(Date.now() - 1000);
  wireConfirm(config);
  await assert.rejects(svc.confirmOAuth({ platform: 'meta', workspaceId: WS, userId: USER, pendingId }), (e) => e.status === 410 && e.code === 'pending_expired');
  assert.equal(svc.hasPending(config, 'meta'), false);
  assert.equal(config.getMetaUserToken(), null);
});

test('confirm: replay / unknown id / wrong platform → 410 pending_expired', async () => {
  const { config, pendingId } = await parkMetaGrant();
  wireConfirm(config);
  await svc.confirmOAuth({ platform: 'meta', workspaceId: WS, userId: USER, pendingId });
  await assert.rejects(svc.confirmOAuth({ platform: 'meta', workspaceId: WS, userId: USER, pendingId }), (e) => e.status === 410);
  await assert.rejects(svc.confirmOAuth({ platform: 'meta', workspaceId: WS, userId: USER, pendingId: 'f'.repeat(48) }), (e) => e.status === 410);
  await assert.rejects(svc.confirmOAuth({ platform: 'meta', workspaceId: WS, userId: USER, pendingId: 'not-hex' }), (e) => e.code === 'pending_expired');
  await assert.rejects(svc.confirmOAuth({ platform: 'google', workspaceId: WS, userId: USER, pendingId }), (e) => e.status === 410);
});

test('metaPixels / metaSelect validate ids and require the account to be visible to the token', async () => {
  const config = newConfig();
  config.meta.connection.method = 'oauth';
  config.setMetaUserToken('EAATOKEN');
  stub(AdConversionConfig, 'findOne', async () => config);
  await assert.rejects(svc.metaPixels(WS, '123'), (e) => e.code === 'invalid_ad_account');
  const f = fakeFetch((url) => (url.includes('/me/adaccounts') ? { json: { data: [{ id: 'act_1', name: 'Mine' }] } } : { json: { data: [] } }));
  await assert.rejects(svc.metaSelect(WS, { adAccountId: 'act_999', pixelId: '5' }, { fetchImpl: f }), (e) => e.status === 403);
  await assert.rejects(svc.metaSelect(WS, { adAccountId: 'act_1', pixelId: '5' }, { fetchImpl: f }), (e) => e.code === 'invalid_pixel');
  assert.equal(config.meta.enabled, false);
});

test('metaLeadAds: board must belong to the workspace; pages must be managed by the login', async () => {
  const config = newConfig();
  config.meta.connection.method = 'oauth';
  config.setMetaUserToken('EAATOKEN');
  stub(AdConversionConfig, 'findOne', async () => config);
  stub(Board, 'findOne', () => lean(null)); // board of another workspace
  await assert.rejects(svc.metaLeadAds(WS, { pageIds: ['555'], boardId: BOARD }), (e) => e.code === 'invalid_board');
  await assert.rejects(svc.metaLeadAds(WS, { pageIds: ['../x'], boardId: BOARD }), (e) => e.code === 'invalid_pages');

  stub(Board, 'findOne', () => lean({ _id: BOARD }));
  const f = fakeFetch(() => ({ json: { data: [{ id: '777', name: 'Other page', access_token: 'PAGE' }] } }));
  await assert.rejects(svc.metaLeadAds(WS, { pageIds: ['555'], boardId: BOARD }, { fetchImpl: f }), (e) => e.status === 403);
});

test('googleSelect: customer must be reachable by the login; managers refused; login id from discovery', async () => {
  const config = newConfig();
  config.google.connection.method = 'oauth';
  config.setGoogleRefreshToken('1//rt-select');
  stub(AdConversionConfig, 'findOne', async () => config);
  const f = fakeFetch((url) => {
    if (url.includes('oauth2')) return { json: { access_token: 'at', expires_in: 3600 } };
    if (url.includes('listAccessibleCustomers')) return { json: { resourceNames: ['customers/1110001111'] } };
    return {
      json: {
        results: [
          { customerClient: { id: '1110001111', descriptiveName: 'MCC', manager: true, level: '0' } },
          { customerClient: { id: '3330003333', descriptiveName: 'Client', manager: false, level: '1' } },
        ],
      },
    };
  });
  await assert.rejects(svc.googleSelect(WS, { customerId: '4440004444' }, { fetchImpl: f }), (e) => e.status === 403);
  await assert.rejects(svc.googleSelect(WS, { customerId: '1110001111' }, { fetchImpl: f }), (e) => e.code === 'manager_account');
  await assert.rejects(svc.googleSelect(WS, { customerId: 'abc' }, { fetchImpl: f }), (e) => e.code === 'invalid_customer');
});

test('googleAccounts / gtm require an OAuth Google connection (+ GTM scopes)', async () => {
  const config = newConfig();
  stub(AdConversionConfig, 'findOne', async () => config);
  await assert.rejects(svc.googleAccounts(WS), (e) => e.code === 'not_authorized');
  config.google.connection.method = 'oauth';
  config.setGoogleRefreshToken('1//rt');
  config.google.connection.scopes = ['https://www.googleapis.com/auth/adwords'];
  await assert.rejects(svc.gtmContainers(WS), (e) => e.status === 403 && e.code === 'needs_gtm_scope');
});

test('tiktokSelect / tiktokPixels: advertiser must be one the token was granted', async () => {
  const config = newConfig();
  config.setTikTokToken('TT');
  config.tiktok.connection.advertiserIds = ['123'];
  stub(AdConversionConfig, 'findOne', async () => config);
  await assert.rejects(svc.tiktokPixels(WS, '999'), (e) => e.status === 403);
  await assert.rejects(svc.tiktokSelect(WS, { advertiserId: '999', pixelCode: 'CABCDEFGH1' }), (e) => e.status === 403);
  await assert.rejects(svc.tiktokTest(WS, { testEventCode: 'bad code!' }), (e) => e.code === 'invalid_test_code');
});

test('tiktok webhook auth: URL secret must match; a present-but-wrong signature is refused', async () => {
  const key = 'a'.repeat(48);
  const config = newConfig();
  let query;
  stub(AdConversionConfig, 'findOne', async (q) => {
    query = q;
    return q['tiktok.instantForms.webhookKeyHash'] === svc.hashKey(key) ? config : null;
  });
  const raw = Buffer.from('{"lead_id":"1"}');
  assert.equal(await svc.authenticateTikTokWebhook({ key: 'b'.repeat(48), rawBody: raw }), null);
  assert.equal(await svc.authenticateTikTokWebhook({ key, rawBody: raw }), config);
  assert.equal(query['tiktok.instantForms.enabled'], true);
  assert.equal(await svc.authenticateTikTokWebhook({ key, rawBody: raw, signatureHeader: `t=${Math.floor(Date.now() / 1000)},s=${'0'.repeat(64)}` }), null);
});

test('processMetaWebhook: duplicate leadgen deliveries are ingested once', async () => {
  const config = newConfig();
  config.meta.connection.pages = [{ pageId: '555', name: 'P', accessToken: AdConversionConfig.encryptToken('PAGETOKEN'), subscribed: true, connectionId: BOARD }];
  stub(AdConversionConfig, 'find', async () => [config]);
  const claimed = new Set();
  stub(AdLeadReceipt, 'create', async (doc) => {
    const k = `${doc.workspaceId}:${doc.platform}:${doc.externalId}`;
    if (claimed.has(k)) {
      const e = new Error('dup');
      e.code = 11000;
      throw e;
    }
    claimed.add(k);
    return { ...doc, save: async () => {} };
  });
  const ingest = require('./leadIngestService');
  const ingested = [];
  stub(ingest, 'ingestForConnection', async (cid, payload) => {
    ingested.push({ cid: String(cid), payload });
  });
  const f = fakeFetch((url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer PAGETOKEN');
    return { json: { id: '9001', field_data: [{ name: 'email', values: ['a@b.co'] }], form_id: '77' } };
  });
  const body = { object: 'page', entry: [{ id: '555', changes: [{ field: 'leadgen', value: { leadgen_id: '9001', page_id: '555' } }] }] };
  await svc.processMetaWebhook(body, { fetchImpl: f });
  await svc.processMetaWebhook(body, { fetchImpl: f });
  assert.equal(ingested.length, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(ingested[0].payload.leadgen_id, '9001');
  assert.ok(!('id' in ingested[0].payload));
});

test('serializers never leak tokens; manual Meta config reads as ready', () => {
  const c = newConfig();
  c.meta.enabled = true;
  c.meta.datasetId = '123456789';
  c.setMetaToken('EAAMANUAL');
  c.setGoogleRefreshToken('1//secret-refresh');
  c.setTikTokToken('tt-secret-token');
  const out = JSON.stringify([svc.serializeMeta(c), svc.serializeGoogle(c), svc.serializeTikTok(c)]);
  for (const s of ['EAAMANUAL', 'secret-refresh', 'tt-secret-token', c.meta.accessToken]) assert.ok(!out.includes(s));
  assert.equal(svc.serializeMeta(c).status, 'ready');
  assert.equal(svc.serializeMeta(c).method, 'manual');
  assert.equal(svc.serializeMeta(c).live, true);
});

test('snippetTagFor matches the Lead Sources tag exactly', () => {
  assert.equal(
    svc.snippetTagFor({ siteKey: 'site_abc123' }),
    '<script src="https://api.example.com/capture.js" data-site="site_abc123" defer></script>'
  );
  assert.equal(svc.snippetTagFor({}), '');
});

test('availability degrades when env is missing', () => {
  const saved = process.env.META_APP_ID;
  delete process.env.META_APP_ID;
  assert.equal(svc.availability().meta, false);
  process.env.META_APP_ID = saved;
  assert.deepEqual(svc.availability(), { meta: true, google: true, tiktok: true, gtm: true, encryption: true });
  const key = process.env.EMAIL_TOKEN_ENCRYPTION_KEY;
  delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY;
  assert.deepEqual(svc.availability(), { meta: false, google: false, tiktok: false, gtm: false, encryption: false });
  process.env.EMAIL_TOKEN_ENCRYPTION_KEY = key;
});
