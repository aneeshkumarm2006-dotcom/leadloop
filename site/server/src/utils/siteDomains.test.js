/**
 * siteDomains.test.js — the snippet domain lock.
 * Run: node --test src/utils/siteDomains.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./siteDomains');

test('normalizeDomain accepts URLs and bare hosts, strips www', () => {
  assert.equal(D.normalizeDomain('https://www.BoPayments.com/contact?x=1'), 'bopayments.com');
  assert.equal(D.normalizeDomain('bopayments.com'), 'bopayments.com');
  assert.equal(D.normalizeDomain('shop.example.co.uk'), 'shop.example.co.uk');
  for (const bad of ['', 'localhost', '127.0.0.1', 'http://10.0.0.1', 'not a domain', 'javascript:alert(1)', 'foo']) {
    assert.equal(D.normalizeDomain(bad), '', bad);
  }
});

test('parseDomainList de-duplicates and caps', () => {
  assert.deepEqual(D.parseDomainList('bopayments.com, www.bopayments.com\nbo.app'), ['bopayments.com', 'bo.app']);
  assert.deepEqual(D.parseDomainList(['a.com', 'bad', 'b.com']), ['a.com', 'b.com']);
  const many = Array.from({ length: 20 }, (_, i) => `d${i}.com`);
  assert.equal(D.parseDomainList(many).length, D.MAX_DOMAINS);
});

test('hostAllowed: exact, www and subdomains only — no look-alikes', () => {
  const allowed = ['bopayments.com'];
  assert.equal(D.hostAllowed('bopayments.com', allowed), true);
  assert.equal(D.hostAllowed('www.bopayments.com', allowed), true);
  assert.equal(D.hostAllowed('app.bopayments.com', allowed), true);
  assert.equal(D.hostAllowed('evilbopayments.com', allowed), false);
  assert.equal(D.hostAllowed('bopayments.com.evil.io', allowed), false);
  assert.equal(D.hostAllowed('', allowed), false);
  assert.equal(D.hostAllowed('bopayments.com', []), false);
});

test('checkRequestSite prefers Origin, falls back to Referer, echoes exact origin', () => {
  const allowed = ['bopayments.com'];
  assert.deepEqual(D.checkRequestSite('https://www.bopayments.com', '', allowed), {
    host: 'www.bopayments.com',
    allowed: true,
    origin: 'https://www.bopayments.com',
  });
  assert.equal(D.checkRequestSite('', 'https://bopayments.com/contact?a=1', allowed).origin, 'https://bopayments.com');
  assert.equal(D.checkRequestSite('https://evil.io', 'https://bopayments.com/', allowed).allowed, false); // Origin wins
  assert.equal(D.checkRequestSite('null', '', allowed).allowed, false);
  assert.equal(D.checkRequestSite(undefined, undefined, allowed).allowed, false);
});
