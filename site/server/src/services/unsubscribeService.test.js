/**
 * unsubscribeService.test.js — signed unsubscribe links. Pure, no DB.
 *     node --test src/services/unsubscribeService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-unsubscribe-tests';

const { makeToken, verifyToken, buildUrl, appendFooter, listUnsubscribeHeaders } =
  require('./unsubscribeService');

const ORG = '65b000000000000000000001';

test('a token round-trips to the same workspace + address', () => {
  const token = makeToken(ORG, 'Dana.W@Example.com');
  const out = verifyToken(token);
  assert.equal(out.organisation, ORG);
  assert.equal(out.email, 'dana.w@example.com', 'stored normalised');
});

test('a tampered or foreign token is rejected', () => {
  const token = makeToken(ORG, 'dana@example.com');
  assert.equal(verifyToken(`${token}x`), null);
  assert.equal(verifyToken('not.a.token'), null);
  assert.equal(verifyToken(''), null);
  assert.equal(verifyToken(null), null);
});

test('a token signed with a different secret is rejected', () => {
  const jwt = require('jsonwebtoken');
  const forged = jwt.sign({ org: ORG, email: 'x@y.com', t: 'unsub' }, 'a-different-secret');
  assert.equal(verifyToken(forged), null, 'forging an unsubscribe for someone else must fail');
});

test('a token of the wrong type is rejected', () => {
  const jwt = require('jsonwebtoken');
  // An auth token must never double as an unsubscribe token.
  const authish = jwt.sign({ userId: 'abc' }, process.env.JWT_SECRET);
  assert.equal(verifyToken(authish), null);
});

test('an invalid address produces no token', () => {
  assert.equal(makeToken(ORG, 'not-an-email'), null);
  assert.equal(makeToken(ORG, ''), null);
  assert.equal(makeToken(null, 'dana@example.com'), null);
});

test('the URL contains the token and points at the public host', () => {
  const url = buildUrl(ORG, 'dana@example.com');
  assert.ok(url.includes('/u/'), 'unsubscribe path');
  const token = url.split('/u/')[1];
  assert.equal(verifyToken(token).email, 'dana@example.com');
});

test('the footer is added to both HTML and plain text', () => {
  const out = appendFooter({ html: '<p>Hi</p>', text: 'Hi', url: 'https://x.test/u/abc' });
  assert.ok(out.html.includes('https://x.test/u/abc'));
  assert.ok(out.text.includes('https://x.test/u/abc'));
  assert.ok(out.html.includes('<p>Hi</p>'), 'original body preserved');
  assert.equal(out.hasFooter, true);
});

test('no URL → body untouched, and the caller can tell', () => {
  const out = appendFooter({ html: '<p>Hi</p>', text: 'Hi', url: null });
  assert.equal(out.html, '<p>Hi</p>');
  assert.equal(out.hasFooter, false, 'caller must be able to refuse to send');
});

test('List-Unsubscribe headers are emitted for mail clients', () => {
  const h = listUnsubscribeHeaders('https://x.test/u/abc');
  assert.equal(h['List-Unsubscribe'], '<https://x.test/u/abc>');
  assert.equal(h['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.deepEqual(listUnsubscribeHeaders(null), {});
});
