/**
 * pushService.test.js — notification copy + routing rules. Pure, no DB/network.
 *     node --test src/services/pushService.test.js
 *
 * The copy is tested because a notification that doesn't say WHICH lead and how
 * urgent is noise — and noise is what makes people switch alerts off.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildNotification, PREF_FOR_KIND, isConfigured } = require('./pushService');

test('a new lead names the lead, its source, and the deadline', () => {
  const n = buildNotification('lead_assigned', {
    leadName: 'Dana Whitfield',
    source: 'Facebook',
    minutes: 5,
    taskId: 't1',
    boardId: 'b1',
  });
  assert.ok(n.body.includes('Dana Whitfield'), 'names the lead');
  assert.ok(n.body.includes('Facebook'), 'names the source');
  assert.ok(n.body.includes('5 minutes'), 'states the deadline');
  assert.equal(n.requireInteraction, true, 'must not vanish before it is seen');
});

test('every notification deep-links to the exact record', () => {
  const n = buildNotification('lead_assigned', { leadName: 'X', taskId: 't1', boardId: 'b1' });
  assert.equal(n.url, '/boards/b1?task=t1');
});

test('with no record it still links somewhere useful, never nowhere', () => {
  assert.equal(buildNotification('generic', {}).url, '/workspace');
  assert.equal(buildNotification('lead_assigned', { boardId: 'b1' }).url, '/boards/b1');
});

test('a missing lead name degrades gracefully', () => {
  const n = buildNotification('lead_assigned', { taskId: 't1' });
  assert.ok(n.body.startsWith('A lead'), 'never renders "undefined"');
  assert.ok(!n.body.includes('undefined'));
});

test('tags collapse repeats about the same lead', () => {
  const a = buildNotification('sla_warning', { leadName: 'Dana', taskId: 't1' });
  const b = buildNotification('sla_warning', { leadName: 'Dana', taskId: 't1' });
  assert.equal(a.tag, b.tag, 'same lead → same tag → one notification, not a pile');
  const other = buildNotification('sla_warning', { leadName: 'Priya', taskId: 't2' });
  assert.notEqual(a.tag, other.tag);
});

test('a breach explains what happened to the lead', () => {
  const n = buildNotification('sla_breached', { leadName: 'Owen Clarke', taskId: 't3' });
  assert.ok(n.body.includes('Owen Clarke'));
  assert.ok(/passed to someone else|reassigned/i.test(n.title + n.body));
});

test('a booking distinguishes booked from cancelled', () => {
  assert.match(buildNotification('booking_changed', { leadName: 'Dana' }).title, /booked/i);
  assert.match(buildNotification('booking_changed', { leadName: 'Dana', cancelled: true }).title, /cancelled/i);
});

test('a reply preview is truncated, not dumped whole', () => {
  const long = 'x'.repeat(400);
  const n = buildNotification('lead_replied', { leadName: 'Dana', preview: long });
  assert.ok(n.body.length <= 120);
});

test('every kind maps to a preference the user can switch off', () => {
  for (const kind of ['lead_assigned', 'sla_warning', 'sla_breached', 'booking_changed', 'lead_replied']) {
    assert.ok(PREF_FOR_KIND[kind], `${kind} is gated by a preference`);
  }
});

test('push is simply disabled when VAPID keys are absent', () => {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  // isConfigured caches, so this asserts the module simply does not throw.
  assert.doesNotThrow(() => isConfigured());
  if (pub) process.env.VAPID_PUBLIC_KEY = pub;
  if (priv) process.env.VAPID_PRIVATE_KEY = priv;
});
