/**
 * conversionPayloads.test.js — conversion event building + eligibility.
 * Run: node --test src/utils/conversionPayloads.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('./conversionPayloads');

const NOW = new Date('2026-11-06T12:00:00Z');

// A board shaped like Bo Payments' (columns created by the first submission).
const board = {
  columns: [
    { _id: 'c1', key: 'name', name: 'Name', type: 'text', order: 0, isPrimary: true },
    { _id: 'c2', key: 'first_name', name: 'First Name', type: 'text', order: 1 },
    { _id: 'c3', key: 'last_name', name: 'Last Name', type: 'text', order: 2 },
    { _id: 'c4', key: 'email', name: 'Email', type: 'email', order: 3 },
    { _id: 'c5', key: 'phone', name: 'Phone', type: 'phone', order: 4 },
  ],
};
const task = {
  _id: 'task123',
  name: 'Jane Q Smith',
  columnValues: new Map([
    ['c1', 'Jane Q Smith'],
    ['c2', 'Jane'],
    ['c3', "O'Smith"],
    ['c4', '  Jane.Doe@Example.COM '],
    ['c5', '(514) 555-0199'],
  ]),
};
const attribution = {
  gclid: 'Cj0KCQtest_123',
  fbc: 'fb.1.1793910008402.IwAR2x',
  fbp: 'fb.1.1793910008402.42',
  clientIp: '203.0.113.7',
  clientUserAgent: 'Mozilla/5.0',
  clickedAt: new Date('2026-11-01T00:00:00Z'),
  adConsent: { granted: true },
};

test('leadIdentity reads email/phone/name columns', () => {
  assert.deepEqual(P.leadIdentity(task, board), {
    email: 'Jane.Doe@Example.COM',
    phone: '(514) 555-0199',
    firstName: 'Jane',
    lastName: "O'Smith",
  });
});

test('leadIdentity falls back to splitting the lead name', () => {
  const t = { name: 'Prem Sai Kumar', columnValues: new Map() };
  const id = P.leadIdentity(t, { columns: [] });
  assert.equal(id.firstName, 'Prem');
  assert.equal(id.lastName, 'Sai Kumar');
});

test('normalisation matches platform rules', () => {
  assert.equal(P.normEmail('  A.B@Example.COM '), 'a.b@example.com');
  assert.equal(P.normEmail('not-an-email'), '');
  assert.equal(P.normEmailForGoogle('J.ane.Doe@GMAIL.com'), 'janedoe@gmail.com');
  assert.equal(P.normEmailForGoogle('j.doe@acme.com'), 'j.doe@acme.com');
  assert.equal(P.phoneDigits('(514) 555-0199'), '15145550199'); // 10 digits → +1
  assert.equal(P.phoneDigits('+44 20 7946 0958'), '442079460958');
  assert.equal(P.phoneDigits('0044 20 7946 0958'), '442079460958');
  assert.equal(P.phoneDigits('123'), '');
  assert.equal(P.normName("  O'Smith "), 'o smith');
});

test('eligibility: no consent → never sent, to either platform', () => {
  const identity = P.leadIdentity(task, board);
  for (const platform of ['meta', 'google']) {
    assert.deepEqual(P.eligibility({ platform, attribution: { ...attribution, adConsent: { granted: false } }, identity, now: NOW }), {
      ok: false,
      reason: 'no_ad_consent',
    });
    assert.equal(P.eligibility({ platform, attribution: null, identity, now: NOW }).reason, 'no_ad_consent');
  }
});

test('eligibility: needs something to match on', () => {
  const empty = { email: '', phone: '', firstName: 'A', lastName: '' };
  assert.equal(P.eligibility({ platform: 'meta', attribution: { adConsent: { granted: true } }, identity: empty, now: NOW }).reason, 'no_match_keys');
  assert.equal(P.eligibility({ platform: 'meta', attribution: { adConsent: { granted: true }, fbc: 'fb.1.1.x' }, identity: empty, now: NOW }).ok, true);
  assert.equal(P.eligibility({ platform: 'google', attribution: { adConsent: { granted: true }, gclid: 'x', clickedAt: NOW }, identity: empty, now: NOW }).ok, true);
  assert.equal(P.eligibility({ platform: 'google', attribution: { adConsent: { granted: true } }, identity: P.leadIdentity(task, board), now: NOW }).ok, true);
});

test('metaEvent: CRM-shaped, hashed identity, raw click data', () => {
  const ev = P.metaEvent({
    eventName: 'QualifiedLead',
    eventTime: NOW,
    eventId: 'task123:qualified',
    taskId: 'task123',
    identity: P.leadIdentity(task, board),
    attribution,
  });
  assert.equal(ev.event_name, 'QualifiedLead');
  assert.equal(ev.event_time, Math.floor(NOW.getTime() / 1000));
  assert.equal(ev.event_id, 'task123:qualified');
  assert.equal(ev.action_source, 'system_generated');
  assert.deepEqual(ev.custom_data, { event_source: 'crm', lead_event_source: 'LeadLoop' });
  assert.deepEqual(ev.user_data.em, [P.sha256('jane.doe@example.com')]);
  assert.deepEqual(ev.user_data.ph, [P.sha256('15145550199')]);
  assert.deepEqual(ev.user_data.fn, [P.sha256('jane')]);
  assert.deepEqual(ev.user_data.ln, [P.sha256('o smith')]);
  assert.deepEqual(ev.user_data.external_id, [P.sha256('task123')]);
  assert.equal(ev.user_data.fbc, attribution.fbc);
  assert.equal(ev.user_data.client_ip_address, '203.0.113.7');
  // nothing plaintext leaks
  assert.ok(!JSON.stringify(ev).includes('example.com'));
  assert.ok(!JSON.stringify(ev).includes('5550199'));
});

test('googleClickConversion: gclid + enhanced identifiers', () => {
  const c = P.googleClickConversion({
    customerId: '123-456-7890',
    conversionAction: '987654',
    eventTime: NOW,
    eventId: 'task123:qualified',
    identity: P.leadIdentity(task, board),
    attribution,
    now: NOW,
  });
  assert.equal(c.conversionAction, 'customers/1234567890/conversionActions/987654');
  assert.equal(c.conversionDateTime, '2026-11-06 12:00:00+00:00');
  assert.equal(c.gclid, 'Cj0KCQtest_123');
  assert.equal(c.orderId, 'task123:qualified');
  assert.deepEqual(c.userIdentifiers, [
    { hashedEmail: P.sha256('jane.doe@example.com') },
    { hashedPhoneNumber: P.sha256('+15145550199') },
  ]);
});

test('googleClickConversion: gbraid carries no identifiers; stale clicks are dropped', () => {
  const g = P.googleClickConversion({
    customerId: '1234567890',
    conversionAction: 'customers/1234567890/conversionActions/1',
    eventTime: NOW,
    eventId: 'e',
    identity: P.leadIdentity(task, board),
    attribution: { gbraid: 'GB123', clickedAt: NOW, adConsent: { granted: true } },
    now: NOW,
  });
  assert.equal(g.gbraid, 'GB123');
  assert.equal(g.userIdentifiers, undefined);

  const stale = P.googleClickConversion({
    customerId: '1234567890',
    conversionAction: '1',
    eventTime: NOW,
    eventId: 'e',
    identity: P.leadIdentity(task, board),
    attribution: { gclid: 'old', clickedAt: new Date(NOW.getTime() - 100 * 86400000) },
    now: NOW,
  });
  assert.equal(stale.gclid, undefined); // outside Google's 90-day window
  assert.ok(stale.userIdentifiers.length === 2); // still matchable by identifiers
});
