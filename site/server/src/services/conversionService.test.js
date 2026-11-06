/**
 * conversionService.test.js — Meta/Google senders + the conversion pipeline,
 * with a fake `fetch` and stubbed model statics (no DB, no network).
 * Run: node --test src/services/conversionService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.EMAIL_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);

require('../models');
const AdConversionConfig = require('../models/AdConversionConfig');
const ConversionEvent = require('../models/ConversionEvent');
const Task = require('../models/Task');
const Board = require('../models/Board');
const metaCapi = require('./metaCapi');
const googleAds = require('./googleAdsConversions');
const svc = require('./conversionService');

const NOW = new Date('2026-11-06T12:00:00Z');
const WS = '6aece1bafafc81bd75d22e00';
const BOARD = '6aece1bafafc81bd75d22e89';
const QUALIFIED = '6aece1c9fafc81bd75d22eaa';
const TASK = '6aece88960cd39d422a79ff6';

const fakeFetch = (handler) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init, body: init && init.body && typeof init.body === 'string' ? JSON.parse(init.body) : init && init.body });
    const { status = 200, json } = handler(String(url), init) || {};
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
};

const makeConfig = (over = {}) => {
  const c = new AdConversionConfig({ workspaceId: WS, rules: [{ boardId: BOARD, groupId: QUALIFIED, stage: 'qualified' }] });
  c.meta.enabled = true;
  c.meta.datasetId = '29215329168108100';
  c.setMetaToken('EAAtesttoken');
  Object.assign(c.meta, over.meta || {});
  return c;
};

const boardDoc = {
  _id: BOARD,
  organisation: WS,
  columns: [
    { _id: 'c1', key: 'name', name: 'Name', type: 'text', order: 0 },
    { _id: 'c4', key: 'email', name: 'Email', type: 'email', order: 3 },
  ],
};
const taskDoc = (attribution) => ({
  _id: TASK,
  name: 'Jane Smith',
  columnValues: new Map([['c4', 'jane@acme.com']]),
  attribution,
});

// --- stub model statics ------------------------------------------------------
const stubs = [];
const stub = (obj, key, fn) => {
  const orig = obj[key];
  obj[key] = fn;
  stubs.push(() => {
    obj[key] = orig;
  });
};
const lean = (v) => ({ select: () => ({ lean: async () => v }), lean: async () => v });
test.afterEach(() => {
  while (stubs.length) stubs.pop()();
});

const wire = ({ config, task, created = [] }) => {
  stub(AdConversionConfig, 'findOne', async () => config);
  stub(Task, 'findById', async () => task);
  stub(Board, 'findById', () => lean(boardDoc));
  stub(ConversionEvent, 'create', async (doc) => {
    if (created.some((d) => d.taskId === doc.taskId && d.platform === doc.platform && d.stage === doc.stage)) {
      const e = new Error('dup');
      e.code = 11000;
      throw e;
    }
    const row = new ConversionEvent(doc);
    row.save = async function save() {
      return this;
    };
    created.push(doc);
    return row;
  });
  return created;
};

// --- senders -------------------------------------------------------------------

test('metaCapi: success, test code, and error classification', async () => {
  const ok = fakeFetch(() => ({ json: { events_received: 1, fbtrace_id: 'abc' } }));
  const r = await metaCapi.sendEvents({ datasetId: '123', accessToken: 't', events: [{ x: 1 }], testEventCode: 'TEST1', fetchImpl: ok });
  assert.equal(r.ok, true);
  assert.match(ok.calls[0].url, /graph\.facebook\.com\/v\d+\.\d+\/123\/events$/);
  assert.equal(ok.calls[0].body.test_event_code, 'TEST1');

  const bad = fakeFetch(() => ({ status: 400, json: { error: { message: 'Invalid parameter', code: 100 } } }));
  const r2 = await metaCapi.sendEvents({ datasetId: '123', accessToken: 't', events: [], fetchImpl: bad });
  assert.deepEqual([r2.ok, r2.retryable], [false, false]);
  assert.match(r2.error, /Invalid parameter/);

  const throttled = fakeFetch(() => ({ status: 400, json: { error: { message: 'Too many calls', code: 17 } } }));
  assert.equal((await metaCapi.sendEvents({ datasetId: '1', accessToken: 't', events: [], fetchImpl: throttled })).retryable, true);
});

test('googleAds: refuses cleanly when agency credentials are missing', async () => {
  for (const k of ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN']) delete process.env[k];
  const r = await googleAds.uploadClickConversions({ customerId: '1234567890', conversions: [], fetchImpl: fakeFetch(() => ({})) });
  assert.equal(r.ok, false);
  assert.equal(r.retryable, false);
  assert.match(r.error, /google_not_configured.*GOOGLE_ADS_DEVELOPER_TOKEN/);
});

test('googleAds: token exchange, headers, partial failure handling', async () => {
  Object.assign(process.env, {
    GOOGLE_ADS_DEVELOPER_TOKEN: 'dev',
    GOOGLE_ADS_CLIENT_ID: 'cid',
    GOOGLE_ADS_CLIENT_SECRET: 'sec',
    GOOGLE_ADS_REFRESH_TOKEN: 'ref',
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: '296-111-2222',
  });
  const f = fakeFetch((url) =>
    url.includes('oauth2')
      ? { json: { access_token: 'at', expires_in: 3600 } }
      : { json: { partialFailureError: { message: 'CONVERSION_PRECEDES_CLICK' } } }
  );
  const r = await googleAds.uploadClickConversions({ customerId: '123-456-7890', conversions: [{ gclid: 'x' }], fetchImpl: f });
  const upload = f.calls.find((c) => c.url.includes('googleads'));
  assert.match(upload.url, /customers\/1234567890:uploadClickConversions$/);
  assert.equal(upload.init.headers['developer-token'], 'dev');
  assert.equal(upload.init.headers['login-customer-id'], '2961112222');
  assert.equal(upload.body.partialFailure, true);
  assert.deepEqual([r.ok, r.retryable], [false, false]);
});

// --- pipeline -------------------------------------------------------------------

test('lead moved into a mapped stage → sent to Meta once', async () => {
  const created = wire({ config: makeConfig(), task: taskDoc({ adConsent: { granted: true }, fbc: 'fb.1.1.x' }) });
  const f = fakeFetch(() => ({ json: { events_received: 1 } }));
  const rows = await svc.handleMovedToGroup({ taskId: TASK, boardId: BOARD, toGroupId: QUALIFIED }, { fetchImpl: f, now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'sent');
  assert.equal(rows[0].platform, 'meta');
  const ev = f.calls[0].body.data[0];
  assert.equal(ev.event_name, 'QualifiedLead');
  assert.equal(ev.event_id, `${TASK}:qualified`);
  assert.ok(ev.user_data.em[0].length === 64);

  // Dragged out and back in: not reported twice.
  const again = await svc.handleMovedToGroup({ taskId: TASK, boardId: BOARD, toGroupId: QUALIFIED }, { fetchImpl: f, now: NOW });
  assert.equal(again.length, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(created.length, 1);
});

test('unmapped group → nothing happens', async () => {
  wire({ config: makeConfig(), task: taskDoc({ adConsent: { granted: true } }) });
  const f = fakeFetch(() => ({ json: { events_received: 1 } }));
  const rows = await svc.handleMovedToGroup({ taskId: TASK, boardId: BOARD, toGroupId: '6aece1c9fafc81bd75d22eff' }, { fetchImpl: f });
  assert.equal(rows.length, 0);
  assert.equal(f.calls.length, 0);
});

test('no ad consent → skipped, never sent', async () => {
  wire({ config: makeConfig(), task: taskDoc({ adConsent: { granted: false } }) });
  const f = fakeFetch(() => ({ json: { events_received: 1 } }));
  const [row] = await svc.handleMovedToGroup({ taskId: TASK, boardId: BOARD, toGroupId: QUALIFIED }, { fetchImpl: f, now: NOW });
  assert.equal(row.status, 'skipped');
  assert.equal(row.reason, 'no_ad_consent');
  assert.equal(f.calls.length, 0);
});

test('transient failure → retried with back-off, then dead after max attempts', async () => {
  wire({ config: makeConfig(), task: taskDoc({ adConsent: { granted: true } }) });
  const f = fakeFetch(() => ({ status: 500, json: { error: { message: 'boom', code: 2 } } }));
  const [row] = await svc.handleMovedToGroup({ taskId: TASK, boardId: BOARD, toGroupId: QUALIFIED }, { fetchImpl: f, now: NOW });
  assert.equal(row.status, 'failed');
  assert.equal(row.nextAttemptAt.getTime(), NOW.getTime() + svc.BACKOFF_MS[0]);
  for (let i = 1; i < svc.MAX_ATTEMPTS; i += 1) await svc.attempt(row, { fetchImpl: f, now: NOW });
  assert.equal(row.status, 'dead');
  assert.equal(row.attempts, svc.MAX_ATTEMPTS);
});

test('test-event code marks events as tests', async () => {
  wire({ config: makeConfig({ meta: { testEventCode: 'TEST999' } }), task: taskDoc({ adConsent: { granted: true } }) });
  const f = fakeFetch(() => ({ json: { events_received: 1 } }));
  const [row] = await svc.handleMovedToGroup({ taskId: TASK, boardId: BOARD, toGroupId: QUALIFIED }, { fetchImpl: f, now: NOW });
  assert.equal(row.test, true);
  assert.equal(f.calls[0].body.test_event_code, 'TEST999');
});

test('accepted-with-warning is sent but keeps Meta’s warning visible', async () => {
  wire({ config: makeConfig({ meta: { testEventCode: 'TEST1' } }), task: taskDoc({ adConsent: { granted: true } }) });
  const msg = 'test_event_code "TEST1" does not match an active Test Events session';
  const f = fakeFetch(() => ({ json: { events_received: 1, messages: [msg] } }));
  const [row] = await svc.handleMovedToGroup({ taskId: TASK, boardId: BOARD, toGroupId: QUALIFIED }, { fetchImpl: f, now: NOW });
  assert.equal(row.status, 'sent');
  assert.match(row.reason, /^warning: .*does not match an active Test Events session/);
});

test('sendMetaTestEvent requires a test code and sends a fictitious lead', async () => {
  const config = makeConfig();
  assert.equal((await svc.sendMetaTestEvent(config, '')).ok, false);
  const f = fakeFetch(() => ({ json: { events_received: 1, fbtrace_id: 't' } }));
  const r = await svc.sendMetaTestEvent(config, 'TEST42', { fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(f.calls[0].body.test_event_code, 'TEST42');
  assert.equal(f.calls[0].body.access_token, 'EAAtesttoken'); // decrypted at send time
});
