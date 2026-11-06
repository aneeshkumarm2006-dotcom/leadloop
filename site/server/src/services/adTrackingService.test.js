/**
 * adTrackingService.test.js — the hourly health check, with model statics and
 * notification senders stubbed (no DB, no push).
 * Run: node --test src/services/adTrackingService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

require('../models');
const Organisation = require('../models/Organisation');
const Board = require('../models/Board');
const LeadConnection = require('../models/LeadConnection');
const AdConversionConfig = require('../models/AdConversionConfig');
const ConversionEvent = require('../models/ConversionEvent');
const notificationService = require('./notificationService');
const pushService = require('./pushService');
const svc = require('./adTrackingService');

const DAY = 24 * 3600e3;
const NOW = new Date('2026-11-06T12:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms);

const restore = [];
const stub = (obj, key, fn) => {
  const orig = obj[key];
  obj[key] = fn;
  restore.push(() => {
    obj[key] = orig;
  });
};
test.afterEach(() => {
  while (restore.length) restore.pop()();
});
const chain = (v) => ({ select: () => ({ lean: async () => v }), lean: async () => v });

const sent = { inApp: [], push: [] };
const wireNotify = () => {
  sent.inApp = [];
  sent.push = [];
  stub(notificationService, 'createNotificationsForUsers', async (args) => {
    sent.inApp.push(args);
    return [];
  });
  stub(pushService, 'notifySafely', (uid, orgId, kind, data) => {
    sent.push.push({ uid, kind, data });
    return Promise.resolve();
  });
};

const org = { _id: 'org1', admin: 'u1', admins: ['u2', 'u1'], name: 'BoPayments' };
const source = (over = {}) => ({
  _id: 'src1',
  name: 'Bopayments Website Form',
  boardId: 'b1',
  createdAt: ago(10 * DAY),
  submissionCount: 40,
  lastSubmissionAt: ago(3 * DAY),
  health: { silentAlertedAt: null },
  saved: false,
  async save() {
    this.saved = true;
  },
  ...over,
});

test('quiet busy source → one alert to each admin (in-app + push), then silent', async () => {
  wireNotify();
  const s = source();
  stub(LeadConnection, 'find', async () => [s]);
  stub(Board, 'findById', () => chain({ organisation: 'org1', name: 'Website Leads' }));
  stub(Organisation, 'findById', () => chain(org));
  stub(AdConversionConfig, 'find', async () => []);

  const alerts = await svc.runHealthCheck({ now: NOW });
  assert.deepEqual(alerts, [{ type: 'silent', sourceId: 'src1' }]);
  assert.deepEqual(sent.inApp[0].userIds, ['u1', 'u2']); // de-duplicated admins
  assert.equal(sent.inApp[0].type, 'health');
  assert.equal(sent.inApp[0].link, '/lead-sources');
  assert.match(sent.inApp[0].message, /No leads from “Bopayments Website Form”.*3 days/);
  assert.equal(sent.push.length, 2);
  assert.equal(s.saved, true);
  assert.equal(s.health.silentAlertedAt.getTime(), NOW.getTime());

  // Next hour: already alerted, no new lead → nothing.
  const again = await svc.runHealthCheck({ now: new Date(NOW.getTime() + 3600e3) });
  assert.deepEqual(again, []);
});

test('source with a normal pace is left alone', async () => {
  wireNotify();
  stub(LeadConnection, 'find', async () => [source({ lastSubmissionAt: ago(5 * 3600e3) })]);
  stub(AdConversionConfig, 'find', async () => []);
  assert.deepEqual(await svc.runHealthCheck({ now: NOW }), []);
  assert.equal(sent.inApp.length, 0);
});

test('failed conversion sends → one alert per day, linking to Ad conversions', async () => {
  wireNotify();
  const config = {
    workspaceId: 'org1',
    health: { lastFailureAlertAt: null },
    async save() {
      this.saved = true;
    },
  };
  stub(LeadConnection, 'find', async () => []);
  stub(AdConversionConfig, 'find', async () => [config]);
  stub(ConversionEvent, 'countDocuments', async () => 2);
  stub(Organisation, 'findById', () => chain(org));

  const alerts = await svc.runHealthCheck({ now: NOW });
  assert.deepEqual(alerts, [{ type: 'failures', workspaceId: 'org1', failedCount: 2 }]);
  assert.equal(sent.inApp[0].link, '/settings?tab=ads');
  assert.match(sent.inApp[0].message, /2 qualified leads could not be reported/);

  // Two hours later: still within the day → no repeat.
  const later = await svc.runHealthCheck({ now: new Date(NOW.getTime() + 2 * 3600e3) });
  assert.deepEqual(later, []);
});
